import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile, unlink, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import express from 'express';
import type { Server } from 'node:http';
import { featureSchema, taskSchema } from '../../shared/types/board';
import type { AgentRequest, AgentProvider } from './provider';
import { SessionService } from './sessionService';
import { WorkspaceTools } from './workspaceTools';
import { EntityStore } from '../db/entityStore';
import { RepositoryService } from '../git/repositoryService';
import { createSourceRepository } from '../git/testRepository';
import { createAgentRouter } from '../routes/agents';
import { requiredTicketDocumentationPath } from './ticketDocumentation';
import { agentWorkflowsSchema } from '../../shared/types/workflow';
import { RuntimeTelemetry } from './runtimeTelemetry';
import { attemptSnapshotSchema } from '../../shared/types/agent';
import { TicketOrchestrator } from './ticketOrchestrator';
import { WorkflowEditorStore } from '../db/workflowEditorStore';

let directory: string;
let db: PrismaClient;
let entities: EntityStore;
let repositories: RepositoryService;
let sessions: SessionService;
let server: Server;
let api: string;
const calls: AgentRequest[] = [];
let failure = false;
let askNext = false;
let waitExecution = false;
let recordChecks = false;
/** Auto-mode fixture: by default Copilot judges tickets complex and requests plan approval; set to execute directly. */
let executeDirectly = false;
export const FIXTURE_PLAN = 'Read relevant files, implement the ticket, run tests.';
const provider: AgentProvider = {
  id: 'copilot',
  models: async () => [{ id: 'fixture-model', name: 'Fixture model' }],
  async run(request) {
    const telemetry = new RuntimeTelemetry(request);
    try {
      await telemetry.update({}, 'fake-session');
      telemetry.event({
        id: 'fixture-usage', type: 'assistant.usage', timestamp: new Date().toISOString(),
        ephemeral: true, data: { model: 'fixture-model', inputTokens: 100, outputTokens: 20, cost: 0.5 },
      });
      const output = await runFixture(request, telemetry);
      await telemetry.finish();
      return output;
    } catch (error) {
      await telemetry.finish(error);
      throw error;
    }
  },
};

async function runFixture(request: AgentRequest, telemetry: RuntimeTelemetry) {
    calls.push(request);
    await request.onSession('fake-session');
    if (failure) throw new Error('Provider unavailable');
    if (askNext) {
      askNext = false;
      const answer = await request.ask({
        question: 'Which behavior should this ticket implement?', choices: ['Option A', 'Option B'], allowFreeform: false,
      });
      assert.equal(answer, 'Option B');
    }
    if (request.adaptive && !executeDirectly) {
      telemetry.setPhase('plan');
      await request.requestPlanApproval!({ plan: FIXTURE_PLAN, reason: 'The fixture ticket changes shared behavior.' });
      return 'Plan submitted for approval.';
    }
    if (request.phase === 'execute') {
      await new WorkspaceTools(request.workspace, request.signal).write('result.txt', 'implemented');
      const doc = requiredTicketDocumentationPath({
        docsPath: request.context.project?.docsPath,
        taskId: request.context.task.id,
        taskTitle: request.context.task.title,
        featureTitle: request.context.feature?.title,
      });
      await mkdir(path.dirname(path.join(request.workspace, doc)), { recursive: true });
      await writeFile(path.join(request.workspace, doc), `# ${request.context.task.title}\n\nImplemented behavior.\n`);
      if (recordChecks) {
        await request.recordCheck?.({ script: 'test', passed: false, output: 'One assertion failed' });
        await request.recordCheck?.({ script: 'lint', passed: true, output: 'Lint passed' });
      }
      await request.onContent?.('Copilot is working on the approved plan.');
      if (waitExecution) await new Promise<void>((_resolve, reject) => {
        request.signal?.addEventListener('abort', () => reject(new Error('Execution cancelled')), { once: true });
        request.signal?.throwIfAborted();
      });
    }
    return request.phase === 'plan' ? FIXTURE_PLAN : 'Implementation complete; inspect result.txt.';
}

before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'kanban-agent-test-'));
  const databaseUrl = `file:${path.join(directory, 'test.db')}`;
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: 'pipe',
  });
  db = new PrismaClient({ datasourceUrl: databaseUrl });
  entities = new EntityStore(db);
  repositories = new RepositoryService(path.join(directory, 'workspaces'), { localRoots: [directory] });
  const source = await createSourceRepository(path.join(directory, 'source'));
  const cloned = await repositories.workspaces.clone('project-agent', { url: source.url });
  await entities.createProject({
    id: 'project-agent', revision: 0, name: 'Test project', description: 'Small context', color: '#6366f1',
    repositoryUrl: cloned.url, repositoryBranch: cloned.branch, repositoryCommit: cloned.commit,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  });
  sessions = new SessionService(db, repositories, new TicketOrchestrator([
    { id: 'copilot', name: 'GitHub Copilot', provider, defaultModel: process.env.COPILOT_MODEL || null },
    { id: 'claude-code', name: 'Claude Code', experimental: true, defaultModel: 'claude-fixture',
      provider: { ...provider, id: 'claude-code' } },
  ]));
  const app = express();
  app.use(express.json());
  app.use('/api/board', createAgentRouter(sessions));
  server = await new Promise<Server>((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  api = `http://127.0.0.1:${address.port}/api/board`;
});

after(async () => {
  await sessions?.stop();
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
  await db?.$disconnect();
  if (directory) await rm(directory, { recursive: true, force: true });
});

async function startTicket(id: string, edit = false) {
  const now = new Date().toISOString();
  const task = await entities.createTask(taskSchema.parse({
    id, projectId: 'project-agent', title: `Implement ${id}`, description: 'Only this ticket',
    status: 'To Do', priority: 'Medium', tags: [], acceptanceCriteria: ['Result is correct'],
    subtasks: [], order: 0, storyPoints: 1, createdAt: now, updatedAt: now,
  }));
  if (edit) return entities.updateTask({ ...task, status: 'In Progress' });
  const moved = await entities.moveTask(id, { revision: task.revision!, status: 'In Progress' });
  return moved.find((item) => item.id === id)!;
}

