import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '@babel/parser';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../', import.meta.url));
const isSource = (file) => /\.[cm]?[jt]sx?$/.test(file) && !/\.(test|spec|stories)\.[cm]?[jt]sx?$/.test(file);

async function sources(directory) {
  const entries = await readdir(path.join(root, directory), { withFileTypes: true });
  const groups = await Promise.all(entries.map((entry) => {
    const file = `${directory}/${entry.name}`;
    if (entry.isDirectory()) return ['stories', '__tests__'].includes(entry.name) ? [] : sources(file);
    return isSource(file) ? [file] : [];
  }));
  return groups.flat();
}

function imports(node, result = []) {
  if (!node || typeof node !== 'object') return result;
  const source = ['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration', 'ImportExpression'].includes(node.type)
    ? node.source : node.type === 'TSImportType' ? node.argument
      : node.type === 'CallExpression' && (node.callee.type === 'Import' || node.callee.name === 'require')
        ? node.arguments[0] : undefined;
  if (source?.type === 'StringLiteral') result.push({ value: source.value, line: source.loc.start.line });
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach((child) => imports(child, result));
    else if (value && typeof value === 'object' && 'type' in value) imports(value, result);
  }
  return result;
}

test('production client, server and shared imports respect their boundaries', async () => {
  const files = ['server.ts', ...(await Promise.all(['src', 'server', 'shared'].map(sources))).flat()];
  const violations = (await Promise.all(files.map(async (file) => {
    const ast = parse(await readFile(path.join(root, file), 'utf8'), {
      sourceType: 'unambiguous', plugins: ['typescript', 'jsx'],
    });
    const layer = file === 'server.ts' ? 'server' : file.split('/')[0];
    return imports(ast).flatMap(({ value, line }) => {
      const target = value.startsWith('.') ? path.posix.normalize(path.posix.join(path.posix.dirname(file), value))
        : value.startsWith('@/') ? value.slice(2) : value;
      const server = target === 'server' || target.startsWith('server/') || /^server\.[cm]?[jt]s$/.test(target);
      const client = target === 'src' || target.startsWith('src/');
      const forbidden = layer === 'src' ? server || target.startsWith('shared/data/')
        : layer === 'server' ? client : server || client;
      return forbidden ? [`${file}:${line} imports ${value}`] : [];
    });
  }))).flat();
  assert.deepEqual(violations, []);
});

test('the browser module graph, including lazy imports, contains no server or demo seed', async () => {
  const result = await build({
    absWorkingDir: root, entryPoints: ['src/main.tsx'], bundle: true, write: false,
    metafile: true, platform: 'browser', packages: 'external', loader: { '.css': 'empty' },
  });
  const modules = Object.keys(result.metafile.inputs);
  assert.ok(modules.includes('src/data/boardApi.ts'));
  assert.deepEqual(modules.filter((file) => file === 'server.ts' || file.startsWith('server/') || file.startsWith('shared/data/')), []);
});
