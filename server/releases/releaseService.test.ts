import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import type { Server } from 'node:http';
import { PrismaClient } from '@prisma/client';
import { taskSchema } from '../../shared/types/board';
import { versionSchema, releaseDetailSchema } from '../../shared/types/release';
import { EntityStore } from '../db/entityStore';
import { RepositoryService } from '../git/repositoryService';
import { createSourceRepository, TEST_GIT_CONFIG } from '../git/testRepository';
import { SessionService } from '../agents/sessionService';
import { createReleaseRouter } from '../routes/releases';
import { ReleaseService } from './releaseService';
import { BoardStore } from '../db/boardStore';
import { boardDataSchema } from '../../shared/types/board';
import { requiredTicketDocumentationPath } from '../agents/ticketDocumentation';
import { WorkflowEditorStore } from '../db/workflowEditorStore';
import { workflowRuntimeSnapshotSchema } from '../../shared/types/workflowEditor';

const git = (cwd: string, ...args: string[]) => execFileSync('git',
  [...TEST_GIT_CONFIG, ...(cwd.endsWith('.git') ? ['--git-dir', cwd] : []), ...args],
  { cwd, encoding: 'utf8', stdio: 'pipe', timeout: 30_000 }).trim();
const ssh = `node ${path.resolve('server/git/testSsh.cjs')}`;

async function fixture(t: TestContext) {
  const directory = await mkdtemp(path.join(tmpdir(), 'kanban-release-test-'));
  const databaseUrl = `file:${path.join(directory, 'test.db')}`;
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: 'pipe',
  });
  const db = new PrismaClient({ datasourceUrl: databaseUrl });
  const entities = new EntityStore(db);
  const repositories = new RepositoryService(path.join(directory, 'workspaces'), { localRoots: [directory] });
  const source = await createSourceRepository(path.join(directory, 'source'));
  const cloned = await repositories.workspaces.clone('project-release', { url: source.url });
  const root = repositories.workspaces.pathFor('project-release');
  git(root, 'config', 'user.name', 'Release Test');
  git(root, 'config', 'user.email', 'release@example.com');
  const bare = path.join(directory, 'origin.git');
  git(directory, 'clone', '--bare', source.url, bare);
  const remoteUrl = `ssh://release.test${bare}`;
  const previousSsh = process.env.GIT_SSH_COMMAND;
  const previousRoot = process.env.TEST_RELEASE_REMOTE_ROOT;
  process.env.GIT_SSH_COMMAND = ssh;
  process.env.TEST_RELEASE_REMOTE_ROOT = directory;
  git(root, 'remote', 'set-url', 'origin', remoteUrl);
  const now = new Date().toISOString();
  await entities.createProject({
    id: 'project-release', revision: 0, name: 'Release project', description: 'Small context', color: '#6366f1',
    repositoryUrl: cloned.url, repositoryBranch: cloned.branch, repositoryCommit: cloned.commit, createdAt: now, updatedAt: now,
  });
  const releases = new ReleaseService(db, repositories);
  const sessions = new SessionService(db, repositories, { id: 'copilot', async run(input) {
    if (input.phase === 'execute') {
      await writeFile(path.join(input.workspace, `${input.context.task.id}.txt`), 'implemented\n');
      const documentationPath = requiredTicketDocumentationPath({
        docsPath: input.context.project?.docsPath,
        taskId: input.context.task.id,
        taskTitle: input.context.task.title,
        featureTitle: input.context.feature?.title,
      });
      await mkdir(path.dirname(path.join(input.workspace, documentationPath)), { recursive: true });
      await writeFile(path.join(input.workspace, documentationPath), `# ${input.context.task.title}\n\nDocuments the ticket changes.\n`);
    }
    return 'Complete';
  } });
  t.after(async () => {
    await releases.stop(); await sessions.stop(); await db.$disconnect();
    if (previousSsh === undefined) delete process.env.GIT_SSH_COMMAND; else process.env.GIT_SSH_COMMAND = previousSsh;
    if (previousRoot === undefined) delete process.env.TEST_RELEASE_REMOTE_ROOT; else process.env.TEST_RELEASE_REMOTE_ROOT = previousRoot;
    await rm(directory, { recursive: true, force: true });
  });
  const [release] = await releases.create('project-release', { version: '1.2.0', status: 'upcoming' });
  async function ticket(id = 'ticket-release', releaseId: string | null = release.id) {
    return entities.createTask(taskSchema.parse({
      id, projectId: 'project-release', releaseId: releaseId ?? undefined, title: `Implement ${id}`, description: 'Scoped work',
      status: 'To Do', priority: 'Medium', tags: [], acceptanceCriteria: [], subtasks: [],
      order: 0, storyPoints: 1, createdAt: now, updatedAt: now,
    }));
  }
  async function deliver(id = 'ticket-release') {
    const task = await ticket(id);
    await entities.moveTask(task.id, { revision: task.revision!, status: 'In Progress' });
    await sessions.tick();
    const row = (await sessions.get(task.id))!;
    const review = await sessions.review(task.id);
    await sessions.acceptReview(task.id, row.id, row.updatedAt, review.token);
    const preview = await sessions.delivery.preview(task.id);
    const input = { ...preview, message: 'Release ticket', acknowledgeChecks: true };
    const committed = await sessions.delivery.execute(task.id, 'commit', input);
    return sessions.delivery.execute(task.id, 'merge', { ...committed, message: 'Release ticket', acknowledgeChecks: true });
  }
  async function progress() {
    const current = await releases.detail('project-release', release.id);
    if (current.status === 'upcoming') await releases.update('project-release', release.id, { revision: current.revision, version: current.version, status: 'in_progress' });
    return releases.preview('project-release', release.id);
  }
  return { db, entities, repositories, releases, sessions, directory, source, root, bare, remoteUrl, release, ticket, deliver, progress };
}

