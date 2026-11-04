import { parse } from '@babel/parser';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const AUTOMATIC_DIAGRAMS = ['auto-architecture', 'auto-react'];

const sourceExtension = /\.[cm]?[jt]sx?$/;
const ignoredSource = /(?:^|\/)(?:stories|__tests__)\//;
const ignoredFile = /\.(?:test|spec|stories)\.[cm]?[jt]sx?$/;
const builtin = new Set(builtinModules.map((name) => name.replace(/^node:/, '')));
const upperCaseName = /^[A-Z]/;
// Module where the Express app and its HTTP routes are composed (server.ts only starts it).
const expressAppFile = 'server/app.ts';

function git(root, args) {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
  } catch (error) {
    throw new Error(`Git ${args[0]} failed: ${error.stderr?.toString().trim() || error.message}`, { cause: error });
  }
}

function repositoryLocation(root) {
  const remotes = git(root, ['remote']).trim().split('\n');
  if (!remotes.includes('origin')) return { url: pathToFileURL(root).href, link_mode: 'local-only' };

  const origin = git(root, ['remote', 'get-url', 'origin']).trim();
  if (/^https?:\/\//i.test(origin)) {
    const url = new URL(origin);
    url.username = '';
    url.password = '';
    const location = { url: url.toString() };
    if (url.protocol !== 'https:' || !['github.com', 'gitlab.com', 'gitee.com'].includes(url.hostname)) {
      location.link_mode = 'local-only';
    }
    return location;
  }
  return { url: origin, link_mode: 'local-only' };
}

// Mirrors server/agents/workspaceTools.ts: literal rules only, bare names match at any depth.
export function parseCopilotIgnore(contents) {
  return contents.split(/\r?\n/).flatMap((line, index) => {
    const value = line.trim();
    if (!value || value.startsWith('#')) return [];
    if (value.startsWith('!') || value.includes('\\')) {
      throw new Error(`Unsupported .copilotignore rule on line ${index + 1}`);
    }
    const directory = value.endsWith('/');
    const ignoredPath = value.replace(/^\/|\/$/g, '');
    if (!ignoredPath || ignoredPath.split('/').some((part) => part === '.' || part === '..')) {
      throw new Error(`Invalid .copilotignore rule on line ${index + 1}`);
    }
    return [{ path: ignoredPath, directory }];
  });
}

export function isCopilotIgnored(rules, name) {
  return rules.some((rule) => {
    if (rule.directory) {
      if (name === rule.path || name.startsWith(`${rule.path}/`)) return true;
      return !rule.path.includes('/') && name.split('/').includes(rule.path);
    }
    if (name === rule.path) return true;
    return !rule.path.includes('/') && path.posix.basename(name) === rule.path;
  });
}

function readCopilotIgnore(root) {
  try {
    return parseCopilotIgnore(readFileSync(path.join(root, '.copilotignore'), 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}

function changedPaths(porcelain) {
  const entries = porcelain.split('\0');
  const paths = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (!entry) continue;
    paths.push(entry.slice(3));
    if (/^[RC]/.test(entry)) paths.push(entries[++index]);
  }
  return paths;
}

export function readCommittedSources(root) {
  const revision = git(root, ['rev-parse', 'HEAD']).trim();
  if (!/^[a-f0-9]{40}$/i.test(revision)) throw new Error('Git did not return a valid commit revision.');
  const ignoreRules = readCopilotIgnore(root);
  const included = (name) => !isCopilotIgnored(ignoreRules, name);

  const names = git(root, ['ls-tree', '-r', '-z', '--name-only', revision, '--', 'src', 'server', 'shared', 'server.ts'])
    .split('\0').filter((name) => sourceExtension.test(name) && !ignoredSource.test(name) && !ignoredFile.test(name) && included(name)).sort();
  if (!names.length) throw new Error('No committed application TypeScript/JavaScript sources were found.');

  const files = new Map(names.map((name) => [name, git(root, ['show', `${revision}:${name}`])]));
  const status = spawnSync('git', ['status', '--porcelain=v1', '-z', '--untracked-files=normal', '--', 'src', 'server', 'shared', 'server.ts'], {
    cwd: root, encoding: 'utf8',
  });
  if (status.error || status.status !== 0) {
    throw new Error(`Git status failed: ${status.stderr?.trim() || status.error?.message || `exit ${status.status}`}`);
  }
  return {
    files, revision, repository: { ...repositoryLocation(root), revision },
    dirty: changedPaths(status.stdout).some((name) => name && included(name.replace(/\/$/, ''))),
  };
}

function walk(node, visit) {
  if (!node || typeof node !== 'object' || typeof node.type !== 'string') return;
  visit(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const child of value) walk(child, visit);
    } else if (value && typeof value === 'object' && typeof value.type === 'string') {
      walk(value, visit);
    }
  }
}

