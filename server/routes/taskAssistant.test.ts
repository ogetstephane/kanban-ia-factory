import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { projectSchema } from '../../shared/types/board';
import { taskDraftResultSchema } from '../../shared/types/taskDraft';
import { EntityError } from '../db/entityStore';
import { RepositoryError } from '../git/repositoryService';
import type { TaskDraftRequest, TaskGenerator } from '../agents/taskAssistant';
import { createTaskAssistantRouter } from './taskAssistant';

const proposal = taskDraftResultSchema.parse({
  kind: 'proposal', title: 'Export', description: 'Export the selected records.', acceptanceCriteria: ['Ordering is preserved.'],
  subtasks: ['Extend the exporter.'], suggestedWorkflow: 'Test exports.', estimatedStoryPoints: 3,
  suggestedTags: ['export'], impactAnalysis: 'src/export.ts needs inspection.', graphAvailable: true,
});

async function fixture(t: test.TestContext, assistant?: TaskGenerator) {
  const resolved: string[] = [];
  const app = express();
  app.use(express.json());
  app.use('/api/board', createTaskAssistantRouter({
    async project(id) {
      if (id === 'missing') throw new EntityError(404, 'Project not found');
      return projectSchema.parse({
        id, name: 'Exports', description: 'Project context', color: '#000000',
        repositoryUrl: id === 'no-repository' ? undefined : 'https://example.com/repo.git',
        createdAt: '2026-11-04T00:00:00Z', updatedAt: '2026-11-04T00:00:00Z',
      });
    },
  }, {
    async docsWorkspace(id) {
      resolved.push(id);
      if (id === 'broken') throw new RepositoryError(503, 'Project clone is unavailable');
      return { cwd: `/clones/${id}`, branch: 'main' };
    },
  }, assistant));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const post = (id: string, body: unknown = { title: 'Export' }, signal?: AbortSignal, action = 'assistant') => fetch(
    `http://127.0.0.1:${address.port}/api/board/projects/${id}/tasks/${action}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal,
    },
  );
  return { post, resolved };
}

test('drafting resolves the owning project clone, validates the input and returns a proposal without saving', async (t) => {
  const calls: TaskDraftRequest[] = [];
  const { post, resolved } = await fixture(t, { async generate(request) { calls.push(request); return proposal; } });
  const response = await post('p1', { title: 'Export', currentDescription: 'Unsaved notes', workspace: '/untrusted-path' });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), proposal);
  assert.equal(calls[0].workspace, '/clones/p1');
  assert.deepEqual(calls[0].project, { id: 'p1', name: 'Exports', description: 'Project context' });
  assert.equal(calls[0].input.currentDescription, 'Unsaved notes');
  assert.equal('workspace' in calls[0].input, false);
  assert.equal((await post('no-repository')).status, 200);
  assert.equal(calls[1].workspace, undefined);
  assert.deepEqual(resolved, ['p1']);
  assert.equal((await post('p1', { title: ' ' })).status, 400);
  assert.equal((await post('missing')).status, 404);
  assert.equal((await post('broken')).status, 503);
  assert.equal(calls.length, 2);
});

test('breakdown endpoint resolves project context and returns linked drafts without any save capability', async (t) => {
  if (proposal.kind !== 'proposal') throw new Error('Expected specification fixture');
  const calls: TaskDraftRequest[] = [];
  const breakdown = { kind: 'proposal' as const, graphAvailable: false, summary: 'One slice',
    impactAnalysis: 'Sources unavailable', openQuestions: ['Confirm limits'],
    tasks: [{ ...proposal, id: 'export', priority: 'High' as const, dependsOn: [] }] };
  const { post } = await fixture(t, {
    async generate() { return proposal; },
    async generateBreakdown(request) { calls.push(request); return breakdown; },
  });
  const response = await post('p1', { title: 'Export', workspace: '/untrusted' }, undefined, 'breakdown');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), {
    ...breakdown, tasks: breakdown.tasks.map(({ kind, graphAvailable, ...task }) => task),
  });
  assert.equal(calls[0].workspace, '/clones/p1');
  assert.equal((await post('p1', { title: '' }, undefined, 'breakdown')).status, 400);
  assert.equal((await post('missing', { title: 'Export' }, undefined, 'breakdown')).status, 404);
  const disabled = await fixture(t, { async generate() { return proposal; } });
  assert.equal((await disabled.post('p1', { title: 'Export' }, undefined, 'breakdown')).status, 503);
});

test('disabled assistants and generation errors are explicit, not template fallbacks', async (t) => {
  const unconfigured = await fixture(t);
  const unavailable = await unconfigured.post('p1');
  assert.equal(unavailable.status, 503);
  assert.match((await unavailable.json()).error, /not configured/);
  const configured = await fixture(t, {
    async generate() { throw new RepositoryError(502, 'Copilot returned an invalid task proposal. Please retry.'); },
  });
  const failed = await configured.post('p1');
  assert.equal(failed.status, 502);
  assert.match((await failed.json()).error, /invalid task proposal/);
});

test('both authoring endpoints return clarification and forward validated answers without approving a plan', async (t) => {
  const calls: TaskDraftRequest[] = [];
  const clarification = { kind: 'clarification' as const, reason: 'Need scope', questions: ['Which format?'], graphAvailable: false };
  const generate = async (request: TaskDraftRequest) => { calls.push(request); return clarification; };
  const { post } = await fixture(t, { generate, generateBreakdown: generate });
  for (const action of ['assistant', 'breakdown']) {
    const result = await post('p1', { title: 'Export' }, undefined, action);
    assert.equal(result.status, 200);
    assert.deepEqual(await result.json(), clarification);
    const answered = await post('p1', {
      title: 'Export', clarificationAnswers: [{ question: 'Which format?', answer: ' CSV ' }],
    }, undefined, action);
    assert.equal(answered.status, 200);
    assert.deepEqual(calls.at(-1)?.input.clarificationAnswers, [{ question: 'Which format?', answer: 'CSV' }]);
    assert.equal(calls.at(-1)?.input.approvedPlan, undefined);
    const count = calls.length;
    assert.equal((await post('p1', { title: 'Export', clarificationAnswers: [{ question: 'Format?', answer: ' ' }] }, undefined, action)).status, 400);
    assert.equal(calls.length, count);
  }
});

test('disconnecting the editor aborts its drafting request', async (t) => {
  let started: () => void;
  let cancelled: () => void;
  const ready = new Promise<void>((resolve) => { started = resolve; });
  const aborted = new Promise<void>((resolve) => { cancelled = resolve; });
  const { post } = await fixture(t, {
    async generate({ signal }) {
      started();
      await new Promise<void>((resolve) => signal.addEventListener('abort', () => { cancelled(); resolve(); }, { once: true }));
      signal.throwIfAborted();
      return proposal;
    },
  });
  const controller = new AbortController();
  const response = post('p1', { title: 'Export' }, controller.signal);
  const rejected = assert.rejects(response, { name: 'AbortError' });
  await ready;
  controller.abort();
  await rejected;
  await aborted;
});
