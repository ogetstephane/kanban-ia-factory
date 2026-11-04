import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { analyzeProject, readCommittedSources } from './archify-analysis.mjs';

const repository = { url: 'https://github.com/example/project.git', revision: 'a'.repeat(40) };

function fixture() {
  return new Map([
    ['src/App.tsx', `import { lazy } from 'react';
import { Card as TaskCard } from './components';
import { Icon } from 'external-icons';
const LazyDetails = lazy(() => import('./components/Details').then((module) => ({ default: module.Details })));
export default function App() { return <><TaskCard /><LazyDetails /><Icon /></>; }
`],
    ['src/components/index.ts', "export * from './Card';\n"],
    ['src/components/Card.tsx', `import Badge from './Badge';
export function Card() { return <Badge />; }
`],
    ['src/components/Badge.tsx', 'export default function Badge() { return <span />; }\n'],
    ['src/components/Details.tsx', 'export function Details() { return <section />; }\n'],
    ['src/data/client.ts', "export function load(route: string) { return fetch(`/api/board${route}`); }\n"],
    ['server.ts', "import { createApp } from './server/app';\ncreateApp();\n"],
    ['server/app.ts', "import { createBoardRouter } from './routes/board';\nexport function createApp() { app.use('/api/board', createBoardRouter()); return { app }; }\n"],
    ['server/routes/board.ts', "import type { Board } from '../../shared/types/board';\nexport function createBoardRouter() { return {}; }\n"],
    ['shared/types/board.ts', 'export type Board = { id: string };\n'],
  ]);
}

function children(spec, parentLabel) {
  const parent = spec.nodes.find((node) => node.label === parentLabel);
  assert.ok(parent, `missing parent ${parentLabel}`);
  return spec.nodes.filter((node) => node.parent === parent.id);
}

test('automatically detects grouped imports, HTTP links and direct JSX composition', () => {
  const diagrams = analyzeProject(fixture(), repository, {}, 'doc/archify/generated');
  const architecture = diagrams['auto-architecture'];
  const react = diagrams['auto-react'];

  assert.deepEqual(architecture.unresolved, []);
  assert.deepEqual(react.unresolved, []);
  assert.ok(children(architecture.spec, 'src/data').some((node) => node.label === 'HTTP /api/board → server (entrée)'));
  assert.ok(children(architecture.spec, 'server.ts').some((node) => node.label === 'importe server (entrée)'));
  assert.ok(children(architecture.spec, 'server/routes').some((node) => node.label === 'importe shared/types'));
  assert.ok(children(architecture.spec, 'src (entrée)').some((node) => node.label === 'importe src/components'));
  assert.deepEqual(children(react.spec, 'App').map((node) => node.label).sort(), ['rend Card', 'rend Details']);
  const badge = children(react.spec, 'Card').find((node) => node.label === 'rend Badge');
  assert.ok(badge);
  assert.deepEqual(badge.sources, [
    { path: 'src/components/Card.tsx', line: 2 },
    { path: 'src/components/Badge.tsx', line: 1 },
  ]);
  assert.equal(react.spec.meta.repository.revision, repository.revision);
  assert.equal(react.spec.meta.output, 'doc/archify/generated/auto-react.html');
});

test('reanalysis changes relations with the source instead of replaying a fixed model', () => {
  const files = fixture();
  const before = analyzeProject(files, repository, {}, 'generated', ['auto-react'])['auto-react'].spec;
  assert.ok(children(before, 'Card').some((node) => node.label === 'rend Badge'));

  files.set('src/components/Card.tsx', `import { Details } from './Details';
export function Card() { return <Details />; }
`);
  const after = analyzeProject(files, repository, {}, 'generated', ['auto-react'])['auto-react'].spec;
  assert.deepEqual(children(after, 'Card').map((node) => node.label), ['rend Details']);
});