function parseModules(files) {
  const modules = new Map();
  for (const [file, text] of files) {
    try {
      const ast = parse(text, {
        sourceType: 'unambiguous',
        plugins: ['typescript', ...(/\.[jt]sx$/.test(file) ? ['jsx'] : [])],
      });
      modules.set(file, { file, ast, imports: new Map(), exports: new Map(), exportAll: [], components: new Map(), jsx: [] });
    } catch (error) {
      throw new Error(`Cannot parse ${file}: ${error.message}`, { cause: error });
    }
  }
  return modules;
}

function resolveModule(from, specifier, modules) {
  let base;
  if (specifier.startsWith('.')) base = path.posix.normalize(path.posix.join(path.posix.dirname(from), specifier));
  else if (specifier.startsWith('@/')) base = specifier.slice(2);
  else return null;
  const withoutJsExtension = base.replace(/\.[cm]?js$/, '');
  const candidates = [
    base, ...['.ts', '.tsx', '.js', '.jsx'].map((extension) => base + extension),
    ...['.ts', '.tsx', '.js', '.jsx'].map((extension) => withoutJsExtension + extension),
    ...['index.ts', 'index.tsx', 'index.js', 'index.jsx'].map((index) => `${base}/${index}`),
  ];
  return candidates.find((candidate) => modules.has(candidate)) ?? null;
}

function groupFor(file) {
  if (file === 'server.ts') return 'server.ts';
  const [first, second] = file.split('/');
  return second?.includes('.') ? `${first} (entrée)` : `${first}/${second}`;
}

function externalGroup(specifier) {
  const name = specifier.replace(/^node:/, '');
  if (specifier.startsWith('node:') || builtin.has(name)) return 'Node.js';
  return `package ${specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0]}`;
}

function importSource(node) {
  if (node.type === 'ImportDeclaration' || node.type === 'ExportNamedDeclaration' || node.type === 'ExportAllDeclaration') {
    return node.source?.value;
  }
  if (node.type === 'ImportExpression') return node.source?.value;
  if (node.type === 'CallExpression' && node.callee?.type === 'Import') return node.arguments[0]?.value;
  return undefined;
}

function stringPrefix(node) {
  if (node?.type === 'StringLiteral') return node.value;
  if (node?.type === 'TemplateLiteral') return node.quasis[0]?.value.cooked ?? node.quasis[0]?.value.raw;
  return undefined;
}

function lineOf(node) {
  return node.loc?.start.line ?? 1;
}

function source(file, line) {
  return { path: file, line };
}

function collectDependencies(modules) {
  const groups = new Map();
  const dependencies = new Map();
  const fetches = [];
  const endpoints = [];
  const unresolved = [];

  function add(from, to, kind, value, file, line) {
    if (from === to) return;
    const key = `${from}\0${to}\0${kind}\0${value ?? ''}`;
    const item = dependencies.get(key) ?? { from, to, kind, value, locations: [] };
    item.locations.push(source(file, line));
    dependencies.set(key, item);
  }

  for (const [file, module] of modules) {
    const from = groupFor(file);
    if (!groups.has(from)) groups.set(from, source(file, 1));
    walk(module.ast.program, (node) => {
      const specifier = importSource(node);
      if (typeof specifier === 'string') {
        const isLocal = specifier.startsWith('.') || specifier.startsWith('@/');
        const target = resolveModule(file, specifier, modules);
        if (target) add(from, groupFor(target), 'import', undefined, file, lineOf(node));
        else if (!isLocal) add(from, externalGroup(specifier), 'import', undefined, file, lineOf(node));
        else if (!/\.(?:css|scss|svg|png|jpe?g|gif|webp|json)$/i.test(specifier)) {
          unresolved.push(`${file}:${lineOf(node)} ${specifier}`);
        }
      }

      if (node.type !== 'CallExpression') return;
      if (file.startsWith('src/') && node.callee.type === 'Identifier' && node.callee.name === 'fetch') {
        const prefix = stringPrefix(node.arguments[0]);
        if (prefix?.startsWith('/')) fetches.push({ prefix, file, line: lineOf(node) });
      }
      if (file === expressAppFile && node.callee.type === 'MemberExpression'
        && node.callee.object.type === 'Identifier' && node.callee.object.name === 'app'
        && node.callee.property.type === 'Identifier'
        && ['use', 'get', 'post', 'put', 'patch', 'delete'].includes(node.callee.property.name)) {
        const prefix = stringPrefix(node.arguments[0]);
        if (prefix?.startsWith('/')) endpoints.push({ prefix, file, line: lineOf(node) });
      }
    });
  }

  for (const request of fetches) {
    const endpoint = endpoints.find(({ prefix }) => request.prefix === prefix || request.prefix.startsWith(`${prefix}/`));
    if (endpoint) add(groupFor(request.file), groupFor(endpoint.file), 'http', request.prefix, request.file, request.line);
  }
  return { groups, dependencies: [...dependencies.values()], unresolved };
}