test('transition queues one session that runs in auto mode and cannot change files before a requested plan is approved', async () => {
  const task = await startTicket('agent-one');
  const queued = await sessions.get(task.id);
  assert.equal(queued?.status, 'queued');
  assert.equal(queued?.taskRevision, task.revision);
  await assert.rejects(entities.deleteTask(task.id, task.revision!), /AI session/);
  await sessions.tick();
  const plan = (await sessions.get(task.id))!;
  assert.equal(plan.status, 'awaiting_approval');
  assert.equal(plan.resumeStatus, 'awaiting_approval');
  assert.equal(plan.plan, `${FIXTURE_PLAN}\n\n> **Why a plan is needed:** The fixture ticket changes shared behavior.`);
  assert.equal(plan.providerSessionId, 'fake-session');
  assert.equal(plan.context?.task.id, task.id);
  assert.equal(plan.runtimes.length, 2, 'Read-only impact and adaptive executor have separate runtimes');
  assert.equal(plan.runtimes[0].phase, 'plan');
  assert.equal(plan.runtimes[0].status, 'completed');
  assert.equal(plan.runtimes[0].events[0].data.inputTokens, 100);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].workflowStep?.nodeId, 'impact');
  assert.equal(calls[0].phase, 'plan');
  assert.equal(calls[1].phase, 'execute');
  assert.equal(calls[1].adaptive, true);
  assert.equal(calls[0].context.task.id, task.id);
  assert.ok(!('tasks' in calls[0].context));
  assert.equal(await readFile(path.join(plan.workspace!, 'README.md'), 'utf8'), '# main\n');
  assert.ok(plan.branch?.startsWith('kanban/'));
  assert.equal((await repositories.workspaces.ticketWorkspace('project-agent', plan.id, 'main')).workspace, plan.workspace);
  await assert.rejects(readFile(path.join(plan.workspace!, 'result.txt')));
  await sessions.tick();
  assert.equal(calls.length, 2);

  await sessions.approve(task.id, plan.id, plan.updatedAt);
  await assert.rejects(sessions.approve(task.id, plan.id, plan.updatedAt), /plan changed|awaiting approval/);
  await sessions.tick();
  const done = (await sessions.get(task.id))!;
  assert.equal(done.status, 'completed');
  assert.equal(done.resumeStatus, 'executing');
  assert.equal(calls[3].phase, 'execute');
  assert.equal(calls[3].plan, plan.plan);
  assert.equal(await readFile(path.join(done.workspace!, 'result.txt'), 'utf8'), 'implemented');
  await assert.rejects(readFile(path.join(repositories.workspaces.pathFor('project-agent'), 'result.txt')));
  assert.equal((await repositories.workspaces.workspaceBranches('project-agent')).current, 'main');
  const reviewed = await db.task.findUniqueOrThrow({ where: { id: task.id } });
  assert.equal(reviewed.status, 'Review');
  assert.equal(reviewed.revision, task.revision! + 1);
  assert.equal(done.reviewStatus, 'pending');
  await entities.moveTask(task.id, { revision: reviewed.revision, status: 'Review' });
  assert.equal(await db.agentSession.count({ where: { taskId: task.id } }), 1);
});

test('workflow activation is pinned at queue time through approval, execution and review; a new attempt takes the new active version', async () => {
  const workflows = new WorkflowEditorStore(db);
  const base = await workflows.base('ticket-processing');
  let state = await workflows.save('ticket-processing', 0, base);
  state = await workflows.publish('ticket-processing', state.revision);
  const version = state.versions[0];
  state = await workflows.activate('ticket-processing', state.revision, version.id);
  const task = await startTicket('workflow-pinning');
  assert.equal((await sessions.get(task.id))?.context?.workflow?.versionId, version.id);
  state = await workflows.activate('ticket-processing', state.revision, null);
  await sessions.tick();
  const planned = (await sessions.get(task.id))!;
  assert.equal(planned.status, 'awaiting_approval');
  assert.equal(calls.at(-1)?.context.workflow?.versionId, version.id);
  await sessions.approve(task.id, planned.id, planned.updatedAt);
  await sessions.tick();
  assert.equal(calls.at(-1)?.context.workflow?.versionId, version.id);
  const review = await sessions.review(task.id);
  await sessions.aiReview(task.id, review.token);
  assert.equal(calls.at(-1)?.context.workflow?.versionId, version.id);
  const current = (await sessions.get(task.id))!;
  await sessions.retry(task.id, current.id, 'Improve the result', current.updatedAt);
  const retry = (await sessions.get(task.id))!;
  assert.equal(retry.context?.workflow?.versionId, null);
  const archived = await db.agentAttempt.findFirstOrThrow({ where: { sessionId: current.id, number: 1 } });
  assert.equal(attemptSnapshotSchema.parse(archived.snapshot).context?.workflow?.versionId, version.id);
  await sessions.cancel(task.id, retry.id);
});

test('agent options expose integrated providers and their model catalogue over HTTP', async () => {
  const response = await fetch(`${api}/agent-options`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.providers[0].models, [{ id: 'fixture-model', name: 'Fixture model' }]);
  assert.equal(body.providers[0].id, 'copilot');
  assert.equal(body.providers[0].defaultModel, process.env.COPILOT_MODEL || null);
  assert.equal(body.providers[1].id, 'claude-code');
  assert.equal(body.providers[1].experimental, true);
});

test('selected Claude runtime survives queueing, human approval, execution, review and retry', async () => {
  const now = new Date().toISOString();
  const task = await entities.createTask(taskSchema.parse({
    id: 'claude-ticket-pipeline', projectId: 'project-agent', title: 'Claude pipeline',
    description: 'Offline simulated ticket runtime', status: 'To Do', priority: 'Medium', tags: [],
    acceptanceCriteria: ['Result exists'], subtasks: [], order: 0, storyPoints: 1,
    createdAt: now, updatedAt: now, agentProvider: 'claude-code', agentModel: 'claude-ticket-model',
  }));
  await entities.moveTask(task.id, { revision: task.revision!, status: 'In Progress' });
  assert.equal((await sessions.get(task.id))?.provider, 'claude-code');
  await sessions.tick();
  const plan = (await sessions.get(task.id))!;
  assert.equal(plan.status, 'awaiting_approval');
  assert.equal(calls.at(-1)?.context.task.agentProvider, 'claude-code');
  assert.equal(calls.at(-1)?.context.task.agentModel, 'claude-ticket-model');
  await sessions.approve(task.id, plan.id, plan.updatedAt);
  await sessions.tick();
  const completed = (await sessions.get(task.id))!;
  assert.equal(completed.status, 'completed', completed.error);
  assert.equal(completed.provider, 'claude-code');
  assert.equal(calls.at(-1)?.phase, 'execute');
  const review = await sessions.review(task.id);
  const report = await sessions.aiReview(task.id, review.token);
  assert.ok(report.report);
  assert.equal(calls.at(-1)?.phase, 'review');
  assert.equal(calls.at(-1)?.context.task.agentModel, 'claude-ticket-model');
  await sessions.retry(task.id, completed.id, 'Refine the implementation');
  const retried = (await sessions.get(task.id))!;
  assert.equal(retried.provider, 'claude-code');
  assert.equal(retried.attempt, 2);
  await sessions.tick();
  assert.equal((await sessions.get(task.id))?.status, 'awaiting_approval');
  assert.equal(calls.at(-1)?.context.task.agentProvider, 'claude-code');
});

