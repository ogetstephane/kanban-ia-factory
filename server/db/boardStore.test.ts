import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import express from 'express';
import { PrismaClient } from '@prisma/client';
import { INITIAL_PROJECTS, INITIAL_FEATURES, INITIAL_TASKS } from '../../src/data/initialData';
import { boardDataSchema } from '../../src/types/board';
import { createBoardRouter } from '../routes/board';
import { BoardStore } from './boardStore';
import { EntityStore } from './entityStore';
import { RepositoryService } from '../git/repositoryService';
import { createSourceRepository } from '../git/testRepository';
import { gitInventorySchema } from '../../src/types/git';
import { ActivityService } from './activityService';
import { createActivityRouter } from '../routes/activity';

let directory: string;
let db: PrismaClient;
let store: BoardStore;
let server: Server;
let url: string;
let repositories: RepositoryService;
let source: { url: string; devCommit: string };

const demo = boardDataSchema.parse({
  projects: INITIAL_PROJECTS,
  features: INITIAL_FEATURES,
  tasks: INITIAL_TASKS,
});

before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'kanban-orm-test-'));
  const databaseUrl = `file:${path.join(directory, 'test.db')}`;
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'pipe',
  });
  db = new PrismaClient({ datasourceUrl: databaseUrl });
  store = new BoardStore(db);
  source = await createSourceRepository(path.join(directory, 'source'));
  repositories = new RepositoryService(path.join(directory, 'workspaces'), { localRoots: [directory] });
  const app = express();
  app.use(express.json());
  app.use('/api/board', createBoardRouter(store, new EntityStore(db), repositories));
  app.use('/api/board', createActivityRouter(new ActivityService(db)));
  server = await new Promise<Server>((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  url = `http://127.0.0.1:${address.port}/api/board`;
});

after(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
  if (db) await db.$disconnect();
  if (directory) await rm(directory, { recursive: true, force: true });
});

test('initializes once and keeps seeded order', async () => {
  assert.equal(await store.read(), null);
  const init = await fetch(`${url}/initialize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(demo),
  });
  assert.equal(init.status, 200);
  const projects = await fetch(`${url}/projects`).then((response) => response.json());
  assert.equal(projects.length, demo.projects.length);
  assert.equal(projects[0].id, demo.projects[0].id);
  const board = await fetch(`${url}/projects/${encodeURIComponent(demo.projects[0].id)}/board`).then((response) => response.json());
  assert.ok(board.features.length > 0);
  assert.ok(board.tasks.length > 0);
});

test('task updates are atomic and guarded by revision conflicts', async () => {
  const project = (await fetch(`${url}/projects`).then((response) => response.json()))[0];
  const board = await fetch(`${url}/projects/${encodeURIComponent(project.id)}/board`).then((response) => response.json());
  const firstTask = board.tasks[0];
  const updated = await fetch(`${url}/tasks/${encodeURIComponent(firstTask.id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...firstTask, title: 'Atomic task update works' }),
  });
  assert.equal(updated.status, 200);
  const activity = await fetch(`${url}/activity-events?entityType=task&search=Atomic`).then((response) => response.json());
  assert.equal(activity.total, 1);
  assert.equal(activity.items[0].entityId, firstTask.id);
  assert.equal(activity.items[0].changes.find((change: { field: string }) => change.field === 'Title').before, firstTask.title);
  assert.equal(activity.items[0].changes.find((change: { field: string }) => change.field === 'Title').after, 'Atomic task update works');
  const history = await fetch(`${url}/activity-events/task/${encodeURIComponent(firstTask.id)}`).then((response) => response.json());
  assert.equal(history.total, 1);
  assert.equal(history.items[0].action, 'updated');
  const stale = await fetch(`${url}/tasks/${encodeURIComponent(firstTask.id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...firstTask, title: 'Stale write should fail' }),
  });
  assert.equal(stale.status, 409);
});

test('deleting a feature detaches linked tasks without deleting them', async () => {
  const project = (await fetch(`${url}/projects`).then((response) => response.json()))[0];
  const board = await fetch(`${url}/projects/${encodeURIComponent(project.id)}/board`).then((response) => response.json());
  const feature = board.features.find((item: { id: string }) => board.tasks.some((task: { featureId?: string }) => task.featureId === item.id));
  assert.ok(feature);
  const linkedTask = board.tasks.find((item: { featureId?: string }) => item.featureId === feature.id);
  assert.ok(linkedTask);
  const removed = await fetch(`${url}/features/${encodeURIComponent(feature.id)}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ revision: feature.revision }),
  });
  assert.equal(removed.status, 204);
  const refreshed = await fetch(`${url}/projects/${encodeURIComponent(project.id)}/board`).then((response) => response.json());
  const task = refreshed.tasks.find((item: { id: string }) => item.id === linkedTask.id);
  assert.ok(task);
  assert.equal(task.featureId, undefined);
});