test('SemVer versions accept prereleases/builds and reject invalid or unsafe tag names', () => {
  for (const version of ['0.1.0', '1.2.0', '1.2.0-rc.1', '1.2.0-alpha-beta+build.2', '1.0.0-0']) assert.equal(versionSchema.parse(version), version);
  for (const version of ['v1.0.0', '01.2.0', '1.2', '../tag', '-a', '1.0.0-01', '1.0.0-rc..1', '1.0.0\nbad']) assert.equal(versionSchema.safeParse(version).success, false, version);
});

test('aggregate release listing keeps same versions from different projects distinct and mutations project-scoped', async (t) => {
  const f = await fixture(t);
  const now = new Date().toISOString();
  await f.entities.createProject({
    id: 'other-release-project', name: 'Other project', revision: 0, description: '', color: '#6366f1', createdAt: now, updatedAt: now,
  });
  const [other] = await f.releases.create('other-release-project', { version: f.release.version, status: 'upcoming' });
  const rows = await f.releases.list();
  assert.equal(rows.length, 2);
  assert.deepEqual(new Set(rows.map((row) => row.projectId)), new Set(['project-release', 'other-release-project']));
  assert.notEqual(other.id, f.release.id);
  await assert.rejects(f.releases.detail('project-release', other.id), /Release not found/);
  await f.releases.update(other.projectId, other.id, { version: other.version, status: 'in_progress', revision: other.revision });
  assert.equal((await f.releases.detail(f.release.projectId, f.release.id)).status, 'upcoming');
  assert.equal((await f.releases.list('other-release-project')).length, 1);
});

test('release lifecycle: local delivery then actual tag-only push, no remote branch or other tag push', async (t) => {
  const f = await fixture(t);
  const originalRemoteHead = git(f.bare, 'rev-parse', 'main');
  const delivery = await f.deliver();
  git(f.root, 'tag', 'unrelated-tag');
  git(f.root, 'config', 'push.followTags', 'true');
  const preview = await f.progress();
  assert.equal(preview.ticketCount, 1);
  assert.equal(preview.tag, 'v1.2.0');
  const published = await f.releases.publish('project-release', f.release.id, preview);
  assert.equal(published.status, 'published');
  assert.equal(published.targetCommit, delivery.delivery!.mergeHash);
  assert.equal(git(f.root, 'rev-parse', 'refs/tags/v1.2.0'), preview.commit);
  assert.equal(git(f.bare, 'rev-parse', 'refs/tags/v1.2.0'), preview.commit);
  assert.equal(git(f.bare, 'rev-parse', 'main'), originalRemoteHead, 'never pushes the branch');
  assert.equal(git(f.bare, 'tag', '--list'), 'v1.2.0', 'never pushes unrelated tags');
  assert.equal(git(f.source.url, 'tag', '--list'), '');
  const repeated = await f.releases.publish('project-release', f.release.id, preview);
  assert.equal(repeated.revision, published.revision, 'idempotent publication');
  const row = await f.db.task.findUniqueOrThrow({ where: { id: 'ticket-release' } });
  await assert.rejects(f.releases.assign('project-release', row.id, null, row.revision), /published/);
  await assert.rejects(f.entities.deleteTask(row.id, row.revision), /published/);
});