test('ticket-selected models reach planning, execution and review and can change on a new attempt', async () => {
  const now = new Date().toISOString();
  const task = await entities.createTask(taskSchema.parse({
    id: 'agent-model-selection', projectId: 'project-agent', title: 'Choose a model',
    description: '', status: 'To Do', priority: 'Medium', tags: [], acceptanceCriteria: [],
    subtasks: [], order: 0, storyPoints: 1, createdAt: now, updatedAt: now,
    agentProvider: 'copilot', agentModel: 'chosen-model',
  }));
  await entities.moveTask(task.id, { revision: task.revision!, status: 'In Progress' });
  await sessions.tick();
  const plan = (await sessions.get(task.id))!;
  assert.equal(calls.at(-1)?.context.task.agentModel, 'chosen-model');
  assert.equal(plan.runtimes[0].metadata.requestedModel, 'chosen-model');
  await sessions.approve(task.id, plan.id, plan.updatedAt);
  await sessions.tick();
  const done = (await sessions.get(task.id))!;
  assert.equal(calls.at(-1)?.phase, 'execute');
  assert.equal(calls.at(-1)?.context.task.agentModel, 'chosen-model');
  const review = await sessions.review(task.id);
  await sessions.aiReview(task.id, review.token);
  assert.equal(calls.at(-1)?.phase, 'review');
  assert.equal(calls.at(-1)?.context.task.agentModel, 'chosen-model');
  const current = (await entities.board('project-agent')).tasks.find((item) => item.id === task.id)!;
  await entities.updateTask({ ...current, agentModel: 'revised-model' });
  await sessions.retry(task.id, done.id, 'Use the revised model', (await sessions.get(task.id))!.updatedAt);
  await sessions.tick();
  const revised = (await sessions.get(task.id))!;
  assert.equal(calls.at(-1)?.context.task.agentModel, 'revised-model');
  assert.equal((await sessions.history(task.id))[0].snapshot.context?.task.agentModel, 'chosen-model');
  await sessions.cancel(task.id, revised.id);
});

test('an epic auto-executes tickets sequentially and enters review after every ticket is done', async () => {
  const now = new Date().toISOString();
  const feature = await entities.createFeature(featureSchema.parse({
    id: 'agent-auto-epic', title: 'Automatic epic', description: 'Run all tickets in sequence',
    category: 'Test', status: 'Backlog', projectId: 'project-agent', color: '#6366f1', createdAt: now,
  }));
  const tasks = await Promise.all(['agent-auto-one', 'agent-auto-two'].map((id) =>
    entities.createTask(taskSchema.parse({
      id, projectId: 'project-agent', featureId: feature.id, title: `Implement ${id}`,
      description: 'Epic ticket', status: 'Backlog', priority: 'Medium', tags: [],
      acceptanceCriteria: ['Result is correct'], subtasks: [], order: 0, storyPoints: 1,
      createdAt: now, updatedAt: now,
    }))));
  const todo = await entities.updateFeature({ ...feature, status: 'To Do' });
  const active = await entities.updateFeature({ ...todo, status: 'In Progress' });
  assert.equal(active.status, 'In Progress');
  const queued = await db.agentSession.findMany({
    where: { taskId: { in: tasks.map((task) => task.id) } }, orderBy: { taskId: 'asc' },
  });
  assert.equal(queued.length, 2);
  assert.ok(queued.every((row) => row.autoExecute && row.status === 'queued'));

  const callOffset = calls.length;
  for (let step = 0; step < 4; step += 1) await sessions.tick();
  assert.equal(calls.slice(callOffset).filter((call) => call.workflowStep?.intermediate).length, 4);
  const epicCalls = calls.slice(callOffset).filter((call) => !call.workflowStep?.intermediate);
  assert.equal(epicCalls.length, 4);
  assert.deepEqual(epicCalls.map((call) => [call.phase, !!call.adaptive]), [
    ['execute', true], ['execute', false], ['execute', true], ['execute', false],
  ]);
  assert.ok((await db.agentSession.findMany({ where: { taskId: { in: tasks.map((task) => task.id) } } }))
    .every((row) => row.plan.startsWith(FIXTURE_PLAN)));
  assert.equal(epicCalls[0].context.task.id, epicCalls[1].context.task.id);
  assert.equal(epicCalls[2].context.task.id, epicCalls[3].context.task.id);
  assert.notEqual(epicCalls[0].context.task.id, epicCalls[2].context.task.id);
  assert.ok((await db.agentSession.findMany({
    where: { taskId: { in: tasks.map((task) => task.id) } },
  })).every((row) => row.status === 'completed'));

  for (const original of tasks) {
    const task = await db.task.findUniqueOrThrow({ where: { id: original.id }, select: { revision: true, status: true } });
    assert.equal(task.status, 'Review');
    await entities.moveTask(original.id, { revision: task.revision, status: 'Done' });
    const epic = await db.feature.findUniqueOrThrow({ where: { id: feature.id } });
    if (original.id === tasks[0].id) assert.equal(epic.status, 'In Progress');
    else assert.equal(epic.status, 'Review');
  }
});

test('a single-ticket feature follows completed execution into review and reopens for corrections', async () => {
  const now = new Date().toISOString();
  const feature = await entities.createFeature(featureSchema.parse({
    id: 'agent-single-epic', title: 'Single-ticket epic', description: 'Review the only ticket',
    category: 'Test', status: 'To Do', projectId: 'project-agent', color: '#6366f1', createdAt: now,
  }));
  const task = await entities.createTask(taskSchema.parse({
    id: 'agent-single-ticket', projectId: 'project-agent', featureId: feature.id, title: 'Only ticket',
    description: 'Implement the feature', status: 'To Do', priority: 'Medium', tags: [],
    acceptanceCriteria: ['Result is correct'], subtasks: [], order: 0, storyPoints: 1,
    createdAt: now, updatedAt: now,
  }));
  await entities.updateFeature({ ...feature, status: 'In Progress' });
  await sessions.tick();
  assert.equal((await db.task.findUniqueOrThrow({ where: { id: task.id } })).status, 'In Progress');
  assert.equal((await db.feature.findUniqueOrThrow({ where: { id: feature.id } })).status, 'In Progress');
  failure = true;
  await sessions.tick();
  failure = false;
  let session = (await sessions.get(task.id))!;
  assert.equal(session.status, 'failed');
  assert.equal((await db.task.findUniqueOrThrow({ where: { id: task.id } })).status, 'In Progress');
  assert.equal((await db.feature.findUniqueOrThrow({ where: { id: feature.id } })).status, 'In Progress');
  await sessions.retry(task.id, session.id);
  await sessions.tick();
  session = (await sessions.get(task.id))!;
  await sessions.approve(task.id, session.id, session.updatedAt);
  await sessions.tick();
  assert.equal((await db.task.findUniqueOrThrow({ where: { id: task.id } })).status, 'Review');
  assert.equal((await db.feature.findUniqueOrThrow({ where: { id: feature.id } })).status, 'Review');
  session = (await sessions.get(task.id))!;
  const review = await sessions.review(task.id);
  await sessions.acceptReview(task.id, session.id, session.updatedAt, review.token);
  await sessions.retry(task.id, session.id, 'Improve the result');
  assert.equal((await db.feature.findUniqueOrThrow({ where: { id: feature.id } })).status, 'In Progress');
  await sessions.tick();
  session = (await sessions.get(task.id))!;
  await sessions.approve(task.id, session.id, session.updatedAt);
  await sessions.tick();
  assert.equal((await db.feature.findUniqueOrThrow({ where: { id: feature.id } })).status, 'Review');
  const latest = await db.task.findUniqueOrThrow({ where: { id: task.id } });
  await entities.moveTask(task.id, { revision: latest.revision, status: 'Done' });
  assert.equal((await db.task.findUniqueOrThrow({ where: { id: task.id } })).status, 'Done');
});

