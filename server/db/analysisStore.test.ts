import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { PrismaAnalysisStore } from './analysisStore';
import { runAnalysis, type ExecutionEvent } from '../agents/core/index';
import { FakeAIProvider } from '../agents/core/testing/fakeProvider';
import { analysisFixtureCatalog, fixtureTask, fixtureWorkspace, fixtureReport } from '../agents/core/testing/analysisFixture';

test('Prisma stores the full analysis, survives reconnect, and rejects stale lifecycle writes', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'kanban-analysis-db-'));
  const databaseUrl = `file:${path.join(directory, 'test.db')}`;
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: 'pipe',
  });
  let db = new PrismaClient({ datasourceUrl: databaseUrl });
  t.after(async () => { await db.$disconnect(); await rm(directory, { recursive: true, force: true }); });
  let store = new PrismaAnalysisStore(db);
  const provider = new FakeAIProvider([async (_request, controls) => {
    await controls.invokeTool!('repository.read', { path: 'src/service.ts', startLine: 1, endLine: 1 });
    return { status: 'succeeded', output: JSON.stringify(fixtureReport), artifacts: [], usage: { basis: 'unavailable' } };
  }]);
  const result = await runAnalysis(fixtureTask, analysisFixtureCatalog(), fixtureWorkspace, {
    providers: [provider], qualifications: [{ providerId: 'fake', modelId: 'fake-model',
      sdkVersion: 'test', evidenceId: 'fixture', exclusiveToolBroker: true }], resourceContents: {},
  }, store, new AbortController().signal);
  assert.equal(result.status, 'succeeded');
  await db.$disconnect();
  db = new PrismaClient({ datasourceUrl: databaseUrl });
  store = new PrismaAnalysisStore(db);
  const persisted = await store.get(`${fixtureTask.id}:1`);
  assert.ok(persisted);
  assert.equal(persisted.status, 'succeeded');
  assert.deepEqual(persisted.result, result);
  assert.ok(persisted.prepared);
  assert.equal(persisted.events.length, 3);
  assert.deepEqual(persisted.events.map(({ sequence }) => sequence), [0, 1, 2]);
  await assert.rejects(store.saveResult(persisted.id, { status: 'failed', reason: 'stale', artifacts: [] }), /terminal/);
  await assert.rejects(store.savePrepared(JSON.parse(JSON.stringify(persisted.prepared))), /Unique constraint/);
  const event: ExecutionEvent = {
    executionId: persisted.id, sequence: persisted.nextSequence, occurredAt: new Date().toISOString(),
    payload: { type: 'text_delta', text: 'late' },
  };
  await assert.rejects(store.appendEvent(event), /terminal/);
  assert.deepEqual((await store.get(persisted.id))?.result, result);

  await store.saveResult('preparation-failed:1', { status: 'failed', reason: 'No qualification', artifacts: [] }, 'preparation');
  assert.equal((await store.get('preparation-failed:1'))?.prepared, null);
  await assert.rejects(store.saveResult('unprepared-success:1', {
    status: 'succeeded', report: fixtureReport, artifacts: [],
  }), /persisted preparation/);

  await db.analysisExecution.create({ data: { id: 'ordering' } });
  await assert.rejects(store.saveResult('ordering', {
    status: 'failed', reason: 'Duplicate task with failed preparation', artifacts: [],
  }, 'preparation'), /cannot overwrite/);
  assert.equal((await store.get('ordering'))?.status, 'prepared');
  await assert.rejects(store.appendEvent({ ...event, executionId: 'ordering', sequence: 1 }), /out of order/);
  assert.equal((await store.get('ordering'))?.nextSequence, 0);
  await store.appendEvent({ ...event, executionId: 'ordering', sequence: 0 });
  await assert.rejects(store.appendEvent({ ...event, executionId: 'ordering', sequence: 0 }), /out of order/);
  assert.equal((await store.get('ordering'))?.events.length, 1);
});