test('an epic cannot enter review until all its tickets are done', async () => {
  const project = (await fetch(`${url}/projects`).then((response) => response.json()))[0];
  const board = await fetch(`${url}/projects/${encodeURIComponent(project.id)}/board`).then((response) => response.json());
  const feature = board.features.find((item: { id: string; status: string }) =>
    item.status === 'In Progress' && board.tasks.some((task: { featureId?: string }) => task.featureId === item.id));
  assert.ok(feature);
  const linkedTask = board.tasks.find((item: { featureId?: string }) => item.featureId === feature.id);
  assert.ok(linkedTask);

  const moved = await fetch(`${url}/features/${encodeURIComponent(feature.id)}`, json('PUT', {
    ...feature, status: 'Review',
  }));
  assert.equal(moved.status, 409);
  assert.match((await moved.json()).error, /All tickets in the epic must be Done/);
  const refreshed = await fetch(`${url}/projects/${encodeURIComponent(project.id)}/board`).then((response) => response.json());
  assert.equal(refreshed.features.find((item: { id: string }) => item.id === feature.id).status, 'In Progress');
  assert.equal(refreshed.tasks.find((item: { id: string }) => item.id === linkedTask.id).status, linkedTask.status);
  const invalidMove = await fetch(`${url}/features/${encodeURIComponent(feature.id)}`, json('PUT', {
    ...feature, status: 'To Do',
  }));
  assert.equal(invalidMove.status, 422);
  assert.match((await invalidMove.json()).error, /An epic cannot move from In Progress to To Do/);
});

