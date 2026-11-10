import { after, beforeEach, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { INITIAL_PROJECTS, INITIAL_FEATURES, INITIAL_TASKS } from '../../shared/data/initialData';
import { BoardApiError } from './apiClient';
import { agentApi } from './agentApi';
import { boardApi, loadProjects } from './boardApi';

const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
const values = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: { getItem: (key: string) => values.get(key) ?? null },
});

const calls: { route: string; method: string; body: unknown }[] = [];
let projectsPayload: unknown = null;
let boardPayload: unknown = { features: [], tasks: [] };
let failureStatus = 0;
let initializedProjects: unknown = null;

beforeEach(() => {
  mock.restoreAll();
  values.clear();
  calls.length = 0;
  projectsPayload = null;
  initializedProjects = null;
  boardPayload = { features: [], tasks: [] };
  failureStatus = 0;
  mock.method(globalThis, 'fetch', async (input: unknown, options: RequestInit) => {
    const route = String(input);
    const method = options.method || 'GET';
    const body = options.body ? JSON.parse(String(options.body)) : undefined;
    calls.push({ route, method, body });
    if (failureStatus) return Response.json({ error: 'Database unavailable' }, { status: failureStatus });
    if (route.endsWith('/projects') && method === 'GET') return Response.json(projectsPayload);
    if (route.includes('/board') && method === 'GET') return Response.json(boardPayload);
    if (route.endsWith('/initialize') && method === 'POST') {
      projectsPayload = initializedProjects;
      return Response.json({ initialized: true });
    }
    if (route.includes('/tasks/') && route.endsWith('/move') && method === 'POST') {
      const task = (boardPayload as { tasks: unknown[] }).tasks[0] as Record<string, unknown>;
      return Response.json([{ ...task, status: (body as { status: string }).status, revision: Number(task.revision) + 1 }]);
    }
    if (method === 'DELETE' || route.endsWith('/reset')) return new Response(null, { status: 204 });
    return Response.json(body);
  });
});

after(() => {
  mock.restoreAll();
  if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
  else Reflect.deleteProperty(globalThis, 'localStorage');
});

test('empty database requests server demo data without sending seed collections', async () => {
  const projects = INITIAL_PROJECTS.map((project) => ({ ...project, revision: 0, stats: {
    totalTasks: 0, completedTasks: 0, inProgressTasks: 0, completionRate: 0, totalFeatures: 0,
  } }));
  initializedProjects = projects;
  const loaded = await loadProjects();
  assert.equal(loaded.length, projects.length);
  assert.deepEqual(calls.map((call) => `${call.method} ${call.route.split('/api/board')[1]}`), [
    'GET /projects', 'POST /initialize', 'GET /projects',
  ]);
  assert.deepEqual(calls[1].body, { legacy: {} });
});

test('legacy migration sends only stored collections and preserves explicit empty arrays', async () => {
  initializedProjects = [];
  values.set('kanban_flow_features_v1', '[]');
  values.set('kanban_flow_tasks_v1', '[]');
  await loadProjects();
  assert.deepEqual(calls[1].body, { legacy: { features: [], tasks: [] } });
});

test('legacy migration sends custom data for server-side link normalization', async () => {
  initializedProjects = [];
  const project = { ...INITIAL_PROJECTS[0], id: 'legacy-project', revision: 3 };
  const feature = { ...INITIAL_FEATURES[0], projectId: undefined, revision: 4 };
  const task = { ...INITIAL_TASKS[0], projectId: undefined, featureId: 'removed-feature', revision: 5,
    blockedReason: '', contextFiles: [], agentProvider: 'copilot' };
  values.set('kanban_flow_projects_v1', JSON.stringify([project]));
  values.set('kanban_flow_features_v1', JSON.stringify([feature]));
  values.set('kanban_flow_tasks_v1', JSON.stringify([task]));
  await loadProjects();
  assert.deepEqual(calls[1].body, { legacy: {
    projects: [project], features: [JSON.parse(JSON.stringify(feature))], tasks: [JSON.parse(JSON.stringify(task))],
  } });
});

