import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createCodeGraphRouter } from './codeGraph';
import { EntityError } from '../db/entityStore';
import { RepositoryError } from '../git/repositoryService';
import type { CodeGraph } from '../agents/codeGraph';

test('code graph routes return snapshots, rebuild on request and serve a locked-down visualization', async (t) => {
  const calls: { cwd: string; rebuild?: boolean }[] = [];
  const snapshot = { generatedAt: '2026-11-03T10:00:00.000Z', commit: 'abc', report: '# Graph Report', visualization: true };
  const graph = {
    async snapshot(cwd: string, options: { rebuild?: boolean }) {
      calls.push({ cwd, rebuild: options.rebuild });
      if (cwd === '/broken') throw new RepositoryError(503, 'Graphify is not installed on the server.');
      return snapshot;
    },
    async visualization(cwd: string) { return cwd === '/clone' ? '<html><script>graph()</script></html>' : undefined; },
  } as unknown as CodeGraph;
  const clones: Record<string, string> = { p1: '/clone', empty: '/empty', broken: '/broken' };
  const app = express();
  app.use('/api/board', createCodeGraphRouter(graph, async (id) => {
    if (!clones[id]) throw new EntityError(404, 'Project not found');
    return clones[id];
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}/api/board/projects`;

  const loaded = await fetch(`${base}/p1/code-graph`);
  assert.equal(loaded.status, 200);
  assert.equal(loaded.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await loaded.json(), snapshot);
  assert.equal((await fetch(`${base}/p1/code-graph/rebuild`, { method: 'POST' })).status, 200);
  assert.deepEqual(calls, [{ cwd: '/clone', rebuild: false }, { cwd: '/clone', rebuild: true }]);

  const view = await fetch(`${base}/p1/code-graph/view`);
  assert.equal(view.status, 200);
  assert.match(view.headers.get('content-type') ?? '', /text\/html/);
  const policy = view.headers.get('content-security-policy') ?? '';
  assert.match(policy, /sandbox allow-scripts/);
  assert.match(policy, /connect-src 'none'/);
  assert.match(policy, /frame-ancestors 'self'/);
  assert.doesNotMatch(policy, /allow-same-origin/);
  assert.equal(await view.text(), '<html><script>graph()</script></html>');

  const missing = await fetch(`${base}/empty/code-graph/view`);
  assert.equal(missing.status, 404);
  assert.match((await missing.json()).error, /Build the graph first/);
  assert.equal((await fetch(`${base}/unknown/code-graph`)).status, 404);
  const broken = await fetch(`${base}/broken/code-graph`);
  assert.equal(broken.status, 503);
  assert.match((await broken.json()).error, /not installed/);
});