test('publication refuses undelivered tickets even if manually moved to Done', async (t) => {
  const f = await fixture(t);
  const task = await f.ticket();
  await assert.rejects(f.progress(), /not delivered locally/);
  await f.db.task.update({ where: { id: task.id }, data: { status: 'Done' } });
  await assert.rejects(f.releases.preview('project-release', f.release.id), /Done alone is not proof/);
  assert.equal(git(f.root, 'tag', '--list'), '');
});

test('delivery requires a release but assigning it does not invalidate the accepted AI scope', async (t) => {
  const f = await fixture(t);
  const created = await f.ticket('unassigned', null);
  assert.equal(created.releaseId, f.release.id, 'Unassigned creation automatically uses the next upcoming release');
  const task = await f.releases.assign('project-release', created.id, null, created.revision);
  await f.entities.moveTask(task.id, { revision: task.revision, status: 'In Progress' });
  await f.sessions.tick();
  const session = (await f.sessions.get(task.id))!;
  const review = await f.sessions.review(task.id);
  await f.sessions.acceptReview(task.id, session.id, session.updatedAt, review.token);
  await assert.rejects(f.sessions.delivery.preview(task.id), /Assign the ticket/);
  assert.equal(await f.db.agentDelivery.count(), 0);
  const row = await f.db.task.findUniqueOrThrow({ where: { id: task.id } });
  await f.releases.assign('project-release', row.id, f.release.id, row.revision);
  assert.equal((await f.sessions.delivery.preview(row.id)).reviewToken, review.token);
  const original = f.repositories.operations.createTicketCommit.bind(f.repositories.operations);
  f.repositories.operations.createTicketCommit = async (...args) => {
    const release = await f.releases.detail('project-release', f.release.id);
    await assert.rejects(f.releases.update('project-release', release.id, { version: release.version, status: 'cancelled', revision: release.revision }), /Wait for ticket delivery/);
    return original(...args);
  };
  const preview = await f.sessions.delivery.preview(task.id);
  assert.equal((await f.sessions.delivery.execute(task.id, 'commit', { ...preview, message: 'Assigned release', acknowledgeChecks: true })).delivery!.status, 'committed');
});

test('failed push retains the exact local tag/commit, freezes membership and version, and retries on the pinned commit', async (t) => {
  const f = await fixture(t);
  const workflows = new WorkflowEditorStore(f.db);
  let configuration = await workflows.save('releases', 0, await workflows.base('releases'));
  configuration = await workflows.publish('releases', configuration.revision);
  const activeVersion = configuration.versions[0].id;
  configuration = await workflows.activate('releases', configuration.revision, activeVersion);
  await f.deliver();
  const preview = await f.progress();
  const original = f.repositories.publication.pushReleaseTag.bind(f.repositories.publication);
  f.repositories.publication.pushReleaseTag = async () => { throw new Error('Temporary remote outage'); };
  await assert.rejects(f.releases.publish('project-release', f.release.id, preview), /Temporary remote outage/);
  const failed = await f.releases.detail('project-release', f.release.id);
  const pinnedWorkflow = workflowRuntimeSnapshotSchema.parse((await f.db.release.findUniqueOrThrow({ where: { id: f.release.id } })).workflowSnapshot);
  assert.equal(pinnedWorkflow.versionId, activeVersion);
  await workflows.activate('releases', configuration.revision, null);
  assert.equal(failed.status, 'in_progress');
  assert.equal(failed.publishing, false);
  assert.equal(failed.targetCommit, preview.commit);
  assert.equal(git(f.root, 'rev-parse', 'refs/tags/v1.2.0'), preview.commit);
  await assert.rejects(f.releases.update('project-release', f.release.id, { revision: failed.revision, version: '2.0.0', status: 'cancelled' }), /pinned/);
  const task = await f.db.task.findUniqueOrThrow({ where: { id: 'ticket-release' } });
  await assert.rejects(f.releases.assign('project-release', task.id, null, task.revision), /pinned/);
  await writeFile(path.join(f.root, 'later.txt'), 'Later independent work\n');
  git(f.root, 'add', '.'); git(f.root, 'commit', '-m', 'Later work');
  f.repositories.publication.pushReleaseTag = original;
  const retry = await f.releases.preview('project-release', f.release.id);
  assert.equal(retry.commit, preview.commit);
  assert.equal(retry.alreadyTagged, true);
  assert.equal((await f.releases.publish('project-release', f.release.id, retry)).status, 'published');
  assert.deepEqual((await f.db.release.findUniqueOrThrow({ where: { id: f.release.id } })).workflowSnapshot, pinnedWorkflow);
  assert.equal(git(f.bare, 'rev-parse', 'refs/tags/v1.2.0'), preview.commit);
});

