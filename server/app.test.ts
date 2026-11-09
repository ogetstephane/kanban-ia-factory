import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import { PrismaClient } from '@prisma/client';
import { createApp, type KanbanApp } from './app';
import type { AgentProvider, AgentRequest } from './agents/provider';
import { CodeGraph } from './agents/codeGraph';
import { RepositoryService } from './git/repositoryService';
import { createSourceRepository } from './git/testRepository';

let directory: string;
let db: PrismaClient;
let kanban: KanbanApp;
let server: Server;
let base: string;
let repositoryUrl: string;
const calls: AgentRequest[] = [];

// Stands in for Copilot in auto mode: same provider id, direct execution, and a real change in the ticket worktree.
const simulatedAgent: AgentProvider = {
  id: 'copilot',
  models: async () => [{ id: 'simulated-model', name: 'Simulated model' }],
  async run(request) {
    calls.push(request);
    await request.onSession(`simulated-${request.phase}`);
    if (request.phase === 'plan') return 'Simulated plan: create agent-result.txt.';
    await writeFile(path.join(request.workspace, 'agent-result.txt'), `Implemented ${request.context.task.title}\n`);
    return 'Simulated execution: agent-result.txt created.';
  },
};

before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'kanban-app-test-'));
  const databaseUrl = `file:${path.join(directory, 'test.db')}`;
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: 'pipe',
  });
  db = new PrismaClient({ datasourceUrl: databaseUrl });
  repositoryUrl = (await createSourceRepository(path.join(directory, 'source'))).url;
  const repositories = new RepositoryService(path.join(directory, 'workspaces'), { localRoots: [directory] });
  kanban = createApp({
    db, repositories, agentProvider: simulatedAgent,
    codeGraph: new CodeGraph({ enabled: false }),
    archifyDir: path.join(directory, 'archify'),
  });
  server = await new Promise<Server>((resolve) => {
    const listener = kanban.app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  base = `http://127.0.0.1:${address.port}/api`;
});

after(async () => {
  await kanban?.sessions.stop();
  await kanban?.releases.stop();
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
  await db?.$disconnect();
  if (directory) await rm(directory, { recursive: true, force: true });
});

async function api(method: string, route: string, body?: unknown) {
  const response = await fetch(`${base}${route}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : undefined };
}

test('creates the API without starting background work or calling external AI', async () => {
  const health = await api('GET', '/health');
  assert.equal(health.status, 200);
  assert.equal(health.body.status, 'ok');
  assert.deepEqual(Object.keys(health.body).sort(), ['status', 'timestamp']);

  const breakdown = await api('POST', '/copilot/breakdown', { featureTitle: 'User login' });
  assert.equal(breakdown.status, 200);
  assert.ok(breakdown.body.tasks.length > 0);
  assert.equal((await api('POST', '/copilot/breakdown', {})).status, 400);

  const description = await api('POST', '/copilot/generate-description', { title: 'Improve board loading' });
  assert.equal(description.status, 200);
  assert.equal(description.body.title, 'Improve board loading');
  assert.ok(description.body.acceptanceCriteria.length > 0);

  const workflow = await api('POST', '/copilot/suggest-workflow', {
    summaryData: { totalTasks: 5, wipCount: 2, reviewQueueCount: 1 },
  });
  assert.equal(workflow.status, 200);
  assert.equal(typeof workflow.body.healthScore, 'number');

  const chat = await api('POST', '/copilot/chat', { message: 'What can you help with?' });
  assert.equal(chat.status, 200);
  assert.match(chat.body.reply, /Kanban Flow Copilot/);

  const missing = await api('GET', '/does-not-exist');
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error, 'Unknown API route: GET /api/does-not-exist');

  const options = await api('GET', '/board/agent-options');
  assert.equal(options.status, 200);
  assert.deepEqual(options.body.providers[0].models, [{ id: 'simulated-model', name: 'Simulated model' }]);

  assert.equal(calls.length, 0);
  assert.equal(await db.agentSession.count(), 0);
});

test('runs a ticket from the HTTP API through the simulated agent into SQLite and its worktree', async () => {
  const now = new Date().toISOString();
  const project = await api('POST', '/board/projects', {
    id: 'project-app', name: 'App integration', description: 'Temporary project', color: '#6366f1',
    repository: { url: repositoryUrl }, createdAt: now, updatedAt: now,
  });
  assert.equal(project.status, 200, JSON.stringify(project.body));
  assert.equal(project.body.repositoryBranch, 'main');

  const created = await api('POST', '/board/tasks', {
    id: 'task-app', projectId: 'project-app', title: 'Write agent result', description: 'Create one file',
    status: 'To Do', priority: 'Medium', storyPoints: 1, tags: [], subtasks: [],
    acceptanceCriteria: ['agent-result.txt exists'], order: 0, createdAt: now, updatedAt: now,
  });
  assert.equal(created.status, 200, JSON.stringify(created.body));

  const moved = await api('POST', '/board/tasks/task-app/move', { revision: created.body.revision, status: 'In Progress' });
  assert.equal(moved.status, 200, JSON.stringify(moved.body));
  assert.equal((await api('GET', '/board/tasks/task-app/session')).body.status, 'queued');

  // Auto mode: the simulated Copilot judges this one-file ticket simple and executes it directly.
  await kanban.sessions.tick();
  const completed = (await api('GET', '/board/tasks/task-app/session')).body;
  assert.equal(completed.status, 'completed', completed.error);
  assert.equal(completed.plan, '');
  assert.equal(completed.output, 'Simulated execution: agent-result.txt created.');
  assert.equal(completed.providerSessionId, 'simulated-execute');
  assert.deepEqual(calls.map((call) => [call.phase, call.adaptive]), [['execute', true]]);
  assert.equal(calls[0].context.task.id, 'task-app');
  assert.equal(calls[0].context.project?.id, 'project-app');
  assert.ok(!path.relative(directory, completed.workspace).startsWith('..'));
  assert.equal(await readFile(path.join(completed.workspace, 'agent-result.txt'), 'utf8'), 'Implemented Write agent result\n');
  const workflows = (await api('GET', '/board/agent-workflows?projectId=project-app')).body;
  assert.deepEqual(workflows['task-app'], {
    plan: 'skipped', approval: 'skipped', execution: 'completed', review: 'waiting', delivery: 'pending',
  });

  const board = (await api('GET', '/board/projects/project-app/board')).body;
  assert.equal(board.tasks.find((task: { id: string }) => task.id === 'task-app').status, 'Review');
  const stored = await db.agentSession.findUniqueOrThrow({ where: { taskId: 'task-app' } });
  assert.equal(stored.status, 'completed');
  assert.equal(stored.provider, 'copilot');
});
