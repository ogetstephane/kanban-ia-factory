import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createArchifyRouter } from './archify';

test('archify routes list diagram sources and serve generated pages in a locked-down sandbox', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'archify-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(path.join(directory, 'generated', 'sources'), { recursive: true });
  await writeFile(path.join(directory, 'cache-miss.json'), JSON.stringify({ diagram_type: 'sequence', meta: { title: 'Cache miss' } }));
  await writeFile(path.join(directory, 'generated', 'sources', 'auto-react.json'), JSON.stringify({
    diagram_type: 'tree', meta: { title: 'React', repository: { revision: 'a'.repeat(40) } },
  }));
  await writeFile(path.join(directory, 'pending.json'), JSON.stringify({ diagram_type: 'workflow', meta: { title: 'Pending' } }));
  await writeFile(path.join(directory, 'broken.json'), '{');
  await writeFile(path.join(directory, 'Not_Valid.json'), '{}');
  await writeFile(path.join(directory, 'notes.md'), '# not a diagram');
  await writeFile(path.join(directory, 'generated', 'cache-miss.html'), '<html><script>draw()</script></html>');

  const app = express();
  app.use('/api/board', createArchifyRouter(directory));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}/api/board/archify`;

  const listed = await fetch(base);
  assert.equal(listed.status, 200);
  assert.equal(listed.headers.get('cache-control'), 'no-store');
  const { diagrams } = await listed.json();
  assert.deepEqual(diagrams.map(({ id, title, type, generatedAt }: Record<string, unknown>) => [id, title, type, typeof generatedAt]), [
    ['auto-react', 'React', 'tree', 'object'],
    ['broken', 'broken', 'unknown', 'object'],
    ['cache-miss', 'Cache miss', 'sequence', 'string'],
    ['pending', 'Pending', 'workflow', 'object'],
  ]);
  assert.equal(diagrams[0].origin, 'analysis');
  assert.equal(diagrams[0].revision, 'a'.repeat(40));
  assert.equal(diagrams[2].origin, 'manual');
  assert.equal(diagrams[2].revision, null);

  const view = await fetch(`${base}/cache-miss/view`);
  assert.equal(view.status, 200);
  assert.match(view.headers.get('content-type') ?? '', /text\/html/);
  const policy = view.headers.get('content-security-policy') ?? '';
  assert.match(policy, /sandbox allow-scripts allow-downloads/);
  assert.match(policy, /connect-src 'none'/);
  assert.match(policy, /frame-ancestors 'self'/);
  assert.doesNotMatch(policy, /allow-same-origin/);
  assert.equal(await view.text(), '<html><script>draw()</script></html>');

  const pending = await fetch(`${base}/pending/view`);
  assert.equal(pending.status, 404);
  assert.match((await pending.json()).error, /make archify/);
  assert.equal((await fetch(`${base}/..%2Fsecret/view`)).status, 404);

  const empty = createArchifyRouter(path.join(directory, 'absent'));
  const emptyApp = express().use('/api/board', empty);
  const emptyServer = emptyApp.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => emptyServer.once('listening', resolve));
  t.after(() => new Promise<void>((resolve) => emptyServer.close(() => resolve())));
  const emptyAddress = emptyServer.address();
  assert.ok(emptyAddress && typeof emptyAddress !== 'string');
  assert.deepEqual(await (await fetch(`http://127.0.0.1:${emptyAddress.port}/api/board/archify`)).json(), { diagrams: [] });
});
