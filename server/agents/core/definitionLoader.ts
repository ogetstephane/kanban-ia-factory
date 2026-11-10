import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import {
  buildDefinitionCatalog,
  type DefinitionCatalog,
  type DefinitionSource,
  type InstructionDefinition,
  type SkillDefinition,
} from './index';
import { immutable } from './snapshot';

const JSON_DEFINITION_DIRECTORIES = {
  instructions: 'instructions',
  prompts: 'prompts',
  agents: 'agents',
  policies: 'policies',
  executionProfiles: 'execution-profiles',
  workflows: 'workflows',
} as const;
const MAX_DEFINITION_FILES = 500;
const MAX_DEFINITION_FILE_BYTES = 1_000_000;
const MAX_SKILL_RESOURCE_BYTES = 5_000_000;

export interface DefinitionRoot {
  id: string;
  path: string;
  trust: DefinitionSource['trust'];
  instructionScope?: 'global' | 'project';
}

interface LoadedDefinitions {
  instructions: unknown[];
  skills: unknown[];
  prompts: unknown[];
  agents: unknown[];
  policies: unknown[];
  executionProfiles: unknown[];
  workflows: unknown[];
}

interface ResolvedRoot extends DefinitionRoot {
  realPath: string;
}

function hash(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function normalizeRelativePath(filePath: string): string {
  return filePath.split(path.sep).join('/');
}

function definitionSource(root: ResolvedRoot, relativePath: string, bytes: Uint8Array): DefinitionSource {
  return {
    uri: `${root.id}/${normalizeRelativePath(relativePath)}`,
    sha256: hash(bytes),
    trust: root.trust,
  };
}

function isWithinRoot(rootPath: string, targetPath: string): boolean {
  const relative = path.relative(rootPath, targetPath);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}

async function resolveRoots(roots: DefinitionRoot[]): Promise<ResolvedRoot[]> {
  const ids = new Set<string>();
  const resolved: ResolvedRoot[] = [];
  for (const root of roots) {
    if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(root.id)) {
      throw new Error(`Invalid definition root id: ${root.id}`);
    }
    if (ids.has(root.id)) throw new Error(`Duplicate definition root id: ${root.id}`);
    ids.add(root.id);
    const rootPath = await realpath(root.path);
    if (!(await lstat(rootPath)).isDirectory()) throw new Error(`Definition root is not a directory: ${root.id}`);
    resolved.push({ ...root, realPath: rootPath });
  }
  return resolved;
}

async function listFiles(root: ResolvedRoot, directory: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return [];
    throw error;
  }
  const files: string[] = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const entryPath = path.join(directory, entry.name);
    const stat = await lstat(entryPath);
    if (stat.isSymbolicLink()) {
      throw new Error(`Symbolic links are not allowed in definition roots: ${path.relative(root.realPath, entryPath)}`);
    }
    if (!isWithinRoot(root.realPath, await realpath(entryPath))) {
      throw new Error(`Definition path escapes root ${root.id}: ${path.relative(root.realPath, entryPath)}`);
    }
    if (stat.isDirectory()) files.push(...await listFiles(root, entryPath));
    else if (stat.isFile()) files.push(entryPath);
  }
  return files;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

async function readBoundedFile(filePath: string, relativePath: string): Promise<Buffer> {
  const info = await lstat(filePath);
  if (!info.isFile() || info.size > MAX_DEFINITION_FILE_BYTES) {
    throw new Error(`Definition file is not a regular file or exceeds 1 MB: ${relativePath}`);
  }
  return readFile(filePath);
}

