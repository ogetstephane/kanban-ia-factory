import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadDefinitionCatalog } from './core/definitionLoader';

async function createRoot(prefix: string): Promise<string> {
  return mkdtemp(path.join(tmpdir(), prefix));
}

test('definition loader discovers AGENTS.md, canonical JSON and standard skills', async (t) => {
  const root = await createRoot('orchestrator-definitions-');
  t.after(() => rm(root, { recursive: true, force: true }));

  const skillDirectory = path.join(root, 'skills', 'code-review');
  await mkdir(path.join(skillDirectory, 'references'), { recursive: true });
  await mkdir(path.join(skillDirectory, 'scripts'), { recursive: true });
  await mkdir(path.join(skillDirectory, 'assets'), { recursive: true });
  await mkdir(path.join(root, 'instructions', 'src'), { recursive: true });
  await writeFile(path.join(root, 'AGENTS.md'), 'Use the project conventions.');
  await writeFile(path.join(root, 'instructions', 'src', 'AGENTS.md'), 'Use the source conventions.');
  await writeFile(
    path.join(root, 'instructions', 'coding.json'),
    JSON.stringify({
      schemaVersion: 1,
      id: 'coding',
      version: '1.2.0',
      description: 'Coding rules',
      scope: 'project',
      content: 'Prefer small changes.',
      priority: 2,
      source: { uri: 'untrusted', sha256: '0'.repeat(64), trust: 'managed' },
    }),
  );
  const skillContent = [
    '---',
    'name: code-review',
    'description: >-',
    '  Review changes for actionable bugs and regressions.',
    'metadata:',
    '  version: "2.0.0"',
    '---',
    '',
    'Inspect the diff and report only actionable findings.',
  ].join('\n');
  await writeFile(path.join(skillDirectory, 'SKILL.md'), skillContent);
  await writeFile(path.join(skillDirectory, 'references', 'checklist.md'), 'Read-only checklist.');
  await writeFile(path.join(skillDirectory, 'scripts', 'check.sh'), 'echo check');
  await writeFile(path.join(skillDirectory, 'assets', 'template.md'), '# Report');

  const catalog = await loadDefinitionCatalog([{
    id: 'project',
    path: root,
    trust: 'project',
  }]);

  assert.equal(catalog.instructions.length, 3);
  const agentsInstruction = catalog.instructions.find(({ id }) => id.startsWith('agents.'));
  assert.equal(agentsInstruction?.content, 'Use the project conventions.');
  assert.equal(agentsInstruction?.scope, 'project');
  const nestedInstruction = catalog.instructions.find(({ content }) => content === 'Use the source conventions.');
  assert.deepEqual(nestedInstruction?.appliesWhen, { paths: ['src/**'] });
  const canonicalInstruction = catalog.instructions.find(({ id }) => id === 'coding');
  assert.equal(canonicalInstruction?.source.trust, 'project');
  assert.equal(canonicalInstruction?.source.uri, 'project/instructions/coding.json');
  assert.equal(
    canonicalInstruction?.source.sha256,
    createHash('sha256').update(await readFile(path.join(root, 'instructions', 'coding.json'))).digest('hex'),
  );

  assert.equal(catalog.skills.length, 1);
  assert.equal(catalog.skills[0].id, 'code-review');
  assert.equal(catalog.skills[0].version, '2.0.0');
  assert.equal(catalog.skills[0].description, 'Review changes for actionable bugs and regressions.');
  assert.equal(catalog.skills[0].instructions, 'Inspect the diff and report only actionable findings.');
  assert.deepEqual(catalog.skills[0].resources.map(({ path: resourcePath, kind }) => [resourcePath, kind]), [
    ['assets/template.md', 'asset'],
    ['references/checklist.md', 'reference'],
    ['scripts/check.sh', 'script'],
  ]);
});

test('definition loader rejects malformed JSON, mismatched skill names and duplicate roots', async (t) => {
  const root = await createRoot('orchestrator-invalid-');
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'prompts'), { recursive: true });
  await writeFile(path.join(root, 'prompts', 'bad.json'), '{');
  await assert.rejects(
    loadDefinitionCatalog([{ id: 'managed', path: root, trust: 'managed' }]),
    /Invalid JSON definition managed\/prompts\/bad.json/,
  );

  await rm(path.join(root, 'prompts'), { recursive: true });
  const skillDirectory = path.join(root, 'skills', 'folder-name');
  await mkdir(skillDirectory, { recursive: true });
  await writeFile(path.join(skillDirectory, 'SKILL.md'), [
    '---',
    'name: another-name',
    'description: A valid description.',
    '---',
    'Skill body.',
  ].join('\n'));
  await assert.rejects(
    loadDefinitionCatalog([{ id: 'managed', path: root, trust: 'managed' }]),
    /must match its parent directory/,
  );
  await assert.rejects(loadDefinitionCatalog([
    { id: 'managed', path: root, trust: 'managed' },
    { id: 'managed', path: root, trust: 'project' },
  ]), /Duplicate definition root id/);
});

test('definition loader refuses symbolic links under discovered roots', async (t) => {
  const root = await createRoot('orchestrator-symlink-');
  const outside = await createRoot('orchestrator-outside-');
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });
  await mkdir(path.join(root, 'instructions'), { recursive: true });
  await writeFile(path.join(outside, 'rules.json'), JSON.stringify({
    schemaVersion: 1,
    id: 'rules',
    version: '1.0.0',
    description: 'Rules',
    scope: 'global',
    content: 'Keep safe.',
    priority: 0,
  }));
  await symlink(path.join(outside, 'rules.json'), path.join(root, 'instructions', 'rules.json'));

  await assert.rejects(
    loadDefinitionCatalog([{ id: 'managed', path: root, trust: 'managed' }]),
    /Symbolic links are not allowed/,
  );
});
