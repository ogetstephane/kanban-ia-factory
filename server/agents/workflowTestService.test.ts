import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import express from 'express';
import { WorkflowEditorStore } from '../db/workflowEditorStore';
import { WorkflowTestService, type WorkflowTestAgentExecutor } from './workflowTestService';
import { createWorkflowTestRouter } from '../routes/workflowTests';
import { documentFixture } from '../../shared/types/workflowEditor.fixture';
import { workflowDocumentSchema, type WorkflowDocument } from '../../shared/types/workflowEditor';
import { workflowTestRunSchema, type WorkflowJsonObject, type WorkflowTestLaunch, type WorkflowTestRun } from '../../shared/types/workflowTestRun';

const mock = (output: WorkflowJsonObject = { ticket: 'Exact user mock' }, delayMs = 0) => ({
  mode: 'mock' as const, delayMs, response: { kind: 'output' as const, output },
});

test('preview runner persists isolated real/mock execution, controls and API failures without live AI', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'kanban-preview-test-'));
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: `file:${path.join(directory, 'test.db')}` }, timeout: 30_000, stdio: 'pipe',
  });
  const db = new PrismaClient({ datasourceUrl: `file:${path.join(directory, 'test.db')}` });
  const calls: Parameters<WorkflowTestAgentExecutor['execute']>[0][] = [];
  const executor: WorkflowTestAgentExecutor = {
    providers: ['copilot'],
    execute: async (request) => {
      calls.push(request);
      if (request.prompt.includes('provider failure')) throw new Error('Configured real-provider failure');
      return { title: 'Real adapter test double', evidence: request.input };
    },
  };
  let service = new WorkflowTestService(db, executor);
  await service.start();
  const store = new WorkflowEditorStore(db);
  const publish = async (document: WorkflowDocument) => {
    const state = await store.get('ticket-authoring');
    const saved = await store.save('ticket-authoring', state.revision, document);
    return (await store.publish('ticket-authoring', saved.revision)).versions[0];
  };
  const initial = await publish(documentFixture());
  const configuration = (versionId = initial.id): WorkflowTestLaunch => ({
    versionId, input: { request: 'Design a ticket' }, agents: { writer: mock() }, authorizeRealAgents: false,
  });
  const wait = async (id: string, predicate: (run: WorkflowTestRun) => boolean) => {
    for (let attempt = 0; attempt < 150; attempt++) {
      const run = await service.get('ticket-authoring', id);
      if (predicate(run)) return run;
      await delay(10);
    }
    assert.fail(`Test run ${id} did not reach expected state.`);
  };
  const app = express(); app.use(express.json()); app.use('/api/board', createWorkflowTestRouter(service));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  t.after(async () => {
    await service.stop(); server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await db.$disconnect(); await rm(directory, { recursive: true, force: true });
  });
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const request = (suffix = '', method = 'GET', body?: unknown, scope = 'ticket-authoring') => fetch(
    `http://127.0.0.1:${address.port}/api/board/workflow-editor/${scope}/test-runs${suffix}`,
    { method, headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) },
  );

  await t.test('rejects invalid configuration, absent consent and unsupported real providers before creating runs', async () => {
    assert.equal((await request('', 'POST', { ...configuration(), agents: {} })).status, 400);
    assert.equal((await request('', 'POST', { ...configuration(), agents: { writer: mock(), typo: mock() } })).status, 400);
    assert.equal((await request('', 'POST', { ...configuration(), input: {} })).status, 400);
    assert.equal((await request('', 'POST', { ...configuration(), agents: { writer: { mode: 'real' } } })).status, 400);
    assert.equal((await request('', 'POST', { ...configuration(), agents: { writer: mock({}, -1) } })).status, 400);
    assert.equal((await request('', 'POST', configuration(), 'wiki')).status, 404);
    assert.equal((await request('', 'GET', undefined, 'unknown')).status, 400);
    const response = await request('/options');
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.deepEqual(await response.json(), { realProviders: ['copilot'], previewOnly: true });
    const doc = documentFixture(); doc.agents[0].provider = 'inherit';
    const unsupported = workflowDocumentSchema.parse({ ...doc, agents: [{ ...doc.agents[0], provider: 'codex' }] });
    const version = await publish(unsupported);
    assert.equal((await request('', 'POST', {
      ...configuration(version.id), authorizeRealAgents: true, agents: { writer: { mode: 'real' } },
    })).status, 422);
    assert.equal(await db.workflowTestRun.count(), 0);
    assert.equal(calls.length, 0);
  });

  await t.test('mocks return exact JSON, scripts are skipped, approvals pause and versions remain pinned', async () => {
    const response = await request('', 'POST', configuration());
    assert.equal(response.status, 200);
    const launched = workflowTestRunSchema.parse(await response.json());
    let run = await wait(launched.id, (run) => run.status === 'waiting');
    assert.deepEqual(run.steps[0].output, configuration().agents.writer.mode === 'mock' ? { ticket: 'Exact user mock' } : {});
    assert.equal(run.steps[1].status, 'skipped');
    assert.match(run.steps[1].note!, /scripts are disabled/);
    assert.equal(calls.length, 0);
    assert.equal(run.steps[2].status, 'waiting');
    const nextVersion = await publish({ ...documentFixture(), name: 'Changed after launch' });
    const state = await store.get('ticket-authoring');
    await store.select('ticket-authoring', state.revision, nextVersion.id);
    assert.equal(run.document.name, 'Authoring');
    assert.equal((await request(`/${run.id}/approve`, 'POST', { revision: run.revision - 1, nodeId: 'review' })).status, 409);
    assert.equal((await request(`/${run.id}/approve`, 'POST', { revision: run.revision, nodeId: 'writer' })).status, 409);
    assert.equal((await request(`/${run.id}`, 'GET', undefined, 'wiki')).status, 404);
    const approval = await request(`/${run.id}/approve`, 'POST', { revision: run.revision, nodeId: 'review' });
    assert.equal(approval.status, 200);
    run = await wait(run.id, (run) => run.status === 'completed');
    assert.equal(run.versionId, initial.id);
    assert.equal(run.previewOnly, true);
    assert.equal(await db.task.count(), 0);
    assert.deepEqual((await readdir(directory)).filter((name) => !name.startsWith('test.db')), []);
  });

  await t.test('mixed runs honor dependencies and joins even when document node order is reversed', async () => {
    const doc = documentFixture();
    const nodes = [
      { ...doc.nodes[0], id: 'source' },
      { ...doc.nodes[0], id: 'left' }, { ...doc.nodes[0], id: 'right' },
      { ...doc.nodes[0], id: 'join' },
    ].reverse();
    const version = await publish({ ...doc, nodes, edges: [
      { from: 'source', to: 'left' }, { from: 'source', to: 'right' },
      { from: 'left', to: 'join' }, { from: 'right', to: 'join' },
    ] });
    const before = calls.length;
    const launched = await service.launch('ticket-authoring', {
      versionId: version.id, input: { request: 'Custom task' }, authorizeRealAgents: true,
      agents: { source: mock(), left: { mode: 'real' }, right: mock({ ticket: 'Second branch' }), join: { mode: 'real' } },
    });
    const run = await wait(launched.id, (run) => run.status === 'completed');
    assert.equal(calls.length, before + 2);
    assert.equal(calls[before].prompt, 'Draft Custom task');
    assert.deepEqual(calls[before].skills, ['Preserve user intent.']);
    assert.deepEqual(calls[before].input.upstream, { source: { ticket: 'Exact user mock' } });
    const upstream = calls[before + 1].input.upstream;
    assert.ok(upstream && typeof upstream === 'object' && !Array.isArray(upstream));
    assert.deepEqual(upstream.right, { ticket: 'Second branch' });
    assert.ok(upstream.left);
    assert.equal(run.steps.find((step) => step.nodeId === 'left')!.mode, 'real');
    assert.equal(run.steps.find((step) => step.nodeId === 'right')!.mode, 'mock');
  });

  await t.test('mock failures stop dependents and delays are cancellable without late success', async () => {
    const launched = await service.launch('ticket-authoring', {
      ...configuration(), agents: { writer: { mode: 'mock', delayMs: 0, response: { kind: 'error', error: 'Chosen mock error' } } },
    });
    const failed = await wait(launched.id, (run) => run.status === 'failed');
    assert.equal(failed.steps[0].error, 'Chosen mock error');
    assert.equal(failed.steps[1].status, 'skipped');
    assert.equal(failed.steps[2].status, 'skipped');
    const slow = await service.launch('ticket-authoring', { ...configuration(), agents: { writer: mock({}, 30_000) } });
    let running = await wait(slow.id, (run) => run.steps[0].status === 'running');
    running = await service.cancel('ticket-authoring', running.id, running.revision);
    assert.equal(running.status, 'cancelled');
    await delay(30);
    assert.equal((await service.get('ticket-authoring', slow.id)).status, 'cancelled');
    assert.equal((await request(`/${slow.id}/cancel`, 'POST', { revision: running.revision })).status, 409);
  });

  await t.test('mock delay is honored and real-provider errors never fall back to mocks', async () => {
    const started = Date.now();
    const delayed = await service.launch('ticket-authoring', { ...configuration(), agents: { writer: mock({}, 60) } });
    const waiting = await wait(delayed.id, (run) => run.status === 'waiting');
    assert.ok(Date.now() - started >= 60);
    await service.cancel('ticket-authoring', waiting.id, waiting.revision);
    const real = await service.launch('ticket-authoring', {
      ...configuration(), input: { request: 'provider failure' }, agents: { writer: { mode: 'real' } }, authorizeRealAgents: true,
    });
    const failed = await wait(real.id, (run) => run.status === 'failed');
    assert.equal(failed.steps[0].mode, 'real');
    assert.equal(failed.steps[0].error, 'Configured real-provider failure');
    assert.equal(failed.steps[0].output, undefined);
  });

  await t.test('concurrent launches enforce four slots including starting requests', async () => {
    await delay(20);
    const attempts = await Promise.allSettled(Array.from({ length: 6 }, () =>
      service.launch('ticket-authoring', { ...configuration(), agents: { writer: mock({}, 30_000) } })));
    const accepted = attempts.filter((result) => result.status === 'fulfilled');
    assert.equal(accepted.length, 4);
    for (const result of attempts) {
      if (result.status === 'rejected') assert.equal(result.reason.status, 429);
      else {
        const running = await wait(result.value.id, (run) => run.steps[0].status === 'running');
        await service.cancel('ticket-authoring', running.id, running.revision);
      }
    }
    await delay(20);
  });

  await t.test('restart fails interrupted work without replay, but keeps approval waits resumable', async () => {
    const launched = await service.launch('ticket-authoring', configuration());
    const waiting = await wait(launched.id, (run) => run.status === 'waiting');
    await service.stop();
    const id = randomUUID();
    const interrupted: WorkflowTestRun = { ...waiting, id, revision: 0, status: 'running' };
    await db.workflowTestRun.create({ data: { id, scope: interrupted.scope, status: interrupted.status, snapshot: interrupted } });
    service = new WorkflowTestService(db, executor);
    const before = calls.length;
    await service.start();
    const failed = await service.get('ticket-authoring', id);
    assert.equal(failed.status, 'failed');
    assert.match(failed.error!, /No agent has been replayed/);
    assert.equal(calls.length, before);
    const restored = await service.get('ticket-authoring', waiting.id);
    assert.equal(restored.status, 'waiting');
    await service.approve('ticket-authoring', restored.id, restored.revision, 'review');
    await wait(restored.id, (run) => run.status === 'completed');
    const list = await (await request()).json();
    assert.ok(Array.isArray(list) && list.length <= 20);
    assert.equal('configuration' in list[0], false);
  });
});