function objectValue(value: unknown, description: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${description} must contain a YAML or JSON object.`);
  }
  return value as Record<string, unknown>;
}

async function loadJsonDefinitions(
  root: ResolvedRoot,
  relativeDirectory: string,
): Promise<Record<string, unknown>[]> {
  const absoluteDirectory = path.join(root.realPath, relativeDirectory);
  const files = (await listFiles(root, absoluteDirectory))
    .filter((filePath) => filePath.endsWith('.json'))
    .sort((left, right) => left.localeCompare(right));
  const definitions: Record<string, unknown>[] = [];
  for (const filePath of files) {
    const relativePath = path.relative(root.realPath, filePath);
    const bytes = await readBoundedFile(filePath, relativePath);
    let value: unknown;
    try {
      value = JSON.parse(bytes.toString('utf8'));
    } catch (error) {
      throw new Error(`Invalid JSON definition ${root.id}/${normalizeRelativePath(relativePath)}.`, { cause: error });
    }
    definitions.push({
      ...objectValue(value, `${root.id}/${normalizeRelativePath(relativePath)}`),
      source: definitionSource(root, relativePath, bytes),
    });
  }
  return definitions;
}

function parseSkillFrontmatter(content: string, uri: string): { metadata: Record<string, unknown>; body: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/);
  if (!match) throw new Error(`Skill ${uri} must start with YAML frontmatter and a closing --- line.`);
  let metadata: unknown;
  try {
    metadata = parseYaml(match[1], { uniqueKeys: true });
  } catch (error) {
    throw new Error(`Invalid YAML frontmatter in ${uri}.`, { cause: error });
  }
  return { metadata: objectValue(metadata, uri), body: match[2].trim() };
}

function skillResourceKind(relativePath: string): SkillDefinition['resources'][number]['kind'] {
  const segments = relativePath.split('/');
  if (segments.includes('references')) return 'reference';
  if (segments.includes('scripts')) return 'script';
  return 'asset';
}

async function loadSkills(root: ResolvedRoot, resourceContents: Record<string, string>): Promise<SkillDefinition[]> {
  const directory = path.join(root.realPath, 'skills');
  const files = await listFiles(root, directory);
  const skillFiles = files.filter((filePath) => path.basename(filePath) === 'SKILL.md');
  const skills: SkillDefinition[] = [];

  for (const skillFile of skillFiles) {
    const skillDirectory = path.dirname(skillFile);
    const relativeSkillDirectory = normalizeRelativePath(path.relative(directory, skillDirectory));
    const relativeSkillFile = path.relative(root.realPath, skillFile);
    const skillUri = `${root.id}/${normalizeRelativePath(relativeSkillFile)}`;
    const skillBytes = await readBoundedFile(skillFile, normalizeRelativePath(relativeSkillFile));
    const { metadata, body } = parseSkillFrontmatter(skillBytes.toString('utf8'), skillUri);
    const name = metadata.name;
    if (typeof name !== 'string' || path.basename(skillDirectory) !== name) {
      throw new Error(`Skill name in ${skillUri} must match its parent directory.`);
    }
    const description = metadata.description;
    if (typeof description !== 'string' || !description.trim()) {
      throw new Error(`Skill ${skillUri} must have a non-empty description.`);
    }
    const extraMetadata = metadata.metadata === undefined
      ? {}
      : objectValue(metadata.metadata, `Skill metadata in ${skillUri}`);
    if (Object.values(extraMetadata).some((value) => typeof value !== 'string')) {
      throw new Error(`Skill metadata values in ${skillUri} must be strings.`);
    }

    const resourceFiles = files
      .filter((filePath) => filePath.startsWith(`${skillDirectory}${path.sep}`) && filePath !== skillFile)
      .sort((left, right) => left.localeCompare(right));
    let totalResourceBytes = 0;
    const resources: SkillDefinition['resources'] = [];
    for (const resourceFile of resourceFiles) {
      const relativePath = normalizeRelativePath(path.relative(skillDirectory, resourceFile));
      const bytes = await readBoundedFile(resourceFile, `${relativeSkillDirectory}/${relativePath}`);
      totalResourceBytes += bytes.byteLength;
      if (totalResourceBytes > MAX_SKILL_RESOURCE_BYTES) {
        throw new Error(`Resources for skill ${skillUri} exceed 5 MB.`);
      }
      resources.push({
        path: relativePath,
        kind: skillResourceKind(relativePath),
        sha256: hash(bytes),
      });
      resourceContents[hash(bytes)] = bytes.toString('base64');
    }

    skills.push({
      schemaVersion: 1,
      id: name,
      name,
      version: typeof extraMetadata.version === 'string' ? extraMetadata.version : '1.0.0',
      description: description.trim(),
      source: definitionSource(root, relativeSkillFile, skillBytes),
      entrypoint: 'SKILL.md',
      instructions: body,
      resources,
      activation: { mode: 'on-demand' },
      dependencies: [],
      requiredTools: [],
    });
  }
  return skills;
}

async function loadAgentsFiles(root: ResolvedRoot): Promise<InstructionDefinition[]> {
  const rootAgentsPath = path.join(root.realPath, 'AGENTS.md');
  const instructionFiles = [
    ...(await fileExists(rootAgentsPath) ? [rootAgentsPath] : []),
    ...(await listFiles(root, path.join(root.realPath, 'instructions')))
      .filter((filePath) => path.basename(filePath) === 'AGENTS.md'),
  ];
  const instructions: InstructionDefinition[] = [];

  for (const filePath of instructionFiles.sort((left, right) => left.localeCompare(right))) {
    const relativePath = path.relative(root.realPath, filePath);
    const rootInstruction = relativePath === 'AGENTS.md';
    const relativeInstructionDirectory = rootInstruction
      ? ''
      : path.relative(path.join(root.realPath, 'instructions'), path.dirname(filePath));
    const bytes = await readBoundedFile(filePath, relativePath);
    const idPart = normalizeRelativePath(relativePath)
      .replace(/\.md$/i, '')
      .toLowerCase()
      .replace(/[^a-z0-9.-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^[.-]+|[.-]+$/g, '') || 'root';
    instructions.push({
      schemaVersion: 1,
      id: `agents.${root.id}.${idPart}`,
      version: '1.0.0',
      description: `Instructions from ${normalizeRelativePath(relativePath)}`,
      source: definitionSource(root, relativePath, bytes),
      scope: rootInstruction ? root.instructionScope ?? (root.trust === 'managed' ? 'global' : 'project') : 'project',
      content: bytes.toString('utf8').trim(),
      priority: 0,
      ...(relativeInstructionDirectory
        ? { appliesWhen: { paths: [`${normalizeRelativePath(relativeInstructionDirectory)}/**`] } }
        : {}),
    });
  }
  return instructions;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const stat = await lstat(filePath);
    if (stat.isSymbolicLink()) throw new Error(`Symbolic links are not allowed in definition roots: ${filePath}`);
    return stat.isFile();
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return false;
    throw error;
  }
}

export async function loadDefinitionContext(roots: DefinitionRoot[]) {
  if (!roots.length) throw new Error('At least one definition root is required.');
  const resolvedRoots = await resolveRoots(roots);
  const loaded: LoadedDefinitions = {
    instructions: [],
    skills: [],
    prompts: [],
    agents: [],
    policies: [],
    executionProfiles: [],
    workflows: [],
  };
  let discoveredFiles = 0;
  const resourceContents: Record<string, string> = {};

  for (const root of resolvedRoots) {
    const agentsInstructions = await loadAgentsFiles(root);
    loaded.instructions.push(...agentsInstructions);
    const skills = await loadSkills(root, resourceContents);
    loaded.skills.push(...skills);
    discoveredFiles += agentsInstructions.length + skills.length;
    for (const catalogKey of Object.keys(JSON_DEFINITION_DIRECTORIES) as (keyof typeof JSON_DEFINITION_DIRECTORIES)[]) {
      const directory = JSON_DEFINITION_DIRECTORIES[catalogKey];
      const definitions = await loadJsonDefinitions(root, directory);
      loaded[catalogKey].push(...definitions);
      discoveredFiles += definitions.length;
    }
    if (discoveredFiles > MAX_DEFINITION_FILES) {
      throw new Error(`Definition roots exceed the ${MAX_DEFINITION_FILES}-file limit.`);
    }
  }

  return immutable({ catalog: buildDefinitionCatalog(loaded), resourceContents });
}

export async function loadDefinitionCatalog(roots: DefinitionRoot[]): Promise<DefinitionCatalog> {
  return (await loadDefinitionContext(roots)).catalog;
}