test('an activated inserted release checkpoint executes and prevents push if its pinned target changed', async (t) => {
  const f = await fixture(t);
  const workflows = new WorkflowEditorStore(f.db);
  const document = await workflows.base('releases');
  document.nodes.push({ ...document.nodes[0], id: 'custom-checkpoint', referenceId: 'release-checkpoint', label: 'Verify pinned target' });
  document.edges = [
    { from: 'create-tag', to: 'custom-checkpoint' }, { from: 'custom-checkpoint', to: 'push-tag' },
    { from: 'push-tag', to: 'record-publication' },
  ];
  let state = await workflows.save('releases', 0, document);
  state = await workflows.publish('releases', state.revision);
  await workflows.activate('releases', state.revision, state.versions[0].id);
  await f.deliver();
  const preview = await f.progress();
  const original = f.repositories.operations.createReleaseTag.bind(f.repositories.operations);
  f.repositories.operations.createReleaseTag = async (...args) => {
    const hash = await original(...args);
    await f.db.release.update({ where: { id: f.release.id }, data: { targetCommit: 'changed-target' } });
    return hash;
  };
  await assert.rejects(f.releases.publish('project-release', f.release.id, preview), /pinned release publication target changed/);
  assert.equal((await f.releases.detail('project-release', f.release.id)).status, 'in_progress');
  assert.equal(git(f.bare, 'tag', '--list'), '', 'Checkpoint failure prevents the subsequent remote push');
});

test('restart after remote success reconciles without rewriting the tag', async (t) => {
  const f = await fixture(t);
  await f.deliver();
  const preview = await f.progress();
  const original = f.repositories.publication.pushReleaseTag.bind(f.repositories.publication);
  f.repositories.publication.pushReleaseTag = async (...args) => { await original(...args); throw new Error('Disconnect after remote accepted'); };
  await assert.rejects(f.releases.publish('project-release', f.release.id, preview), /Disconnect after remote/);
  await f.db.release.update({ where: { id: f.release.id }, data: { publishing: true } });
  await f.releases.recover();
  assert.match((await f.releases.detail('project-release', f.release.id)).error, /Server restarted/);
  f.repositories.publication.pushReleaseTag = original;
  const retry = await f.releases.preview('project-release', f.release.id);
  assert.equal((await f.releases.publish('project-release', f.release.id, retry)).status, 'published');
});

test('a failed publication can be cancelled without deleting tags, and its tickets can move to a new version', async (t) => {
  const f = await fixture(t);
  await f.deliver();
  const preview = await f.progress();
  f.repositories.publication.pushReleaseTag = async () => { throw new Error('Remote tag already reserved'); };
  await assert.rejects(f.releases.publish('project-release', f.release.id, preview), /reserved/);
  const failed = await f.releases.detail('project-release', f.release.id);
  const cancelled = await f.releases.update('project-release', f.release.id, { revision: failed.revision, version: failed.version, status: 'cancelled' });
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(git(f.root, 'rev-parse', 'refs/tags/v1.2.0'), preview.commit);
  await assert.rejects(f.releases.publish('project-release', f.release.id, preview), /Only an in-progress/);
  const [next] = await f.releases.create('project-release', { version: '1.2.1', status: 'upcoming' });
  const task = await f.db.task.findUniqueOrThrow({ where: { id: 'ticket-release' } });
  await f.releases.assign('project-release', task.id, next.id, task.revision);
  assert.equal((await f.releases.detail('project-release', next.id)).deliveredCount, 1);
});