test('reports malformed code and unresolved local JSX rather than inventing links', () => {
  const invalid = fixture();
  invalid.set('src/components/Badge.tsx', 'export function Broken( {');
  assert.throws(() => analyzeProject(invalid, repository, {}, 'generated'), /Cannot parse src\/components\/Badge\.tsx/);

  const unresolved = fixture();
  unresolved.set('src/components/Card.tsx', `import { Missing } from './Badge';
export function Card() { return <Missing />; }
`);
  const result = analyzeProject(unresolved, repository, {}, 'generated', ['auto-react'])['auto-react'];
  assert.deepEqual(result.unresolved, ['src/components/Card.tsx:2 <Missing>']);
  assert.ok(!result.spec.nodes.some((node) => node.label === 'rend Missing'));
});

test('uses Git committed bytes and flags uncommitted application changes', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'archify-analysis-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'src'));
  await mkdir(path.join(root, 'shared'));
  const file = path.join(root, 'src', 'App.tsx');
  await writeFile(file, 'export default function App() { return <div />; }\n');
  const sharedFile = path.join(root, 'shared', 'board.ts');
  await writeFile(sharedFile, 'export type Board = { id: string };\n');
  await writeFile(path.join(root, 'shared', 'board.test.ts'), 'export {};\n');
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
  git('init', '-q');
  git('add', 'src/App.tsx', 'shared');
  git('-c', 'user.name=Archify Test', '-c', 'user.email=archify@example.invalid', 'commit', '-qm', 'Initial source');

  const committed = readCommittedSources(root);
  assert.equal(committed.dirty, false);
  assert.equal(committed.repository.link_mode, 'local-only');
  assert.equal(committed.files.get('shared/board.ts'), 'export type Board = { id: string };\n');
  assert.equal(committed.files.has('shared/board.test.ts'), false);
  await writeFile(sharedFile, 'export type Board = { id: number };\n');
  assert.equal(readCommittedSources(root).dirty, true);
  assert.equal(readCommittedSources(root).files.get('shared/board.ts'), committed.files.get('shared/board.ts'));
  await writeFile(file, 'export default function App() { return <main />; }\n');
  const changed = readCommittedSources(root);
  assert.equal(changed.dirty, true);
  assert.equal(changed.revision, committed.revision);
  assert.equal(changed.files.get('src/App.tsx'), committed.files.get('src/App.tsx'));

  git('add', 'src/App.tsx', 'shared/board.ts');
  git('-c', 'user.name=Archify Test', '-c', 'user.email=archify@example.invalid', 'commit', '-qm', 'Update source');
  const next = readCommittedSources(root);
  assert.equal(next.dirty, false);
  assert.notEqual(next.revision, committed.revision);
  assert.match(next.files.get('src/App.tsx'), /<main/);
});

test('skips sources and uncommitted changes listed in .copilotignore', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'archify-ignore-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'src', 'generated'), { recursive: true });
  await mkdir(path.join(root, 'server', 'fixtures'), { recursive: true });
  await writeFile(path.join(root, 'src', 'App.tsx'), 'export default function App() { return <div />; }\n');
  await writeFile(path.join(root, 'src', 'generated', 'Client.ts'), 'export const client = 1;\n');
  await writeFile(path.join(root, 'server', 'fixtures', 'seed.ts'), 'export const seed = 1;\n');
  await writeFile(path.join(root, 'server', 'secret.ts'), 'export const secret = 1;\n');
  await writeFile(path.join(root, '.copilotignore'), '# generated\nsrc/generated/\nfixtures/\nsecret.ts\n');
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
  git('init', '-q');
  git('add', 'src', 'server');
  git('-c', 'user.name=Archify Test', '-c', 'user.email=archify@example.invalid', 'commit', '-qm', 'Initial source');

  const snapshot = readCommittedSources(root);
  assert.deepEqual([...snapshot.files.keys()], ['src/App.tsx']);
  assert.equal(snapshot.dirty, false);

  await writeFile(path.join(root, 'src', 'generated', 'Client.ts'), 'export const client = 2;\n');
  await writeFile(path.join(root, 'server', 'fixtures', 'new.ts'), 'export const added = 1;\n');
  assert.equal(readCommittedSources(root).dirty, false);
  await writeFile(path.join(root, 'src', 'App.tsx'), 'export default function App() { return <main />; }\n');
  assert.equal(readCommittedSources(root).dirty, true);
});
