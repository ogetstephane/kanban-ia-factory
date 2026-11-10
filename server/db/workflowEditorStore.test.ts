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
  for (const scope of ['ticket-authoring', 'ticket-processing', 'wiki'] as const) {
    const before = await new WorkflowEditorStore(db).get(scope);
    response = await request('/current-orchestration', 'GET', undefined, scope);
    assert.equal(response.status, 200);
    const reference = await response.json();
    assert.equal(reference.runtimeReference.scope, scope);
    assert.deepEqual(await new WorkflowEditorStore(db).get(scope), before, 'Import preview must not overwrite saved drafts, selections or versions');
    assert.equal((await request('', 'PUT', { revision: before.revision, document: {
      ...reference, edges: reference.edges.slice(1),
    } }, scope)).status, 400);
    assert.equal((await request('', 'PUT', { revision: before.revision, document: {
      ...reference, operations: reference.operations.map((operation: { policy: string }) => ({ ...operation, policy: 'Bypass approvals' })),
    } }, scope)).status, 400);
    assert.equal((await request('', 'PUT', { revision: before.revision, document: {
      ...reference, agents: reference.agents.map((agent: { tools: string[] }) => ({ ...agent, tools: ['arbitrary_shell'] })),
    } }, scope)).status, 400);
    response = await request('', 'PUT', { revision: before.revision, document: reference }, scope);
    assert.equal(response.status, 200);
    const imported = workflowEditorStateSchema.parse(await response.json());
    assert.deepEqual(imported.versions, before.versions);
    assert.equal(imported.selectedVersionId, before.selectedVersionId);
    assert.equal((await request('', 'PUT', { revision: before.revision, document: reference }, scope)).status, 409);
    response = await request('/publish', 'POST', { revision: imported.revision }, scope);
    assert.equal(response.status, 200);
    const published = workflowEditorStateSchema.parse(await response.json());
    assert.deepEqual(published.versions.slice(1), before.versions);
    const resolved = await (await request('/resolve', 'POST', {}, scope)).json();
    assert.equal(resolved.runtimeConnected, false);
    assert.deepEqual(resolved.version.document.runtimeReference, reference.runtimeReference);
  }
  assert.equal((await request('/current-orchestration', 'GET', undefined, 'releases')).status, 200);
  const wikiReference = await new WorkflowEditorStore(db).currentOrchestration('wiki');
  await assert.rejects(new WorkflowEditorStore(db).save('ticket-authoring', 0, wikiReference), /scope does not match/);
  const store = new WorkflowEditorStore(db);
  await assert.rejects(store.activate('ticket-authoring', state.revision, originalVersion.id), { status: 422 });
  for (const scope of WORKFLOW_SCOPES) {
    const before = await store.get(scope);
    const base = await (await request('/base', 'GET', undefined, scope)).json();
    assert.equal(base.execution.scope, scope);
    assert.deepEqual(await store.get(scope), before, 'Reading the base never overwrites existing work');
    const initial = await store.active(scope);
    assert.equal(initial.versionId, null);
    const draft = { ...base, name: 'New active workflow' };
    if (draft.prompts.length) draft.prompts[0].template = 'Use the company terminology.';
    let updated = await store.save(scope, before.revision, draft);
    updated = await store.publish(scope, updated.revision);
    assert.equal(updated.activeVersionId, null, 'Publishing must not activate');
    const version = updated.versions[0];
    assert.equal((await store.active(scope)).versionId, null);
    assert.equal((await request('/activate', 'POST', { revision: 0, versionId: version.id }, scope)).status, 409);
    if (scope !== 'wiki') await assert.rejects(store.activate('wiki', updated.revision, version.id), { status: 404 });
    response = await request('/activate', 'POST', { revision: updated.revision, versionId: version.id }, scope);
    assert.equal(response.status, 200);
    updated = workflowEditorStateSchema.parse(await response.json());
    assert.equal(updated.activeVersionId, version.id);
    const pinned = await store.active(scope);
    assert.deepEqual(pinned.document, draft);
    assert.equal((await store.resolve(scope, version.id)).runtimeConnected, true);
    updated = await store.save(scope, updated.revision, { ...draft, name: 'Unpublished changes' });
    updated = await store.publish(scope, updated.revision);
    assert.equal(updated.activeVersionId, version.id, 'Publishing a later version leaves the active version unchanged');
    assert.deepEqual(await store.active(scope), pinned);
    updated = await store.activate(scope, updated.revision, updated.versions[0].id);
    assert.equal((await store.active(scope)).document.name, 'Unpublished changes');
    updated = await store.activate(scope, updated.revision, null);
    assert.equal((await store.active(scope)).versionId, null);
    assert.equal(updated.draft.name, 'Unpublished changes', 'Restoring the active base preserves the draft');
    assert.equal(pinned.versionId, version.id);
    assert.equal(pinned.document.name, 'New active workflow', 'Pinned snapshots survive activation changes');
    assert.ok(updated.versions.some((item) => item.id === version.id));
    if (scope !== 'releases') {
      const incompatible = structuredClone(draft);
      incompatible.agents[0].provider = 'codex';
      updated = await store.save(scope, updated.revision, incompatible);
      updated = await store.publish(scope, updated.revision);
      await assert.rejects(store.activate(scope, updated.revision, updated.versions[0].id), { status: 422 });
      assert.equal((await store.active(scope)).versionId, null);
    }
  }
});