test('local origin, multiple push destinations, stale heads and missing merge ancestry refuse publication', async (t) => {
  const f = await fixture(t);
  await f.deliver();
  const preview = await f.progress();
  git(f.root, 'remote', 'set-url', 'origin', f.source.url);
  await assert.rejects(f.releases.preview('project-release', f.release.id), /not a local source folder/);
  git(f.root, 'remote', 'set-url', 'origin', f.remoteUrl);
  git(f.root, 'config', '--add', 'remote.origin.pushurl', f.remoteUrl);
  git(f.root, 'config', '--add', 'remote.origin.pushurl', 'ssh://other.test/repo');
  await assert.rejects(f.releases.preview('project-release', f.release.id), /exactly one/);
  git(f.root, 'config', '--unset-all', 'remote.origin.pushurl');
  await writeFile(path.join(f.root, 'later.txt'), 'later\n');
  git(f.root, 'add', '.'); git(f.root, 'commit', '-m', 'Later');
  await assert.rejects(f.releases.publish('project-release', f.release.id, preview), /target changed/);
  await f.repositories.workspaces.switchBranch('project-release', 'dev');
  await f.db.project.update({ where: { id: 'project-release' }, data: { repositoryBranch: 'dev' } });
  await assert.rejects(f.releases.preview('project-release', f.release.id), /does not contain/);
  assert.equal(git(f.root, 'tag', '--list'), '');
});

test('existing conflicting local or remote tags are never overwritten', async (t) => {
  const f = await fixture(t);
  await f.deliver();
  git(f.root, 'tag', 'v1.2.0', 'HEAD~1');
  await assert.rejects(f.progress(), /already exists on a different object/);
  git(f.root, 'tag', '-d', 'v1.2.0');
  git(f.bare, 'tag', 'v1.2.0');
  const remoteTag = git(f.bare, 'rev-parse', 'refs/tags/v1.2.0');
  const preview = await f.releases.preview('project-release', f.release.id);
  await assert.rejects(f.releases.publish('project-release', f.release.id, preview), /Remote tag.*different object/);
  assert.equal(git(f.bare, 'rev-parse', 'refs/tags/v1.2.0'), remoteTag);
  assert.equal(git(f.root, 'rev-parse', 'refs/tags/v1.2.0'), preview.commit);
});

test('assignment is project-scoped, revision-checked, invalidates previews, and cancelled tickets can be rescheduled', async (t) => {
  const f = await fixture(t);
  const task = await f.ticket();
  await assert.rejects(f.releases.assign('project-release', task.id, null, 999), /ticket changed/);
  const before = await f.releases.detail('project-release', f.release.id);
  const detached = await f.releases.assign('project-release', task.id, null, task.revision);
  assert.equal(detached.releaseId, undefined);
  assert.equal((await f.releases.detail('project-release', f.release.id)).revision, before.revision + 1);
  await f.releases.update('project-release', f.release.id, { revision: before.revision + 1, version: '1.2.0', status: 'cancelled' });
  await assert.rejects(f.releases.assign('project-release', task.id, f.release.id, detached.revision), /cancelled/);
  const [next] = await f.releases.create('project-release', { version: '2.0.0', status: 'upcoming' });
  const autoAssigned = await f.db.task.findUniqueOrThrow({ where: { id: task.id } });
  assert.equal(autoAssigned.releaseId, next.id);
  await f.db.task.update({ where: { id: task.id }, data: { releaseId: f.release.id } });
  await f.releases.assign('project-release', task.id, next.id, autoAssigned.revision);
  const now = new Date().toISOString();
  await f.entities.createProject({ id: 'other', revision: 0, name: 'Other', description: '', color: '', createdAt: now, updatedAt: now });
  const [foreign] = await f.releases.create('other', { version: '1.0.0', status: 'upcoming' });
  const row = await f.db.task.findUniqueOrThrow({ where: { id: task.id } });
  await assert.rejects(f.releases.assign('project-release', task.id, foreign.id, row.revision), /same project/);
  await assert.rejects(f.entities.updateTask({ ...detached, revision: row.revision, releaseId: foreign.id }), /same project/);
  await assert.rejects(f.releases.detail('other', f.release.id), /not found/);
});

