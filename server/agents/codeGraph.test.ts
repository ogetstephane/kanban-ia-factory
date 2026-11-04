import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmod, mkdtemp, readFile, readdir, rm, writeFile, mkdir, stat, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CodeGraph, trimGraphReport } from './codeGraph';

const REPORT = [
  '# Graph Report - out  (2026-11-03)', '', '## Summary', '- 3 nodes', '',
  '## Community Hubs (Navigation)', '- Community 0', '- Community 1', '',
  '## God Nodes (most connected - your core abstractions)', '1. `SessionService` - 3 edges', '',
].join('\n');

const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@e.st', ...args], { cwd, stdio: 'pipe' });

async function fakeGraphify(t: test.TestContext) {
  const dir = await mkdtemp(path.join(tmpdir(), 'kanban-graphify-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const log = path.join(dir, 'calls.jsonl');
  const binary = path.join(dir, 'graphify');
  await writeFile(binary, `#!${process.execPath}
const fs = require('node:fs'); const path = require('node:path');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ args, env: Object.keys(process.env) }) + '\\n');
if (args[0] === 'extract') {
  if (fs.existsSync(path.join(args[1], 'FAIL'))) { console.error('boom'); process.exit(1); }
  const out = path.join(args[args.indexOf('--out') + 1], 'graphify-out');
  fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(path.join(out, 'graph.json'), '{}');
} else if (args[0] === 'cluster-only') {
  fs.writeFileSync(path.join(args[1], 'graphify-out', 'GRAPH_REPORT.md'), ${JSON.stringify(REPORT)});
  if (!args.includes('--no-viz')) fs.writeFileSync(path.join(args[1], 'graphify-out', 'graph.html'), '<html>graph</html>');
} else if (args[1] === 'Unknown') { console.log("No node matching 'Unknown' found."); process.exit(4); }
else if (args[1] === 'Crash') { console.error('kaboom'); process.exit(2); }
else console.log('answer:' + args.join(' '));
`);
  await chmod(binary, 0o755);
  const calls = async () => (await readFile(log, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean)
    .map((line) => JSON.parse(line) as { args: string[]; env: string[] });
  const workspace = path.join(dir, 'worktree');
  await mkdir(workspace);
  return { dir, binary, calls, workspace, cacheDir: path.join(dir, 'cache') };
}

test('trimGraphReport drops the placeholder navigation list and caps the report', () => {
  const trimmed = trimGraphReport(REPORT);
  assert.doesNotMatch(trimmed, /Community Hubs|Community 1/);
  assert.match(trimmed, /^# Graph Report\n/);
  assert.match(trimmed, /God Nodes/);
  assert.match(trimGraphReport(`## Summary\n${'x'.repeat(20_000)}`), /Graph report truncated/);
});

test('agent graphs are code-only, built outside the worktree without API keys, queryable and disposable', async (t) => {
  const { binary, calls, workspace, cacheDir } = await fakeGraphify(t);
  process.env.GEMINI_API_KEY = 'secret-for-test';
  t.after(() => { delete process.env.GEMINI_API_KEY; });

  const graph = await new CodeGraph({ binary, cacheDir }).prepare(workspace);
  assert.ok(graph);
  assert.match(graph.report, /SessionService/);
  assert.doesNotMatch(graph.report, /Community Hubs/);

  const [extract, cluster] = await calls();
  assert.deepEqual(extract.args.slice(0, 4), ['extract', workspace, '--code-only', '--force']);
  const staging = extract.args[extract.args.indexOf('--out') + 1];
  assert.ok(staging.startsWith(`${cacheDir}${path.sep}`));
  assert.deepEqual(cluster.args, ['cluster-only', staging, '--no-viz', '--no-label']);
  for (const call of await calls()) assert.ok(!call.env.includes('GEMINI_API_KEY'));
  assert.deepEqual(await readdir(workspace), [], 'nothing is written into the worktree');

  const [output] = await readdir(cacheDir);
  const graphFile = path.join(cacheDir, output, 'graphify-out', 'graph.json');
  assert.equal(await graph.query('how are sessions approved?', 99_999), `answer:query how are sessions approved? --budget 6000 --graph ${graphFile}`);
  assert.equal(await graph.path('A', 'B'), `answer:path A B --undirected --graph ${graphFile}`);
  assert.match(await graph.explain('Unknown'), /No node matching/);
  await assert.rejects(graph.affected('Crash'), /kaboom/);
  await assert.rejects(graph.explain('--all'), /must not start with "-"/);
  await assert.rejects(graph.query('   '), /1 to 200/);

  await graph.dispose();
  assert.deepEqual(await readdir(cacheDir), []);
});

test('concurrent drafts using the same workspace own separate graphs and cleanup', async (t) => {
  const { binary, workspace, cacheDir } = await fakeGraphify(t);
  const service = new CodeGraph({ binary, cacheDir });
  const [first, second] = await Promise.all([service.prepare(workspace), service.prepare(workspace)]);
  assert.ok(first && second);
  assert.equal((await readdir(cacheDir)).length, 2);
  await first.dispose();
  const [remaining] = await readdir(cacheDir);
  assert.ok(remaining);
  await stat(path.join(cacheDir, remaining, 'graphify-out', 'graph.json'));
  assert.match(await second.query('dependencies'), /answer:query/);
  await second.dispose();
  assert.deepEqual(await readdir(cacheDir), []);
});

test('project snapshots include the visualization and are rebuilt only for a new commit or on request', async (t) => {
  const { binary, calls, workspace, cacheDir } = await fakeGraphify(t);
  git(workspace, 'init', '-q');
  await writeFile(path.join(workspace, 'a.ts'), 'export const a = 1;\n');
  git(workspace, 'add', '.'); git(workspace, 'commit', '-qm', 'one');
  const graph = new CodeGraph({ binary, cacheDir });
  const extracts = async () => (await calls()).filter((call) => call.args[0] === 'extract').length;

  assert.equal(await graph.visualization(workspace), undefined);
  const first = await graph.snapshot(workspace);
  assert.equal(first.visualization, true);
  assert.match(first.commit ?? '', /^[0-9a-f]{40}$/);
  assert.match(first.report, /God Nodes/);
  assert.equal(await graph.visualization(workspace), '<html>graph</html>');
  assert.ok((await calls()).some((call) => call.args[0] === 'cluster-only' && !call.args.includes('--no-viz')));
  const published = path.join(workspace, 'graphify-out');
  assert.equal(await readFile(path.join(published, 'graph.json'), 'utf8'), '{}');
  assert.equal(await readFile(path.join(published, 'GRAPH_REPORT.md'), 'utf8'), REPORT);
  assert.equal(await readFile(path.join(published, 'graph.html'), 'utf8'), '<html>graph</html>');
  const extract = (await calls()).find((call) => call.args[0] === 'extract')!;
  assert.ok(extract.args.includes('graphify-out/'));

  await rm(path.join(published, 'graph.json'));
  await writeFile(path.join(published, 'graph.html'), 'outdated');
  await writeFile(path.join(published, 'notes.txt'), 'keep this');

  assert.deepEqual(await graph.snapshot(workspace), first);
  assert.equal(await extracts(), 1, 'same commit reuses the graph');
  assert.equal(await readFile(path.join(published, 'graph.json'), 'utf8'), '{}', 'missing output is restored from cache');
  assert.equal(await readFile(path.join(published, 'graph.html'), 'utf8'), '<html>graph</html>');
  assert.equal(await readFile(path.join(published, 'notes.txt'), 'utf8'), 'keep this');
  const html = path.join(published, 'graph.html');
  await utimes(html, new Date(0), new Date(0));
  const unchanged = await stat(html);
  await graph.snapshot(workspace);
  assert.equal((await stat(html)).mtimeMs, unchanged.mtimeMs, 'cached snapshots must not rewrite identical files or trigger reloads');
  await Promise.all([graph.snapshot(workspace, { rebuild: true }), graph.snapshot(workspace, { rebuild: true })]);
  assert.equal(await extracts(), 2, 'concurrent rebuilds are shared');
  assert.equal((await stat(html)).mtimeMs, unchanged.mtimeMs, 'identical rebuild output must not rewrite published files');

  git(workspace, 'commit', '-q', '--allow-empty', '-m', 'two');
  const next = await graph.snapshot(workspace);
  assert.notEqual(next.commit, first.commit);
  assert.equal(await extracts(), 3);
  assert.equal((await readdir(cacheDir)).length, 1, 'staging folders are cleaned up');
});

test('project graph publication failures are explicit and leave the cache available for retry', async (t) => {
  const { binary, calls, workspace, cacheDir } = await fakeGraphify(t);
  const published = path.join(workspace, 'graphify-out');
  await writeFile(published, 'not a directory');
  const graph = new CodeGraph({ binary, cacheDir });
  await assert.rejects(graph.snapshot(workspace), { status: 503, message: /Unable to build the code graph/ });
  assert.equal(await readFile(published, 'utf8'), 'not a directory');
  await rm(published);
  assert.equal((await graph.snapshot(workspace)).visualization, true);
  assert.equal(await readFile(path.join(published, 'graph.json'), 'utf8'), '{}');
  assert.equal((await calls()).filter((call) => call.args[0] === 'extract').length, 1);
});

test('graph failures are optional for agents but explicit for the project view', async (t) => {
  const { dir, binary, workspace } = await fakeGraphify(t);
  await writeFile(path.join(workspace, 'FAIL'), '');
  t.mock.method(console, 'warn', () => undefined);
  assert.equal(await new CodeGraph({ binary, cacheDir: dir }).prepare(workspace), undefined);
  await assert.rejects(new CodeGraph({ binary, cacheDir: dir }).snapshot(workspace), { status: 503, message: /Unable to build the code graph: graphify extract failed \(1\): boom/ });
  await assert.rejects(new CodeGraph({ binary: path.join(dir, 'missing'), cacheDir: dir }).snapshot(workspace), { status: 503, message: /not installed/ });
  await assert.rejects(new CodeGraph({ binary, cacheDir: dir, enabled: false }).snapshot(workspace), { status: 503, message: /disabled/ });
  assert.equal(await new CodeGraph({ binary: path.join(dir, 'missing'), cacheDir: dir }).prepare(workspace), undefined);
  assert.equal(await new CodeGraph({ binary, cacheDir: dir, enabled: false }).prepare(workspace), undefined);
  assert.equal(CodeGraph.fromEnv({ GRAPHIFY_ENABLED: 'false' }).enabled, false);
  assert.equal(CodeGraph.fromEnv({}).enabled, true);
});

let realGraphify = false;
try { execFileSync(process.env.GRAPHIFY_BIN || 'graphify', ['--help'], { stdio: 'ignore' }); realGraphify = true; } catch { /* optional */ }

test('real Graphify maps a small repository', { skip: !realGraphify && 'graphify is not installed' }, async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'kanban-graphify-real-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const workspace = path.join(dir, 'repo');
  await mkdir(workspace);
  await writeFile(path.join(workspace, 'store.ts'), 'export class TicketStore { save() { return 1; } }\n');
  await writeFile(path.join(workspace, 'service.ts'), "import { TicketStore } from './store';\nexport class TicketService { run() { return new TicketStore().save(); } }\n");
  await mkdir(path.join(workspace, 'node_modules', 'dep'), { recursive: true });
  await writeFile(path.join(workspace, 'node_modules', 'dep', 'index.ts'), 'export class DependencyInternals {}\n');
  const code = new CodeGraph({ binary: process.env.GRAPHIFY_BIN, cacheDir: path.join(dir, 'cache') });
  const graph = await code.prepare(workspace);
  assert.ok(graph, 'graph should be built');
  assert.match(graph.report, /Graph Report/);
  assert.match(await graph.explain('TicketService'), /TicketService/);
  assert.doesNotMatch(await graph.query('DependencyInternals'), /DependencyInternals\(|node_modules/);
  const snapshot = await code.snapshot(workspace);
  assert.equal(snapshot.visualization, true);
  assert.match(await code.visualization(workspace) ?? '', /vis-network[\s\S]*TicketService/);
  assert.doesNotMatch(await code.visualization(workspace) ?? '', /DependencyInternals|node_modules/);
  assert.deepEqual((await readdir(workspace)).sort(), ['graphify-out', 'node_modules', 'service.ts', 'store.ts']);
  assert.equal(await readFile(path.join(workspace, 'graphify-out', 'graph.html'), 'utf8'), await code.visualization(workspace));
  const publishedGraph = JSON.parse(await readFile(path.join(workspace, 'graphify-out', 'graph.json'), 'utf8'));
  assert.ok(publishedGraph.nodes.length > 0);
  await graph.dispose();
  assert.equal(await readFile(path.join(workspace, 'graphify-out', 'graph.html'), 'utf8'), await code.visualization(workspace));
});