function componentName(node, file) {
  if ((node.type === 'FunctionDeclaration' || node.type === 'ClassDeclaration') && node.id) return node.id.name;
  if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier') {
    const initializer = node.init;
    if (initializer && ['ArrowFunctionExpression', 'FunctionExpression', 'ClassExpression'].includes(initializer.type)) return node.id.name;
    if (initializer?.type === 'CallExpression') {
      const callee = initializer.callee;
      const name = callee.type === 'Identifier' ? callee.name
        : callee.type === 'MemberExpression' && !callee.computed ? callee.property.name : '';
      if (['memo', 'forwardRef'].includes(name)) return node.id.name;
    }
  }
  if ((node.type === 'FunctionDeclaration' || node.type === 'ClassDeclaration') && !node.id) {
    return path.posix.basename(file).replace(/\.[^.]+$/, '');
  }
  return undefined;
}

function importedName(specifier) {
  if (specifier.type === 'ImportDefaultSpecifier') return 'default';
  if (specifier.type === 'ImportNamespaceSpecifier') return '*';
  return specifier.imported?.name ?? specifier.imported?.value;
}

function lazyImport(initializer) {
  if (initializer?.type !== 'CallExpression') return undefined;
  const callee = initializer.callee;
  const lazy = (callee.type === 'Identifier' && callee.name === 'lazy')
    || (callee.type === 'MemberExpression' && !callee.computed && callee.property.name === 'lazy');
  if (!lazy) return undefined;
  let specifier;
  let name = 'default';
  walk(initializer, (node) => {
    if (!specifier) {
      const value = importSource(node);
      if (typeof value === 'string') specifier = value;
    }
    if (node.type === 'ObjectProperty' && !node.computed
      && (node.key.name ?? node.key.value) === 'default'
      && node.value.type === 'MemberExpression' && !node.value.computed
      && node.value.property.type === 'Identifier') name = node.value.property.name;
  });
  return specifier ? { specifier, name } : undefined;
}

function jsxName(node) {
  if (node.type === 'JSXIdentifier') return node.name;
  if (node.type === 'JSXMemberExpression') return `${jsxName(node.object)}.${jsxName(node.property)}`;
  return '';
}

function collectComponentModules(modules) {
  for (const module of modules.values()) {
    if (!module.file.startsWith('src/')) continue;

    for (const statement of module.ast.program.body) {
      if (statement.type === 'ImportDeclaration' && statement.importKind !== 'type') {
        for (const specifier of statement.specifiers) {
          if (specifier.importKind === 'type') continue;
          module.imports.set(specifier.local.name, {
            specifier: statement.source.value, name: importedName(specifier), line: lineOf(statement),
          });
        }
      }
      if (statement.type === 'ExportDefaultDeclaration') {
        const declaration = statement.declaration;
        const name = declaration.type === 'Identifier' ? declaration.name : componentName(declaration, module.file);
        if (name) module.exports.set('default', { local: name });
      }
      if (statement.type === 'ExportNamedDeclaration') {
        const declaration = statement.declaration;
        if (declaration?.type === 'FunctionDeclaration' || declaration?.type === 'ClassDeclaration') {
          if (declaration.id) module.exports.set(declaration.id.name, { local: declaration.id.name });
        }
        if (declaration?.type === 'VariableDeclaration') {
          for (const variable of declaration.declarations) {
            if (variable.id.type === 'Identifier') module.exports.set(variable.id.name, { local: variable.id.name });
          }
        }
        for (const specifier of statement.specifiers) {
          const exported = specifier.exported.name ?? specifier.exported.value;
          const local = specifier.local.name ?? specifier.local.value;
          module.exports.set(exported, statement.source ? { specifier: statement.source.value, name: local } : { local });
        }
      }
      if (statement.type === 'ExportAllDeclaration') module.exportAll.push(statement.source.value);
    }

    if (!/\.[jt]sx$/.test(module.file)) continue;
    function visit(node, owner) {
      if (!node || typeof node !== 'object' || typeof node.type !== 'string') return;
      if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier') {
        const lazy = lazyImport(node.init);
        if (lazy) module.imports.set(node.id.name, { ...lazy, line: lineOf(node) });
      }
      const name = componentName(node, module.file);
      let nextOwner = owner;
      if (name && upperCaseName.test(name)) {
        const previous = module.components.get(name);
        if (previous && previous.line !== lineOf(node)) {
          throw new Error(`Ambiguous component ${name} in ${module.file}:${previous.line} and :${lineOf(node)}.`);
        }
        nextOwner = { name, file: module.file, line: lineOf(node) };
        module.components.set(name, nextOwner);
      }
      if (node.type === 'JSXOpeningElement' && nextOwner) {
        const name = jsxName(node.name);
        if (upperCaseName.test(name)) module.jsx.push({ owner: nextOwner, name, line: lineOf(node) });
      }
      for (const value of Object.values(node)) {
        if (Array.isArray(value)) {
          for (const child of value) visit(child, nextOwner);
        } else if (value && typeof value === 'object' && typeof value.type === 'string') {
          visit(value, nextOwner);
        }
      }
    }
    visit(module.ast.program);
  }
}