test('finished feature branches count as delivered and can be published as a release tag over SSH', async (t) => {
  const f = await fixture(t);
  const task = await f.ticket();
  await f.entities.moveTask(task.id, { revision: task.revision, status: 'In Progress' });
  await f.sessions.tick();
  const session = (await f.sessions.get(task.id))!;
  const review = await f.sessions.review(task.id);
  await f.sessions.acceptReview(task.id, session.id, session.updatedAt, review.token);
  await f.sessions.publication.execute('tasks', task.id, {
    ...await f.sessions.publication.preview('tasks', task.id), acknowledgeChecks: true,
  });
  assert.equal((await f.releases.detail('project-release', f.release.id)).deliveredCount, 0);
  const finish = await f.sessions.finish.preview('tasks', task.id);
  await f.sessions.finish.execute('tasks', task.id, finish);
  assert.equal((await f.releases.detail('project-release', f.release.id)).deliveredCount, 1);
  const preview = await f.progress();
  const published = await f.releases.publish('project-release', f.release.id, preview);
  assert.equal(published.status, 'published');
  assert.equal(git(f.bare, 'rev-parse', 'v1.2.0'), git(f.root, 'rev-parse', 'main'));
  assert.equal(git(f.bare, 'for-each-ref', '--format=%(refname)', `refs/heads/${finish.branch}`), '');
});

test('concurrent publication does not duplicate writes and blocks ticket mutation while publishing', async (t) => {
  const f = await fixture(t);
  await f.deliver();
  const preview = await f.progress();
  let pushes = 0;
  const original = f.repositories.publication.pushReleaseTag.bind(f.repositories.publication);
  f.repositories.publication.pushReleaseTag = async (...args) => {
    pushes++;
    const task = await f.db.task.findUniqueOrThrow({ where: { id: 'ticket-release' } });
    await assert.rejects(f.entities.deleteTask(task.id, task.revision), /tag is being published/);
    await assert.rejects(f.releases.assign('project-release', task.id, null, task.revision), /tag is being published/);
    await assert.rejects(f.releases.update('project-release', f.release.id, { revision: preview.revision, version: '2.0.0', status: 'in_progress' }), /pinned/);
    await original(...args);
  };
  const results = await Promise.all([
    f.releases.publish('project-release', f.release.id, preview),
    f.releases.publish('project-release', f.release.id, preview),
  ]);
  assert.equal(pushes, 1);
  assert.ok(results.every((release) => release.status === 'published'));
});

test('HTTP release routes validate SemVer, enforce unique project versions, and return typed metadata', async (t) => {
  const f = await fixture(t);
  const app = express(); app.use(express.json(), createReleaseRouter(f.releases));
  const server = await new Promise<Server>((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  t.after(async () => { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); });
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}/projects/project-release/releases`;
  const aggregate = await fetch(`http://127.0.0.1:${address.port}/releases`);
  assert.equal(aggregate.status, 200);
  assert.equal(aggregate.headers.get('cache-control'), 'no-store');
  assert.equal((await aggregate.json())[0].id, f.release.id);
  const post = (body: unknown) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await post({ version: 'not-semver', status: 'upcoming' })).status, 400);
  assert.equal((await post({ version: '1.2.0', status: 'upcoming' })).status, 409);
  assert.equal((await post({ version: '1.3.0', status: 'published' })).status, 400);
  const response = await fetch(`${url}/${f.release.id}`);
  assert.equal(response.status, 200);
  assert.equal(releaseDetailSchema.parse(await response.json()).version, '1.2.0');
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('ORM board snapshots retain versions and task links, and project deletion/reset cascade cleanly', async (t) => {
  const f = await fixture(t);
  const task = await f.ticket();
  await f.db.board.create({ data: { id: 'board' } });
  const store = new BoardStore(f.db);
  const snapshot = (await store.read())!;
  assert.equal(snapshot.releases![0].id, f.release.id);
  assert.equal(snapshot.tasks[0].releaseId, f.release.id);
  assert.equal(boardDataSchema.safeParse(snapshot).success, true);
  const now = new Date().toISOString();
  await f.entities.createProject({ id: 'other', revision: 0, name: 'Other', description: '', color: '', createdAt: now, updatedAt: now });
  await f.entities.deleteProject('project-release', 0);
  assert.equal(await f.db.task.count({ where: { id: task.id } }), 0);
  assert.equal(await f.db.release.count(), 0);
  await store.reset(snapshot);
  assert.equal((await store.read())!.tasks[0].releaseId, f.release.id);
  assert.equal(await f.db.release.count(), 1);
});