test('edit-to-In-Progress also queues a session; changed tickets require a regenerated plan', async () => {
  const task = await startTicket('agent-edit', true);
  await sessions.tick();
  const row = (await sessions.get(task.id))!;
  const updated = await entities.updateTask({ ...task, title: 'Updated scope' });
  await assert.rejects(sessions.approve(task.id, row.id, row.updatedAt), /ticket changed/);
  await sessions.retry(task.id, row.id);
  await sessions.tick();
  assert.equal(calls.at(-1)?.context.task.title, 'Updated scope');
  const refreshed = (await sessions.get(task.id))!;
  assert.equal(refreshed.taskRevision, updated.revision);
  await assert.rejects(sessions.approve(task.id, row.id, row.updatedAt), /plan changed/);
  await sessions.approve(task.id, row.id, refreshed.updatedAt);
  await sessions.tick();
});

test('provider failures persist, and retry always plans again before any execution', async () => {
  const task = await startTicket('agent-failure');
  failure = true;
  await sessions.tick();
  const failed = (await sessions.get(task.id))!;
  assert.equal(failed.status, 'failed');
  assert.equal((await db.task.findUniqueOrThrow({ where: { id: task.id } })).status, 'In Progress');
  assert.equal(failed.error, 'Provider unavailable');
  await assert.rejects(sessions.approve(task.id, failed.id, failed.updatedAt), /awaiting approval/);
  failure = false;
  await sessions.retry(task.id, failed.id);
  await sessions.tick();
  assert.equal((await sessions.get(task.id))?.status, 'awaiting_approval');
});

test('questions pause a session, accept one valid answer, and do not block other tickets', async () => {
  const task = await startTicket('agent-question');
  askNext = true;
  const pending = sessions.tick();
  let waiting = await sessions.get(task.id);
  for (let attempt = 0; attempt < 100 && waiting?.status !== 'awaiting_input'; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    waiting = await sessions.get(task.id);
  }
  assert.equal(waiting?.status, 'awaiting_input');
  const question = waiting!.questions[0];
  await assert.rejects(entities.deleteTask(task.id, task.revision!), /AI session/);
  await assert.rejects(sessions.answer(task.id, waiting!.id, question.id, 'Invalid choice'), /proposed answers/);
  const other = await startTicket('agent-concurrent');
  await sessions.tick();
  assert.equal((await sessions.get(other.id))?.status, 'awaiting_approval');
  await sessions.answer(task.id, waiting!.id, question.id, 'Option B');
  await assert.rejects(sessions.answer(task.id, waiting!.id, question.id, 'Option A'), /already been answered/);
  await pending;
  assert.equal((await sessions.get(task.id))?.status, 'awaiting_approval');
  assert.equal((await sessions.get(task.id))?.questions[0].answer, 'Option B');
  await sessions.approve(task.id, waiting!.id, (await sessions.get(task.id))!.updatedAt);
  await sessions.tick();
  assert.deepEqual(calls.at(-1)?.answers, [{ question: question.question, answer: 'Option B' }]);
});

test('session listing filters and paginates without leaking the full agent context', async () => {
  const all = await sessions.list({});
  assert.ok(all.total >= 5);
  assert.ok(all.items.every((item) => !('context' in item) && !('plan' in item) && !('questions' in item)));
  const matching = await sessions.list({ projectId: 'project-agent', search: 'agent-question', status: 'completed', priority: 'Medium' });
  assert.equal(matching.total, 1);
  assert.equal(matching.items[0].taskId, 'agent-question');
  assert.equal((await sessions.list({ projectId: 'missing' })).total, 0);
  assert.equal((await sessions.list({ featureId: 'missing' })).total, 0);
  assert.equal((await sessions.list({ page: 2 })).items.length, 0);
});

test('auto mode executes a simple ticket directly and records plan and approval as skipped', async () => {
  executeDirectly = true;
  try {
    const task = await startTicket('agent-direct');
    const callOffset = calls.length;
    await sessions.tick();
    const done = (await sessions.get(task.id))!;
    assert.equal(done.status, 'completed', done.error);
    assert.equal(done.plan, '');
    assert.equal(done.output, 'Implementation complete; inspect result.txt.');
    assert.deepEqual(calls.slice(callOffset).map((call) => [call.phase, call.adaptive]), [['plan', false], ['execute', true]]);
    assert.deepEqual(done.runtimes.map((runtime) => runtime.phase), ['plan', 'execute']);
    assert.equal(await readFile(path.join(done.workspace!, 'result.txt'), 'utf8'), 'implemented');
    assert.deepEqual((await sessions.workflows('project-agent'))[task.id], {
      plan: 'skipped', approval: 'skipped', execution: 'completed', review: 'waiting', delivery: 'pending',
    });
    assert.equal((await db.task.findUniqueOrThrow({ where: { id: task.id } })).status, 'Review');
  } finally {
    executeDirectly = false;
  }
});

test('ordering changes do not invalidate a plan but project scope changes do', async () => {
  const task = await startTicket('agent-order');
  await sessions.tick();
  const planned = (await sessions.get(task.id))!;
  await entities.moveTask(task.id, { revision: task.revision!, status: 'In Progress', index: 0 });
  const reordered = (await entities.board('project-agent')).tasks.find((item) => item.id === task.id)!;
  await entities.updateTask({ ...reordered, blockedReason: 'Informational flag only' });
  await sessions.approve(task.id, planned.id, planned.updatedAt);
  await sessions.tick();
  assert.equal((await sessions.get(task.id))?.status, 'completed');
  const scoped = await startTicket('agent-scope');
  await sessions.tick();
  const row = (await sessions.get(scoped.id))!;
  const project = await entities.project('project-agent');
  await entities.updateProject({ ...project, description: 'Changed requirements' });
  await assert.rejects(sessions.approve(scoped.id, row.id, row.updatedAt), /ticket changed/);
});