function resolveExport(modules, file, name, visited = new Set()) {
  const key = `${file}\0${name}`;
  if (visited.has(key)) return undefined;
  visited.add(key);
  const module = modules.get(file);
  const entry = module?.exports.get(name);
  if (!entry && name !== 'default') {
    const matches = module?.exportAll.flatMap((specifier) => {
      const target = resolveModule(file, specifier, modules);
      const component = target ? resolveExport(modules, target, name, new Set(visited)) : undefined;
      return component ? [component] : [];
    }) ?? [];
    return matches.length === 1 ? matches[0] : undefined;
  }
  if (!entry) return undefined;
  if (entry.local) return module.components.get(entry.local);
  const target = resolveModule(file, entry.specifier, modules);
  return target ? resolveExport(modules, target, entry.name, visited) : undefined;
}

function collectReactRelations(modules) {
  collectComponentModules(modules);
  const relations = new Map();
  const unresolved = [];

  for (const module of modules.values()) {
    for (const usage of module.jsx) {
      const [localName, member] = usage.name.split('.');
      let target = !member ? module.components.get(localName) : undefined;
      const imported = module.imports.get(localName);
      if (!target && imported) {
        const local = imported.specifier.startsWith('.') || imported.specifier.startsWith('@/');
        if (!local) continue;
        const targetFile = resolveModule(module.file, imported.specifier, modules);
        const exported = imported.name === '*' ? member : imported.name;
        if (targetFile && exported) target = resolveExport(modules, targetFile, exported);
        if (!target) unresolved.push(`${module.file}:${usage.line} <${usage.name}>`);
      }
      if (!target) continue;
      const key = `${usage.owner.file}\0${usage.owner.name}\0${target.file}\0${target.name}`;
      const relation = relations.get(key) ?? { from: usage.owner, to: target, lines: [] };
      relation.lines.push(usage.line);
      relations.set(key, relation);
    }
  }
  return { relations: [...relations.values()], unresolved };
}

function id(...parts) {
  return `n${createHash('sha1').update(parts.join('\0')).digest('hex').slice(0, 16)}`;
}

function baseSpec(title, filename, repository, translations) {
  return {
    schema_version: 1,
    diagram_type: 'tree',
    meta: {
      title,
      locale: 'fr',
      translations,
      output: filename,
      quality_profile: 'showcase',
      repository,
    },
    layout: { direction: 'right' },
    nodes: [],
    cards: [],
  };
}

function entrySources(modules) {
  const preferred = ['src/App.tsx', 'server.ts', 'src/main.tsx'].filter((file) => modules.has(file));
  const paths = preferred.length ? preferred : [...modules.keys()].slice(0, 1);
  return paths.slice(0, 3).map((file) => source(file, 1));
}