test('reset repopulates demo entities and keeps at least one project', async () => {
  const projects = await fetch(`${url}/projects`).then((response) => response.json());
  const removed = await fetch(`${url}/projects/${encodeURIComponent(projects[0].id)}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ revision: projects[0].revision }),
  });
  assert.equal(removed.status, 204);
  const reset = await fetch(`${url}/reset`, { method: 'POST' });
  assert.equal(reset.status, 204);
  const refreshed = await fetch(`${url}/projects`).then((response) => response.json());
  assert.equal(refreshed.length, INITIAL_PROJECTS.length);
});

const json = (method: string, body: unknown) => ({
  method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
const newProject = (id: string) => ({
  id, name: id, description: '', color: '#6366f1',
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
});

test('creating a project with a repository clones it first', async () => {
  const response = await fetch(`${url}/projects`, json('POST', {
    ...newProject('proj-git'), repository: { url: source.url, branch: 'dev' },
  }));
  assert.equal(response.status, 200);
  const created = await response.json();
  assert.equal(created.repositoryUrl, source.url);
  assert.equal(created.repositoryBranch, 'dev');
  assert.equal(created.repositoryCommit, source.devCommit);
  await access(path.join(repositories.pathFor('proj-git'), 'DEV.md'));

  const updated = await fetch(`${url}/projects/proj-git`, json('PUT', {
    ...created, name: 'Renamed', repositoryUrl: 'https://evil.example/repo.git',
  })).then((res) => res.json());
  assert.equal(updated.name, 'Renamed');
  assert.equal(updated.repositoryUrl, source.url);

  const removed = await fetch(`${url}/projects/proj-git`, json('DELETE', { revision: updated.revision }));
  assert.equal(removed.status, 204);
  await assert.rejects(access(repositories.pathFor('proj-git')));
});

test('a failed clone does not create the project', async () => {
  const response = await fetch(`${url}/projects`, json('POST', {
    ...newProject('proj-bad'), repository: { url: source.url, branch: 'missing' },
  }));
  assert.equal(response.status, 422);
  assert.match((await response.json()).error, /Git failed/);
  const projects = await fetch(`${url}/projects`).then((res) => res.json());
  assert.ok(!projects.some((project: { id: string }) => project.id === 'proj-bad'));
  await assert.rejects(access(repositories.pathFor('proj-bad')));
});

test('clients cannot set repository fields without cloning', async () => {
  const created = await fetch(`${url}/projects`, json('POST', {
    ...newProject('proj-plain'), repositoryUrl: 'https://evil.example/repo.git',
  })).then((res) => res.json());
  assert.equal(created.repositoryUrl, undefined);
});

test('lists branches of a repository', async () => {
  const branches = await fetch(`${url}/repositories/branches`, json('POST', { url: source.url })).then((res) => res.json());
  assert.deepEqual(branches, { defaultBranch: 'main', branches: ['dev', 'main'] });
});

test('switching branch updates the clone and the project atomically', async () => {
  const created = await fetch(`${url}/projects`, json('POST', {
    ...newProject('proj-switch'), repository: { url: source.url },
  })).then((res) => res.json());
  assert.equal(created.repositoryBranch, 'main');
  const branches = await fetch(`${url}/projects/proj-switch/branches`).then((res) => res.json());
  assert.deepEqual(branches, { current: 'main', branches: ['dev', 'main'] });

  const switched = await fetch(`${url}/projects/proj-switch/branch`, json('PUT', { branch: 'dev', revision: created.revision }));
  assert.equal(switched.status, 200);
  const project = await switched.json();
  assert.equal(project.repositoryBranch, 'dev');
  assert.equal(project.repositoryCommit, source.devCommit);
  assert.equal(project.revision, created.revision + 1);

  const stale = await fetch(`${url}/projects/proj-switch/branch`, json('PUT', { branch: 'main', revision: created.revision }));
  assert.equal(stale.status, 409);
  const missing = await fetch(`${url}/projects/proj-switch/branch`, json('PUT', { branch: 'nope', revision: project.revision }));
  assert.equal(missing.status, 404);
  assert.equal((await fetch(`${url}/projects/proj-switch/branches`).then((res) => res.json())).current, 'dev');

  const plain = await fetch(`${url}/projects`, json('POST', newProject('proj-nogit'))).then((res) => res.json());
  const noRepo = await fetch(`${url}/projects/proj-nogit/branch`, json('PUT', { branch: 'main', revision: plain.revision }));
  assert.equal(noRepo.status, 400);
});

test('all-project board returns each entity once and keeps task ownership on edits and moves', async () => {
  const all = await fetch(`${url}/board`);
  assert.equal(all.status, 200);
  assert.equal(all.headers.get('cache-control'), 'no-store');
  const board = await all.json();
  assert.equal(board.tasks.length, await db.task.count());
  assert.equal(board.features.length, await db.feature.count());
  assert.equal(new Set(board.tasks.map((task: { id: string }) => task.id)).size, board.tasks.length);
  const owners = new Set(board.tasks.map((task: { projectId?: string }) => task.projectId));
  assert.ok(owners.size > 1, 'includes tasks of multiple projects');
  const terminalFeatureIds = new Set(board.features
    .filter((feature: { status: string }) => feature.status === 'Review' || feature.status === 'Done')
    .map((feature: { id: string }) => feature.id));
  const task = board.tasks.find((task: { status: string; featureId?: string }) =>
    task.status === 'Backlog' && (!task.featureId || !terminalFeatureIds.has(task.featureId)));
  assert.ok(task);
  const saved = await fetch(`${url}/tasks/${task.id}`, json('PUT', { ...task, title: 'Edited from aggregate board' }));
  assert.equal(saved.status, 200);
  const updated = await saved.json();
  assert.equal(updated.projectId, task.projectId);
  const moved = await fetch(`${url}/tasks/${task.id}/move`, json('POST', { revision: updated.revision, status: 'To Do' }));
  assert.equal(moved.status, 200);
  const changes = await moved.json();
  assert.ok(changes.every((item: { projectId?: string }) => item.projectId === task.projectId), 'reorders only the owning project');
  assert.equal((await db.task.findUniqueOrThrow({ where: { id: task.id } })).projectId, task.projectId);
  assert.equal(await db.project.count({ where: { id: 'All' } }), 0, 'All is a UI scope, not a stored project');
});

test('global Git inventory includes real worktrees and ticket links, excludes non-Git projects and isolates unavailable clones', async () => {
  const projectId = 'proj-inventory';
  await fetch(`${url}/projects`, json('POST', {
    ...newProject(projectId), repository: { url: source.url },
  }));
  const now = new Date().toISOString();
  const task = await fetch(`${url}/tasks`, json('POST', {
    id: 'inventory-ticket', projectId, title: 'Linked Git ticket', description: '', status: 'To Do', priority: 'Medium',
    storyPoints: 1, tags: [], acceptanceCriteria: [], subtasks: [], order: 0, createdAt: now, updatedAt: now,
  })).then((res) => res.json());
  await fetch(`${url}/tasks/${task.id}/move`, json('POST', { revision: task.revision, status: 'In Progress' }));
  const session = await db.agentSession.findUniqueOrThrow({ where: { taskId: task.id } });
  const ticket = await repositories.ticketWorkspace(projectId, session.id, 'main');
  await db.agentSession.update({ where: { id: session.id }, data: { workspace: ticket.workspace, branch: ticket.branch, status: 'completed' } });
  const orphan = await repositories.ticketWorkspace(projectId, 'orphan-session', 'main');
  const root = repositories.pathFor(projectId);
  execFileSync('git', ['switch', 'dev'], { cwd: root, stdio: 'pipe' });
  await fetch(`${url}/projects`, json('POST', {
    ...newProject('proj-inventory-missing'), repository: { url: source.url },
  }));
  await repositories.remove('proj-inventory-missing');
  const response = await fetch(`${url}/repositories/inventory`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const inventory = gitInventorySchema.parse(await response.json());
  assert.ok(!inventory.projects.some((project) => project.id === 'proj-plain'));
  const project = inventory.projects.find((project) => project.id === projectId)!;
  assert.equal(project.url, source.url);
  assert.equal(project.branch, 'dev', 'reads actual Git state instead of persisted metadata');
  assert.equal(project.configuredBranch, 'main');
  assert.equal(project.error, null);
  const scoped = gitInventorySchema.parse(await fetch(`${url}/repositories/inventory?projectId=${projectId}`).then((res) => res.json()));
  assert.deepEqual(scoped.projects.map((item) => item.id), [projectId]);
  const plain = gitInventorySchema.parse(await fetch(`${url}/repositories/inventory?projectId=proj-plain`).then((res) => res.json()));
  assert.deepEqual(plain.projects, []);
  assert.equal((await fetch(`${url}/repositories/inventory?projectId=`)).status, 400);
  assert.equal(project.worktrees.length, 3);
  assert.deepEqual(project.worktrees.find((tree) => tree.path === ticket.workspace)?.task, {
    id: task.id, title: 'Linked Git ticket', status: 'In Progress', sessionStatus: 'completed',
  });
  assert.equal(project.worktrees.find((tree) => tree.path === orphan.workspace)?.task, null);
  assert.equal(project.worktrees[0].task, null);
  assert.match(inventory.projects.find((project) => project.id === 'proj-inventory-missing')!.error!, /No cloned repository/);
  const moved = path.join(directory, 'moved ticket worktree');
  execFileSync('git', ['worktree', 'move', ticket.workspace, moved], { cwd: root, stdio: 'pipe' });
  const refreshed = gitInventorySchema.parse(await fetch(`${url}/repositories/inventory`).then((res) => res.json()));
  assert.equal(refreshed.projects.find((project) => project.id === projectId)!.worktrees.find((tree) => tree.path === moved)?.task?.id, task.id);
  await db.task.delete({ where: { id: task.id } });
  const deleted = gitInventorySchema.parse(await fetch(`${url}/repositories/inventory`).then((res) => res.json()));
  assert.equal(deleted.projects.find((project) => project.id === projectId)!.worktrees.find((tree) => tree.path === moved)?.task, null);
  execFileSync('git', ['worktree', 'remove', moved], { cwd: root, stdio: 'pipe' });
});

test('task workflow transitions are enforced on move, update and create', async () => {
  const project = (await fetch(`${url}/projects`).then((res) => res.json()))[0];
  const now = new Date().toISOString();
  const draft = {
    id: 'task-flow', projectId: project.id, title: 'Flow', description: '', status: 'In Progress', priority: 'Medium',
    storyPoints: 1, tags: [], acceptanceCriteria: [], subtasks: [], order: 0, createdAt: now, updatedAt: now,
  };
  assert.equal((await fetch(`${url}/tasks`, json('POST', draft))).status, 422);
  let task = await fetch(`${url}/tasks`, json('POST', { ...draft, status: 'Backlog' })).then((res) => res.json());
  assert.equal(task.status, 'Backlog');

  const move = async (status: string) => fetch(`${url}/tasks/task-flow/move`, json('POST', { revision: task.revision, status }));
  const skip = await move('In Progress');
  assert.equal(skip.status, 422);
  assert.match((await skip.json()).error, /Backlog to In Progress/);
  for (const status of ['To Do', 'Backlog', 'To Do', 'In Progress', 'Review']) {
    const response = await move(status);
    assert.equal(response.status, 200, status);
    task = (await response.json()).find((item: { id: string }) => item.id === 'task-flow');
    if (status === 'In Progress') {
      // This test isolates workflow transitions; agent orchestration has its own integration tests.
      await db.agentSession.updateMany({ where: { taskId: task.id }, data: { status: 'completed' } });
    }
  }
  const returned = await move('In Progress');
  assert.equal(returned.status, 200);
  task = (await returned.json()).find((item: { id: string }) => item.id === 'task-flow');
  await db.agentSession.updateMany({ where: { taskId: task.id }, data: { status: 'completed' } });
  const reviewedAgain = await move('Review');
  assert.equal(reviewedAgain.status, 200);
  task = (await reviewedAgain.json()).find((item: { id: string }) => item.id === 'task-flow');
  assert.equal((await move('Review')).status, 200, 'reordering within a column is allowed');
  task = (await fetch(`${url}/projects/${project.id}/board`).then((res) => res.json())).tasks.find((item: { id: string }) => item.id === 'task-flow');

  assert.equal((await fetch(`${url}/tasks/task-flow`, json('PUT', { ...task, status: 'To Do' }))).status, 422);
  const done = await fetch(`${url}/tasks/task-flow`, json('PUT', { ...task, status: 'Done' }));
  assert.equal(done.status, 200);
  task = await done.json();
  assert.equal((await move('Review')).status, 422);
});