test('a ticket without a linked project repository fails visibly instead of silently skipping the agent', async () => {
  const now = new Date().toISOString();
  const created = await entities.createTask(taskSchema.parse({
    id: 'agent-no-repo', title: 'No repository', description: '', status: 'To Do', priority: 'Medium',
    tags: [], acceptanceCriteria: [], subtasks: [], order: 0, storyPoints: 1, createdAt: now, updatedAt: now,
  }));
  await entities.moveTask(created.id, { status: 'In Progress', revision: created.revision! });
  await sessions.tick();
  const row = (await sessions.get(created.id))!;
  assert.equal(row.status, 'failed');
  assert.match(row.error, /Associate a git repository with commits/);
});

test('session HTTP endpoints validate filters and require the exact plan version for approval', async () => {
  const task = await startTicket('agent-http');
  await sessions.tick();
  const row = (await sessions.get(task.id))!;
  const response = await fetch(`${api}/tasks/${task.id}/session`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.status, 'awaiting_approval');
  assert.equal(body.context.task.id, task.id);
  assert.equal(body.runtimes[0].events[0].data.inputTokens, 100);
  const approve = (value: unknown) => fetch(`${api}/tasks/${task.id}/session/approve`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value),
  });
  assert.equal((await approve({ sessionId: row.id })).status, 400);
  assert.equal((await approve({ sessionId: row.id, updatedAt: '2020-01-01T00:00:00.000Z' })).status, 409);
  assert.equal((await approve({ sessionId: row.id, updatedAt: row.updatedAt })).status, 200);
  assert.equal((await approve({ sessionId: row.id, updatedAt: row.updatedAt })).status, 409);
  await sessions.tick();
  assert.equal((await fetch(`${api}/agent-sessions?page=0`)).status, 400);
  assert.equal((await fetch(`${api}/agent-sessions?priority=Unknown`)).status, 400);
  const list = await fetch(`${api}/agent-sessions?search=agent-http&status=completed`).then((res) => res.json());
  assert.equal(list.total, 1);
  assert.equal('context' in list.items[0], false, 'session summaries must remain compact');
  assert.equal('runtimes' in list.items[0], false, 'raw telemetry belongs only in session details');
  assert.equal(list.items[0].agent.provider, 'copilot');
  assert.equal(list.items[0].agent.model, 'fixture-model');
  assert.equal(list.items[0].agent.phase, 'execute');
  await db.agentDelivery.create({ data: {
    id: 'delivery-agent-http', sessionId: row.id, attempt: row.attempt, status: 'failed',
    targetBranch: 'main', targetHead: 'a'.repeat(40), ticketHead: 'b'.repeat(40), tree: 'c'.repeat(40),
    reviewToken: 'd'.repeat(64), message: 'Test delivery', acknowledgeChecks: false,
    commitHash: null, mergeHash: null, error: 'Merge conflict', createdAt: row.createdAt, updatedAt: row.updatedAt,
  } });
  const deliveries = await fetch(`${api}/delivery-history?projectId=project-agent&search=agent-http&status=failed`).then((res) => res.json());
  assert.equal(deliveries.total, 1);
  assert.equal(deliveries.items[0].taskTitle, task.title);
  assert.equal(deliveries.items[0].projectName, 'Test project');
  assert.equal(deliveries.items[0].error, 'Merge conflict');
  assert.equal((await fetch(`${api}/delivery-history?page=0`)).status, 400);
  assert.equal((await fetch(`${api}/delivery-history?status=unknown`)).status, 400);
});

test('restart marks interrupted sessions failed without replaying them', async () => {
  await db.agentSession.updateMany({ where: { taskId: 'agent-failure' }, data: { status: 'executing' } });
  const session = (await sessions.get('agent-failure'))!;
  const runtime = session.runtimes.at(-1)!;
  await db.agentRuntime.update({ where: { id: runtime.id }, data: { status: 'running', endedAt: null } });
  await sessions.start();
  await sessions.stop();
  assert.equal((await sessions.get('agent-failure'))?.status, 'failed');
  assert.match((await sessions.get('agent-failure'))!.error, /restarted/);
  const recovered = (await sessions.get('agent-failure'))!.runtimes.find((item) => item.id === runtime.id)!;
  assert.equal(recovered.status, 'failed');
  assert.ok(recovered.endedAt);
  assert.match(recovered.error, /Telemetry may be incomplete/);
  assert.deepEqual(recovered.events, runtime.events);
});

test('workspace tools reject escapes, hidden credentials and writes through symlinks', async () => {
  const root = path.join(directory, 'source');
  await writeFile(path.join(root, '.copilotignore'), [
    'dist/',
    'storybook-static/',
    'doc/archify/generated/',
    'tsconfig.tsbuildinfo',
  ].join('\n'));
  const tools = new WorkspaceTools(root);
  await assert.rejects(tools.read('../test.db'), /relative workspace/);
  await assert.rejects(tools.read('.git/config'), /relative workspace/);
  await assert.rejects(tools.write('.env', 'secret'), /relative workspace/);
  await mkdir(path.join(root, 'dist'));
  await mkdir(path.join(root, 'storybook-static'));
  await mkdir(path.join(root, 'doc/archify/generated'), { recursive: true });
  await writeFile(path.join(root, 'dist/generated.txt'), 'IgnoredNeedle');
  await writeFile(path.join(root, 'storybook-static/generated.txt'), 'IgnoredNeedle');
  await writeFile(path.join(root, 'doc/archify/generated/report.md'), 'IgnoredNeedle');
  await writeFile(path.join(root, 'tsconfig.tsbuildinfo'), 'IgnoredNeedle');
  await assert.rejects(tools.read('dist/generated.txt'), /\.copilotignore/);
  await assert.rejects(tools.write('storybook-static/new.html', 'generated'), /\.copilotignore/);
  await assert.rejects(tools.read('doc/archify/generated/report.md'), /\.copilotignore/);
  await assert.rejects(tools.read('tsconfig.tsbuildinfo'), /\.copilotignore/);
  const rootEntries = await tools.list('.');
  assert.ok(!rootEntries.some((entry) => ['dist', 'storybook-static'].includes(entry.name)));
  assert.ok(!rootEntries.some((entry) => entry.name === 'tsconfig.tsbuildinfo'));
  const ignoredSearch = await tools.search('.', 'IgnoredNeedle');
  assert.equal(ignoredSearch.matches.length, 0);
  const { symlink } = await import('node:fs/promises');
  await symlink(path.join(directory, 'test.db'), path.join(root, 'outside'));
  await assert.rejects(tools.read('outside'), /leaves the ticket/);
  await assert.rejects(tools.write('outside', 'bad'), /symlink/);
  await symlink(path.join(root, '.git', 'config'), path.join(root, 'hidden-alias'));
  await assert.rejects(tools.read('hidden-alias'), /Hidden paths/);
  await writeFile(path.join(root, 'large.txt'), 'x'.repeat(128_001));
  await assert.rejects(tools.read('large.txt'), /too large/);
  await writeFile(path.join(root, 'large-source.ts'), `${Array.from({ length: 700 }, (_, i) =>
    `const line${i + 1} = 'Needle ${i + 1}';`).join('\n')}\n`);
  assert.equal((await tools.read('large-source.ts', 301, 302)).split('\n')[0], "L301:const line301 = 'Needle 301';");
  await assert.rejects(tools.read('large-source.ts', 1, 501), /at most 500 lines/);
  const search = await tools.search('.', 'Needle 601');
  assert.ok(search.matches.some((match) =>
    match.path === 'large-source.ts' && match.line === 601 && match.text.includes('Needle 601')));
  assert.equal(search.truncated, false);
  assert.deepEqual(await tools.search('./', 'Needle 601'), search);
  await mkdir(path.join(root, 'path-fixture'));
  await tools.write('./path-fixture/./source.ts', 'export const SearchNeedle = true;\n');
  assert.match(await tools.read('./path-fixture/./source.ts'), /SearchNeedle/);
  assert.deepEqual(await tools.list('./path-fixture'), [{ name: 'source.ts', directory: false }]);
  assert.equal((await tools.search('./path-fixture/.', 'SearchNeedle')).matches[0]?.path, 'path-fixture/source.ts');
  for (const invalid of ['../source', './path-fixture/../', './.git', './node_modules', path.resolve(root)]) {
    await assert.rejects(tools.search(invalid, 'Needle'), /relative workspace/);
  }
  await assert.rejects(tools.read('./.git/config'), /relative workspace/);
  await assert.rejects(tools.write('./.env', 'secret'), /relative workspace/);
  await writeFile(path.join(root, '.agent-private'), 'HiddenNeedle');
  assert.equal((await tools.search('.', 'HiddenNeedle')).matches.length, 0);
  await writeFile(path.join(root, 'long-line.txt'), 'x'.repeat(150_000));
  assert.match(await tools.read('long-line.txt', 1, 1), /Range output truncated/);
  await assert.rejects(tools.search('.', ''), /1 to 200 characters/);
});