test('existing projects skip initialization even with malformed legacy keys', async () => {
  const projects = [{ ...INITIAL_PROJECTS[0], revision: 2, stats: {
    totalTasks: 10, completedTasks: 3, inProgressTasks: 2, completionRate: 30, totalFeatures: 3,
  } }];
  projectsPayload = projects;
  values.set('kanban_flow_tasks_v1', '{broken');
  assert.deepEqual(await loadProjects(), projects);
  assert.equal(calls.length, 1);
});

test('project board load, task move and deletes call atomic endpoints', async () => {
  const task = { ...INITIAL_TASKS[0], revision: 4, projectId: 'proj-cloud-saas' };
  boardPayload = { features: INITIAL_FEATURES.map((feature) => ({ ...feature, revision: 0 })), tasks: [task] };
  const board = await boardApi.load('proj-cloud-saas');
  assert.equal(board.tasks.length, 1);
  await boardApi.moveTask(board.tasks[0], 'Review', 0);
  await boardApi.deleteTask(board.tasks[0]);
  assert.deepEqual(calls.slice(1).map((call) => call.method), ['POST', 'DELETE']);
  const movePayload = calls[1].body as { revision: number; status: string };
  assert.equal(movePayload.revision, 4);
  assert.equal(movePayload.status, 'Review');
});

test('API errors are surfaced with status and message', async () => {
  failureStatus = 409;
  await assert.rejects(boardApi.reset(), (error: unknown) =>
    error instanceof BoardApiError &&
    error.status === 409 &&
    error.message === 'Database unavailable');
});

test('agent options load the provider model catalogue and surface failures', async () => {
  const options = { providers: [{
    id: 'copilot', name: 'GitHub Copilot', defaultModel: null, available: true, experimental: false, issue: null,
    models: [{ id: 'model-a', name: 'Model A' }],
  }] };
  boardPayload = options;
  assert.deepEqual(await agentApi.agentOptions(), options);
  assert.equal(calls.at(-1)?.route, '/api/board/agent-options');
  failureStatus = 503;
  await assert.rejects(agentApi.agentOptions(), /Database unavailable/);
});

test('HTML returned by an outdated server gives an actionable error instead of a JSON parse error', async () => {
  mock.method(globalThis, 'fetch', async () => new Response('<!doctype html><html></html>', {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  }));
  await assert.rejects(agentApi.agentSessions({}), (error: unknown) =>
    error instanceof BoardApiError &&
    error.status === 200 &&
    error.message.includes('/api/board/agent-sessions') &&
    error.message.includes('make dev'));
});

test('non-JSON HTTP errors retain their status and identify the API route', async () => {
  mock.method(globalThis, 'fetch', async () => new Response('<!doctype html>', {
    status: 502, headers: { 'Content-Type': 'text/html' },
  }));
  await assert.rejects(agentApi.agentSession('task-1'), (error: unknown) =>
    error instanceof BoardApiError &&
    error.status === 502 &&
    error.message.includes('/api/board/tasks/task-1/session'));
});

test('invalid legacy JSON fails fast and never sends initialize request', async () => {
  values.set('kanban_flow_tasks_v1', '{broken');
  await assert.rejects(loadProjects(), SyntaxError);
  assert.equal(calls.length, 1);
});

test('invalid legacy collections fail before initialization instead of requesting demo defaults', async () => {
  for (const [key, value] of [
    ['kanban_flow_projects_v1', '[]'],
    ['kanban_flow_features_v1', 'null'],
    ['kanban_flow_tasks_v1', '{}'],
  ]) {
    values.clear();
    calls.length = 0;
    values.set(key, value);
    await assert.rejects(loadProjects());
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, 'GET');
  }
});