function architectureDiagram(modules, repository, translations, output) {
  const { groups, dependencies, unresolved } = collectDependencies(modules);
  const spec = baseSpec('Architecture — dépendances des modules', output, repository, translations);
  const root = id('architecture');
  spec.nodes.push({ id: root, label: 'Dépendances applicatives', sublabel: 'imports et HTTP détectés', sources: entrySources(modules) });

  for (const [group, location] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    const parent = id('group', group);
    spec.nodes.push({ id: parent, parent: root, label: group, sublabel: 'module importateur', sources: [location] });
    const items = dependencies.filter((dependency) => dependency.from === group)
      .sort((a, b) => `${a.to}\0${a.kind}\0${a.value ?? ''}`.localeCompare(`${b.to}\0${b.kind}\0${b.value ?? ''}`));
    for (const dependency of items) {
      const location = dependency.locations[0];
      const label = dependency.kind === 'http' ? `HTTP ${dependency.value} → ${dependency.to}` : `importe ${dependency.to}`;
      const suffix = dependency.locations.length > 1 ? ` · ${dependency.locations.length} déclarations` : '';
      spec.nodes.push({
        id: id('dependency', group, dependency.to, dependency.kind, dependency.value ?? ''),
        parent,
        label,
        sublabel: `${location.path}:${location.line}${suffix}`,
        sources: dependency.locations.slice(0, 3),
      });
    }
  }
  spec.cards = [{
    dot: 'cyan',
    title: 'Lecture',
    items: [
      `Analyse statique du commit ${repository.revision.slice(0, 7)} : ${groups.size} groupes et ${dependencies.length} relations.`,
      'Les branches listent les imports déclarés, y compris les types ; elles ne prouvent pas un appel à l’exécution.',
      `Les liens HTTP rapprochent un fetch relatif et un chemin déclaré dans ${expressAppFile} ; les routes dynamiques ne sont pas déduites.`,
      'Périmètre : src/, server/, shared/ et server.ts, hors tests et stories.',
      ...(unresolved.length ? [`${unresolved.length} imports locaux non résolus : ${unresolved.slice(0, 3).join(', ')}.`] : []),
    ],
  }];
  return { spec, unresolved };
}

function reactDiagram(modules, repository, translations, output) {
  const { relations, unresolved } = collectReactRelations(modules);
  if (!relations.length) throw new Error('No local React JSX composition relationships were found.');
  const spec = baseSpec('React — composition des composants', output, repository, translations);
  const root = id('react');
  spec.nodes.push({ id: root, label: 'Composition React', sublabel: 'balises JSX locales', sources: entrySources(modules) });

  const parents = new Map();
  for (const relation of relations) {
    const key = `${relation.from.file}\0${relation.from.name}`;
    const group = parents.get(key) ?? { component: relation.from, relations: [] };
    group.relations.push(relation);
    parents.set(key, group);
  }
  for (const [key, { component, relations: children }] of [...parents].sort((a, b) => a[0].localeCompare(b[0]))) {
    const parent = id('component', key);
    spec.nodes.push({
      id: parent, parent: root, label: component.name, sublabel: component.file,
      sources: [source(component.file, component.line)],
    });
    for (const relation of children.sort((a, b) => `${a.to.name}\0${a.to.file}`.localeCompare(`${b.to.name}\0${b.to.file}`))) {
      const suffix = relation.lines.length > 1 ? ` · ${relation.lines.length} occurrences` : '';
      spec.nodes.push({
        id: id('jsx', key, relation.to.file, relation.to.name),
        parent,
        label: `rend ${relation.to.name}`,
        sublabel: `${component.file}:${relation.lines[0]}${suffix}`,
        sources: [source(component.file, relation.lines[0]), source(relation.to.file, relation.to.line)],
      });
    }
  }
  spec.cards = [{
    dot: 'violet',
    title: 'Lecture',
    items: [
      `Analyse du commit ${repository.revision.slice(0, 7)} : ${parents.size} composants parents, ${relations.length} liens JSX directs.`,
      'Chaque branche regroupe les composants locaux mentionnés en JSX par un parent ; les composants partagés apparaissent dans chaque branche.',
      'Les imports nommés, les exports par défaut et React.lazy sont suivis ; les composants de bibliothèques externes sont exclus.',
      'Les balises dynamiques, createElement et les choix conditionnels à l’exécution ne sont pas déduits.',
      ...(unresolved.length ? [`${unresolved.length} balises locales non résolues : ${unresolved.slice(0, 3).join(', ')}.`] : []),
    ],
  }];
  return { spec, unresolved };
}

export function analyzeProject(files, repository, translations, outputDirectory, requested = AUTOMATIC_DIAGRAMS) {
  const modules = parseModules(files);
  if (!repository?.revision) throw new Error('A committed repository revision is required.');
  const output = (name) => path.posix.join(outputDirectory, `${name}.html`);
  const diagrams = {};
  for (const name of requested) {
    if (name === 'auto-architecture') diagrams[name] = architectureDiagram(modules, repository, translations, output(name));
    else if (name === 'auto-react') diagrams[name] = reactDiagram(modules, repository, translations, output(name));
    else throw new Error(`Unknown automatic diagram: ${name}`);
  }
  return diagrams;
}