test('review lazily previews tracked, deleted, untracked, binary and symlink changes without touching the source', async () => {
  const task = await startTicket('agent-diff');
  await sessions.tick();
  const row = (await sessions.get(task.id))!;
  await writeFile(path.join(row.workspace!, 'README.md'), 'Updated main\n');
  await writeFile(path.join(row.workspace!, 'new file.txt'), 'Added line\n');
  await writeFile(path.join(row.workspace!, 'binary.bin'), Buffer.from([0, 1, 2]));
  await symlink('/etc/passwd', path.join(row.workspace!, 'link.txt'));
  let review = await sessions.review(task.id);
  assert.equal(review.files.length, 4);
  assert.ok(review.files.every((file) => file.patch === ''), 'overview never includes file contents');
  const preview = await sessions.review(task.id, 'README.md');
  assert.equal(preview.token, review.token);
  assert.match(preview.files.find((file) => file.path === 'README.md')!.patch, /-# main\n\+Updated main/);
  assert.equal(preview.files.find((file) => file.path === 'new file.txt')!.patch, '');
  await writeFile(path.join(row.workspace!, 'README.md'), Buffer.from([0, 5]));
  const firstBinary = await sessions.review(task.id, 'README.md');
  await writeFile(path.join(row.workspace!, 'README.md'), Buffer.from([0, 6]));
  assert.notEqual((await sessions.review(task.id)).token, firstBinary.token, 'tracked binary content must affect the review fingerprint');
  assert.equal(firstBinary.files.find((file) => file.path === 'README.md')!.binary, true);
  const binary = await sessions.review(task.id, 'binary.bin');
  assert.equal(binary.files.find((file) => file.path === 'binary.bin')!.binary, true);
  const link = await sessions.review(task.id, 'link.txt');
  assert.match(link.files.find((file) => file.path === 'link.txt')!.patch, /\+\/etc\/passwd/);
  assert.doesNotMatch(link.files.find((file) => file.path === 'link.txt')!.patch, /root:x/);
  await assert.rejects(sessions.review(task.id, '../test.db'), /Changed file not found/);
  await unlink(path.join(row.workspace!, 'README.md'));
  review = await sessions.review(task.id, 'README.md');
  assert.equal(review.files.find((file) => file.path === 'README.md')!.status, 'D');
  assert.equal(await readFile(path.join(repositories.workspaces.pathFor('project-agent'), 'README.md'), 'utf8'), '# main\n');
  await writeFile(path.join(row.workspace!, 'long.txt'), 'x'.repeat(128_001));
  const long = (await sessions.review(task.id, 'long.txt')).files.find((file) => file.path === 'long.txt')!;
  assert.equal(long.patch.length, 128_000);
  assert.equal(long.truncated, true);
  await writeFile(path.join(row.workspace!, 'too-large.bin'), Buffer.alloc(2_000_001));
  await assert.rejects(sessions.review(task.id), /too large/);
});

test('structured checks, snapshot-bound human review and correction attempts remain separate', async () => {
  const task = await startTicket('agent-feedback');
  await sessions.tick();
  let row = (await sessions.get(task.id))!;
  recordChecks = true;
  await sessions.approve(task.id, row.id, row.updatedAt);
  await sessions.tick();
  recordChecks = false;
  row = (await sessions.get(task.id))!;
  assert.equal(row.status, 'completed', 'agent completion is not check success');
  assert.deepEqual(row.checks.map((check) => [check.script, check.passed]), [['test', false], ['lint', true]]);
  const firstReview = await sessions.review(task.id);
  await writeFile(path.join(row.workspace!, 'result.txt'), 'Edited after opening diff');
  await assert.rejects(sessions.acceptReview(task.id, row.id, row.updatedAt, firstReview.token), /Files changed/);
  await assert.rejects(sessions.aiReview(task.id, firstReview.token), /Files changed/);
  const documentationPath = requiredTicketDocumentationPath({
    taskId: task.id, taskTitle: task.title,
    docsPath: (await db.project.findUniqueOrThrow({ where: { id: 'project-agent' } })).docsPath,
  });
  await unlink(path.join(row.workspace!, documentationPath));
  const blockedReview = await sessions.review(task.id);
  assert.ok(blockedReview.documentation);
  assert.equal(blockedReview.documentation.ready, false);
  await assert.rejects(sessions.acceptReview(task.id, row.id, row.updatedAt, blockedReview.token), /before accepting this review/);
  await mkdir(path.dirname(path.join(row.workspace!, documentationPath)), { recursive: true });
  await writeFile(path.join(row.workspace!, documentationPath), `# ${task.title}\n\nDocuments the implementation.\n`);
  const review = await sessions.review(task.id);
  assert.ok(review.documentation);
  assert.equal(review.documentation.ready, true);
  const aiReview = await sessions.aiReview(task.id, review.token);
  assert.equal(aiReview.token, review.token);
  assert.ok(aiReview.report.length > 0);
  assert.equal(calls.at(-1)?.phase, 'review');
  const reviewedRuntimes = (await sessions.get(task.id))!.runtimes;
  assert.deepEqual(reviewedRuntimes.map((runtime) => runtime.phase), ['plan', 'plan', 'plan', 'execute', 'review', 'review']);
  assert.equal(reviewedRuntimes.at(-1)?.events[0].data.cost, 0.5);
  assert.equal(await readFile(path.join(row.workspace!, documentationPath), 'utf8'), `# ${task.title}\n\nDocuments the implementation.\n`);
  await assert.rejects(sessions.acceptReview(task.id, row.id, '2020-01-01T00:00:00.000Z', review.token), /execution changed/);
  const accepted = (await sessions.acceptReview(task.id, row.id, row.updatedAt, review.token))!;
  assert.equal(accepted.reviewStatus, 'accepted');
  assert.equal(accepted.reviewToken, review.token);
  assert.equal((await sessions.list({ search: task.id, actionable: 'true' })).total, 0);
  const cockpitActions = await sessions.list({ search: task.id, actionable: 'cockpit' });
  assert.equal(cockpitActions.total, 1, 'accepted work without a local delivery remains actionable in the cockpit');
  assert.equal(cockpitActions.items[0].deliveryStatus, null);
  const latestTask = await db.task.findUniqueOrThrow({ where: { id: task.id } });
  const moved = await entities.moveTask(task.id, { revision: latestTask.revision, status: 'Review' });
  assert.equal(moved.find((item) => item.id === task.id)?.status, 'Review');
  const corrected = (await sessions.retry(task.id, row.id, 'Fix the failing assertion'))!;
  assert.equal(corrected.status, 'queued');
  assert.equal(corrected.attempt, 2);
  assert.equal(corrected.workspace, row.workspace);
  assert.equal(corrected.reviewStatus, 'pending');
  assert.equal(corrected.checks.length, 0, 'old check results must not validate a new attempt');
  assert.equal(corrected.runtimes.length, 0, 'old runtime usage must not be charged to a new attempt');
  assert.equal((await db.task.findUniqueOrThrow({ where: { id: task.id } })).status, 'In Progress');
  const history = await sessions.history(task.id);
  assert.equal(history.length, 1);
  const snapshot = attemptSnapshotSchema.parse(history[0].snapshot);
  assert.equal(snapshot.output, row.output);
  assert.equal(snapshot.checks.length, 2);
  assert.deepEqual(snapshot.runtimes, reviewedRuntimes);
  assert.equal(snapshot.sessionInfo?.workspace, row.workspace);
  assert.equal(snapshot.context?.task.id, task.id);
  await sessions.tick();
  row = (await sessions.get(task.id))!;
  assert.equal(row.status, 'awaiting_approval');
  assert.equal(row.runtimes.length, 2);
  assert.equal(row.runtimes[0].phase, 'plan');
  assert.equal(calls.at(-1)?.feedback, 'Fix the failing assertion');
  assert.equal(await readFile(path.join(row.workspace!, 'result.txt'), 'utf8'), 'Edited after opening diff', 'planning retains changes without executing');
  assert.equal((await sessions.list({ search: task.id, actionable: 'true' })).total, 1);
  assert.equal((await sessions.list({ search: task.id, actionable: 'cockpit' })).items[0].status, 'awaiting_approval');
});

test('queued and question-waiting sessions can be cancelled and explicitly replanned', async () => {
  const queuedTask = await startTicket('agent-cancel-queued');
  let row = (await sessions.get(queuedTask.id))!;
  const callCount = calls.length;
  assert.equal((await sessions.cancel(queuedTask.id, row.id))?.status, 'cancelled');
  await sessions.tick();
  assert.equal(calls.length, callCount);
  await assert.rejects(sessions.cancel(queuedTask.id, row.id), /already stopped/);
  await sessions.retry(queuedTask.id, row.id);
  askNext = true;
  const job = sessions.tick();
  for (let attempt = 0; attempt < 100; attempt++) {
    row = (await sessions.get(queuedTask.id))!;
    if (row.status === 'awaiting_input') break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(row.status, 'awaiting_input');
  await sessions.cancel(queuedTask.id, row.id);
  await job;
  row = (await sessions.get(queuedTask.id))!;
  assert.equal(row.status, 'cancelled', 'late worker output must not replace cancellation');
  await assert.rejects(sessions.answer(queuedTask.id, row.id, row.questions.at(-1)!.id, 'Option B'), /not waiting/);
  const latest = (await entities.board('project-agent')).tasks.find((item) => item.id === queuedTask.id)!;
  await entities.updateTask({ ...latest, title: 'Unlocked after cancellation' });
  await sessions.retry(queuedTask.id, row.id);
  await sessions.tick();
  assert.equal((await sessions.get(queuedTask.id))?.status, 'awaiting_approval');
  assert.equal((await sessions.history(queuedTask.id)).length, 2);
});

test('cancelling execution preserves partial files and does not report completion', async () => {
  const task = await startTicket('agent-cancel-execute');
  await sessions.tick();
  let row = (await sessions.get(task.id))!;
  await sessions.approve(task.id, row.id, row.updatedAt);
  waitExecution = true;
  const job = sessions.tick();
  for (let attempt = 0; attempt < 100; attempt++) {
    row = (await sessions.get(task.id))!;
    if (row.status === 'executing' && row.output) break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(row.output, 'Copilot is working on the approved plan.');
  assert.equal(await readFile(path.join(row.workspace!, 'result.txt'), 'utf8'), 'implemented');
  await sessions.cancel(task.id, row.id);
  await job;
  waitExecution = false;
  row = (await sessions.get(task.id))!;
  assert.equal(row.status, 'cancelled');
  assert.equal((await db.task.findUniqueOrThrow({ where: { id: task.id } })).status, 'In Progress');
  assert.equal(await readFile(path.join(row.workspace!, 'result.txt'), 'utf8'), 'implemented');
  assert.ok((await sessions.review(task.id)).files.some((file) => file.path === 'result.txt'));
});

test('blocked is informational and review returns reuse a worktree with a fresh plan', async () => {
  let task = await startTicket('agent-review-return');
  await sessions.tick();
  let row = (await sessions.get(task.id))!;
  await sessions.approve(task.id, row.id, row.updatedAt);
  await sessions.tick();
  task = (await entities.board('project-agent')).tasks.find((item) => item.id === task.id)!;
  assert.equal(task.status, 'Review');
  const blocked = await entities.updateTask({ ...task, blockedReason: 'Waiting for API credentials' });
  await entities.moveTask(task.id, { revision: blocked.revision, status: 'In Progress' });
  await sessions.tick();
  const newPlan = (await sessions.get(task.id))!;
  assert.equal(newPlan.workspace, row.workspace);
  assert.equal(newPlan.attempt, 2);
  assert.equal(newPlan.status, 'awaiting_approval');
  await assert.rejects(sessions.approve(task.id, row.id, row.updatedAt), /plan changed/);
  await sessions.approve(task.id, row.id, newPlan.updatedAt);
  await sessions.tick();
  assert.equal((await sessions.get(task.id))?.status, 'completed');
  await sessions.retry(task.id, row.id, 'Try again while the informational flag is set');
  assert.equal((await sessions.get(task.id))?.status, 'queued');
  assert.equal((await db.task.findUniqueOrThrow({ where: { id: task.id } })).blockedReason, blocked.blockedReason);
  await sessions.cancel(task.id, row.id);
});

test('new HTTP review, feedback, cancellation, history and health endpoints validate inputs', async () => {
  const task = await startTicket('agent-new-http');
  await sessions.tick();
  const row = (await sessions.get(task.id))!;
  const post = (action: string, value: unknown) => fetch(`${api}/tasks/${task.id}/session/${action}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value),
  });
  assert.equal((await post('feedback', { sessionId: row.id, feedback: ' ' })).status, 400);
  assert.equal((await post('cancel', { sessionId: 'invalid' })).status, 400);
  assert.equal((await post('accept-review', { sessionId: row.id, updatedAt: row.updatedAt, token: 'bad' })).status, 400);
  assert.equal((await post('feedback', { sessionId: row.id, updatedAt: '2020-01-01T00:00:00.000Z', feedback: 'Outdated feedback' })).status, 409);
  assert.equal((await fetch(`${api}/tasks/${task.id}/session/review`)).status, 200);
  assert.equal((await fetch(`${api}/tasks/${task.id}/session/review?path=missing`)).status, 404);
  assert.equal((await post('feedback', { sessionId: row.id, updatedAt: row.updatedAt, feedback: 'Add validation' })).status, 200);
  assert.equal((await fetch(`${api}/tasks/${task.id}/session/review`)).status, 409);
  assert.equal((await fetch(`${api}/tasks/${task.id}/session/history`).then((res) => res.json())).length, 1);
  assert.equal((await post('cancel', { sessionId: row.id })).status, 200);
  assert.equal((await fetch(`${api}/agent-sessions?actionable=no`)).status, 400);
  assert.equal((await fetch(`${api}/agent-sessions?actionable=cockpit`)).status, 200);
  const health = await fetch(`${api}/projects/project-agent/health`).then((res) => res.json());
  assert.equal(health.branch, 'main');
  assert.ok(health.issues.includes('No npm test script is available'));
  assert.equal(health.authenticated, null);
  assert.ok(health.worktrees.length > 0);
  assert.equal((await fetch(`${api}/projects/missing/health`)).status, 404);
});

test('cleanup refuses ticket changes and only removes stopped unchanged worktrees, preserving branch and history', async () => {
  const task = await startTicket('agent-cleanup');
  await sessions.tick();
  let row = (await sessions.get(task.id))!;
  await assert.rejects(sessions.cleanup(task.id, row.id, row.updatedAt), /Only stopped/);
  await sessions.cancel(task.id, row.id);
  row = (await sessions.get(task.id))!;
  await writeFile(path.join(row.workspace!, 'keep.txt'), 'Do not delete this file');
  await assert.rejects(sessions.cleanup(task.id, row.id, row.updatedAt), /contains ticket changes/);
  assert.equal(await readFile(path.join(row.workspace!, 'keep.txt'), 'utf8'), 'Do not delete this file');
  await unlink(path.join(row.workspace!, 'keep.txt'));
  await assert.rejects(sessions.cleanup(task.id, row.id, '2020-01-01T00:00:00.000Z'), /changed or is unavailable/);
  const removed = (await sessions.cleanup(task.id, row.id, row.updatedAt))!;
  assert.equal(removed.workspace, null);
  assert.equal(removed.branch, row.branch);
  await assert.rejects(readFile(path.join(row.workspace!, 'README.md')), /ENOENT/);
  await sessions.retry(task.id, row.id);
  await sessions.tick();
  const replanned = (await sessions.get(task.id))!;
  assert.equal(replanned.status, 'awaiting_approval');
  assert.equal(replanned.workspace, row.workspace);
  assert.equal(replanned.baseCommit, row.baseCommit);
  assert.equal(replanned.attempt, 2);
  assert.equal((await sessions.history(task.id)).length, 1);
});

test('board workflow summaries are scoped, compact, complete and match session progress', async () => {
  const tasks = [];
  for (let index = 0; index < 26; index++) tasks.push(await startTicket(`workflow-${index}`));
  const scopedResponse = await fetch(`${api}/agent-workflows?projectId=project-agent`);
  assert.equal(scopedResponse.status, 200);
  const scoped = agentWorkflowsSchema.parse(await scopedResponse.json());
  for (const task of tasks) {
    assert.deepEqual(scoped[task.id], {
      plan: 'pending', approval: 'pending', execution: 'active', review: 'pending', delivery: 'pending',
    });
    assert.deepEqual(Object.keys(scoped[task.id]), ['plan', 'approval', 'execution', 'review', 'delivery']);
  }
  assert.ok(Object.keys(scoped).length >= 26, 'board summaries are not limited to one sessions page');
  assert.deepEqual(await sessions.workflows(), scoped);
  const now = new Date().toISOString();
  await entities.createProject({
    id: 'workflow-other-project', revision: 0, name: 'Other project', description: '', color: '#6366f1',
    createdAt: now, updatedAt: now,
  });
  const otherTask = await entities.createTask(taskSchema.parse({
    ...tasks[0], id: 'workflow-other-task', revision: 0, projectId: 'workflow-other-project', status: 'To Do',
  }));
  await entities.moveTask(otherTask.id, { revision: otherTask.revision, status: 'In Progress' });
  const otherWorkflows = await sessions.workflows('workflow-other-project');
  assert.ok(otherWorkflows[otherTask.id]);
  assert.ok(tasks.every((task) => !(task.id in otherWorkflows)));
  assert.ok(!(otherTask.id in await sessions.workflows('project-agent')));
  assert.ok(otherTask.id in await sessions.workflows());
  assert.equal((await fetch(`${api}/agent-workflows?projectId=missing`)).status, 404);
  assert.equal((await fetch(`${api}/agent-workflows?projectId=`)).status, 400);
  const task = tasks[0];
  await db.agentSession.update({ where: { taskId: task.id }, data: {
    status: 'executing', resumeStatus: 'executing', plan: 'Private implementation plan', output: 'Private agent output',
  } });
  const executing = (await sessions.workflows('project-agent'))[task.id];
  assert.deepEqual(executing, {
    plan: 'completed', approval: 'completed', execution: 'active', review: 'pending', delivery: 'pending',
  });
  const listed = (await sessions.list({ search: task.id })).items.find((item) => item.taskId === task.id);
  assert.deepEqual(listed?.workflow, executing);
  assert.ok(!JSON.stringify(executing).includes('Private'));
  await db.agentSession.updateMany({ where: { taskId: { in: tasks.map((item) => item.id) } }, data: { status: 'cancelled' } });
  await db.agentSession.update({ where: { taskId: otherTask.id }, data: { status: 'cancelled' } });
});
