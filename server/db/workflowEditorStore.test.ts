import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import express from 'express';
import { WorkflowEditorStore } from './workflowEditorStore';
import { createWorkflowEditorRouter } from '../routes/workflowEditor';
import { documentFixture } from '../../shared/types/workflowEditor.fixture';
import { WORKFLOW_SCOPES, workflowEditorStateSchema } from '../../shared/types/workflowEditor';

test('workflow API persists scoped drafts and immutable versions with optimistic concurrency, without running hooks', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'kanban-workflow-editor-'));
  const databaseUrl = `file:${path.join(directory, 'test.db')}`;
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: 'pipe', timeout: 30_000,
  });
  let db = new PrismaClient({ datasourceUrl: databaseUrl });
  const app = express(); app.use(express.json({ limit: '1mb' }));
  app.use('/api/board', createWorkflowEditorRouter(new WorkflowEditorStore(db)));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await db.$disconnect(); await rm(directory, { recursive: true, force: true });
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const request = async (route = '', method = 'GET', body?: unknown, scope = 'ticket-authoring') => fetch(
    `http://127.0.0.1:${address.port}/api/board/workflow-editor/${scope}${route}`,
    { method, headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) },
  );
  for (const scope of WORKFLOW_SCOPES) {
    const response = await request('', 'GET', undefined, scope);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    const state = workflowEditorStateSchema.parse(await response.json());
    assert.equal(state.scope, scope); assert.equal(state.revision, 0); assert.equal(state.versions.length, 0);
  }
  assert.equal(await db.workflowConfiguration.count(), 0, 'GET must not write configurations');
  assert.equal((await request('', 'GET', undefined, 'unknown')).status, 400);
  assert.equal((await request('/resolve', 'POST', {})).status, 404);
  assert.equal((await request('', 'PUT', { revision: 0, document: { ...documentFixture(), edges: [] } })).status, 400);
  let response = await request('', 'PUT', { revision: 0, document: documentFixture() });
  assert.equal(response.status, 200);
  let state = workflowEditorStateSchema.parse(await response.json());
  assert.equal(state.revision, 1);
  assert.equal((await request('', 'PUT', { revision: 0, document: documentFixture() })).status, 409);
  assert.equal((await request('/publish', 'POST', { revision: 0 })).status, 409);
  response = await request('/publish', 'POST', { revision: 1 });
  state = workflowEditorStateSchema.parse(await response.json());
  assert.equal(state.versions.length, 1);
  const originalVersion = state.versions[0];
  assert.equal(state.selectedVersionId, originalVersion.id);
  const snapshot = await (await request('/resolve', 'POST', {})).json();
  assert.equal(snapshot.runtimeConnected, false);
  assert.deepEqual(snapshot.version.document, documentFixture());
  response = await request('', 'PUT', { revision: state.revision, document: { ...documentFixture(), name: 'Second design' } });
  state = workflowEditorStateSchema.parse(await response.json());
  response = await request('/publish', 'POST', { revision: state.revision });
  state = workflowEditorStateSchema.parse(await response.json());
  assert.equal(state.versions[0].number, 2);
  assert.deepEqual(state.versions[1], originalVersion);
  assert.equal((await request('/select', 'POST', { revision: state.revision, versionId: originalVersion.id }, 'wiki')).status, 404);
  const selected = await request('/select', 'POST', { revision: state.revision, versionId: originalVersion.id });
  state = workflowEditorStateSchema.parse(await selected.json());
  assert.equal(state.selectedVersionId, originalVersion.id);
  assert.equal(state.draft.name, 'Second design', 'Restoring defaults must not overwrite drafts');
  assert.equal((await request('/select', 'POST', { revision: 1, versionId: originalVersion.id })).status, 409);
  assert.deepEqual(snapshot.version, originalVersion, 'Existing launch snapshots must not change on selection');
  assert.equal((await request('/resolve', 'POST', { versionId: state.versions[0].id })).status, 200);
  await db.$disconnect(); db = new PrismaClient({ datasourceUrl: databaseUrl });
  const restored = await new WorkflowEditorStore(db).get('ticket-authoring');
  assert.equal(restored.selectedVersionId, originalVersion.id);
  assert.deepEqual(restored.versions[1], originalVersion);
  assert.equal((await new WorkflowEditorStore(db).get('wiki')).revision, 0);
});
