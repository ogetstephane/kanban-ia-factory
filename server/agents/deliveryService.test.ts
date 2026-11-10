import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import type { Server } from 'node:http';
import { PrismaClient } from '@prisma/client';
import { featureSchema, taskSchema } from '../../shared/types/board';
import { deliveryPreviewSchema, publicationRequestSchema, type DeliveryRequest } from '../../shared/types/agent';
import { EntityStore } from '../db/entityStore';
import { RepositoryService } from '../git/repositoryService';
import { createSourceRepository, TEST_GIT_CONFIG } from '../git/testRepository';
import { createAgentRouter } from '../routes/agents';
import { SessionService } from './sessionService';
import { requiredTicketDocumentationPath } from './ticketDocumentation';
import { ReleaseService } from '../releases/releaseService';

const git = (cwd: string, ...args: string[]) => execFileSync('git', [...TEST_GIT_CONFIG, ...args],
  { cwd, encoding: 'utf8', stdio: 'pipe', timeout: 30_000 }).trim();
type Preview = Awaited<ReturnType<SessionService['delivery']['preview']>>;
const request = (preview: Preview, acknowledgeChecks = true): DeliveryRequest => ({
  sessionId: preview.sessionId, updatedAt: preview.updatedAt, targetHead: preview.targetHead,
  ticketHead: preview.ticketHead, tree: preview.tree, reviewToken: preview.reviewToken,
  message: 'Implement reviewed ticket', acknowledgeChecks,
});

async function fixture(t: TestContext, epic = false, withSibling = epic) {
  const directory = await mkdtemp(path.join(tmpdir(), 'kanban-delivery-test-'));
  const databaseUrl = `file:${path.join(directory, 'test.db')}`;
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: 'pipe',
  });
  const db = new PrismaClient({ datasourceUrl: databaseUrl });
  const entities = new EntityStore(db);
  const repositories = new RepositoryService(path.join(directory, 'workspaces'), { localRoots: [directory] });
  const source = await createSourceRepository(path.join(directory, 'source'));
  const cloned = await repositories.workspaces.clone('project-delivery', { url: source.url });
  const root = repositories.workspaces.pathFor('project-delivery');
  git(root, 'config', 'user.name', 'Delivery Test');
  git(root, 'config', 'user.email', 'delivery@example.com');
  const now = new Date().toISOString();
  await entities.createProject({
    id: 'project-delivery', revision: 0, name: 'Delivery project', description: 'Small context', color: '#6366f1',
    repositoryUrl: cloned.url, repositoryBranch: cloned.branch, repositoryCommit: cloned.commit, createdAt: now, updatedAt: now,
  });
  await db.release.create({ data: {
    id: 'release-delivery', projectId: 'project-delivery', version: '1.0.0', status: 'in_progress', createdAt: now, updatedAt: now,
  } });
  if (epic) await entities.createFeature(featureSchema.parse({
    id: 'delivery-epic', projectId: 'project-delivery', title: 'Reviewed feature', description: 'Shared feature branch',
    category: 'Test', status: 'To Do', color: '#6366f1', createdAt: now,
  }));
  const sessions = new SessionService(db, repositories, { id: 'copilot', async run(input) {
    if (input.phase === 'execute') {
      await writeFile(path.join(input.workspace, 'README.md'), '# delivered\n');
      await writeFile(path.join(input.workspace, 'new file.txt'), 'new content\n');
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
    await sessions.stop();
    await db.$disconnect();
    await rm(directory, { recursive: true, force: true });
  });
  const task = await entities.createTask(taskSchema.parse({
    id: 'ticket-delivery', projectId: 'project-delivery', featureId: epic ? 'delivery-epic' : undefined,
    releaseId: 'release-delivery', title: 'Deliver this ticket', description: 'Scoped work',
    status: 'To Do', priority: 'Medium', tags: [], acceptanceCriteria: [], subtasks: [],
    order: 0, storyPoints: 1, createdAt: now, updatedAt: now,
  }));
  const sibling = epic && withSibling ? await entities.createTask(taskSchema.parse({
    ...task, id: 'ticket-sibling', title: 'Sibling implementation', order: 1,
  })) : null;
  if (epic) await db.feature.update({ where: { id: 'delivery-epic' }, data: { status: 'In Progress' } });
  await entities.moveTask(task.id, { revision: task.revision!, status: 'In Progress' });
  await sessions.tick();
  const plan = (await sessions.get(task.id))!;
  if (plan.status === 'awaiting_approval') await sessions.approve(task.id, plan.id, plan.updatedAt);
  await sessions.tick();
  const completed = (await sessions.get(task.id))!;
  const review = await sessions.review(task.id);
  const accept = async () => {
    const row = (await sessions.get(task.id))!;
    const diff = await sessions.review(task.id);
    await sessions.acceptReview(task.id, row.id, row.updatedAt, diff.token);
    return sessions.delivery.preview(task.id);
  };
  return { db, entities, repositories, sessions, source, root, task, sibling, completed, review, accept };
}

test('validated review pushes a feature branch before Done and removes the standalone worktree without changing main', async (t) => {
  const f = await fixture(t);
  await f.accept();
  const main = git(f.root, 'rev-parse', 'HEAD');
  const sourceMain = git(f.source.url, 'rev-parse', 'main');
  const preview = await f.sessions.publication.preview('tasks', f.task.id);
  const result = await f.sessions.publication.execute('tasks', f.task.id, publicationRequestSchema.parse({ ...preview, acknowledgeChecks: true }));
  assert.equal(result.branch, 'feature/deliver-this-ticket');
  assert.equal(git(f.source.url, 'show', `${result.branch}:README.md`), '# delivered');
  assert.equal(git(f.source.url, 'rev-parse', 'main'), sourceMain);
  assert.equal(git(f.root, 'rev-parse', 'HEAD'), main);
  await assert.rejects(readFile(path.join(f.completed.workspace!, '.git')), { code: 'ENOENT' });
  assert.equal((await f.sessions.get(f.task.id))!.workspace, null);
  assert.equal(git(f.root, 'rev-parse', `kanban/${f.completed.id}`), (await f.sessions.get(f.task.id))!.publication!.commitHash);
  assert.equal((await f.db.task.findUniqueOrThrow({ where: { id: f.task.id } })).status, 'Done');
  const publication = (await f.sessions.get(f.task.id))!.publication!;
  assert.equal(publication.status, 'pushed');
  assert.equal(git(f.source.url, 'rev-parse', result.branch), publication.commitHash);
  const count = git(f.source.url, 'rev-list', '--count', result.branch);
  await f.sessions.publication.execute('tasks', f.task.id, publicationRequestSchema.parse({
    ...await f.sessions.publication.preview('tasks', f.task.id), acknowledgeChecks: true,
  }));
  assert.equal(git(f.source.url, 'rev-list', '--count', result.branch), count);
});

test('failed remote push leaves the ticket Review and retries the same durable commit', async (t) => {
  const f = await fixture(t);
  await f.accept();
  const preview = await f.sessions.publication.preview('tasks', f.task.id);
  git(f.source.url, 'config', 'receive.denyCurrentBranch', 'refuse');
  git(f.source.url, 'config', 'receive.denyNonFastForwards', 'true');
  const original = f.repositories.publication.pushReviewCommit.bind(f.repositories.publication);
  f.repositories.publication.pushReviewCommit = async () => { throw new Error('Origin unavailable'); };
  await assert.rejects(f.sessions.publication.execute('tasks', f.task.id, { ...preview, acknowledgeChecks: true }), /Origin unavailable/);
  assert.equal((await f.db.task.findUniqueOrThrow({ where: { id: f.task.id } })).status, 'Review');
  const failed = (await f.sessions.get(f.task.id))!.publication!;
  assert.equal(failed.status, 'failed');
  assert.ok((await f.sessions.get(f.task.id))!.workspace);
  assert.ok(await readFile(path.join(f.completed.workspace!, '.git')));
  assert.match(failed.error, /Origin unavailable/);
  f.repositories.publication.pushReviewCommit = original;
  const otherOrigin = await createSourceRepository(path.join(path.dirname(f.source.url), 'other-origin'));
  git(f.root, 'remote', 'set-url', '--push', 'origin', otherOrigin.url);
  await assert.rejects(f.sessions.publication.preview('tasks', f.task.id), /Origin changed/);
  git(f.root, 'remote', 'set-url', '--push', 'origin', f.source.url);
  const retry = await f.sessions.publication.preview('tasks', f.task.id);
  await f.sessions.publication.execute('tasks', f.task.id, { ...retry, acknowledgeChecks: true });
  assert.equal((await f.sessions.get(f.task.id))!.publication!.commitHash, failed.commitHash);
  assert.equal(git(f.source.url, 'rev-parse', retry.branch), failed.commitHash);
});

test('cleanup preserves post-publication edits and retries without losing the pushed commit', async (t) => {
  const f = await fixture(t);
  await f.accept();
  const preview = await f.sessions.publication.preview('tasks', f.task.id);
  const cleanup = f.repositories.operations.cleanupPublishedTicket.bind(f.repositories.operations);
  f.repositories.operations.cleanupPublishedTicket = async (...args) => {
    await writeFile(path.join(f.completed.workspace!, 'later.txt'), 'Keep my later work\n');
    return cleanup(...args);
  };
  await assert.rejects(f.sessions.publication.execute('tasks', f.task.id, { ...preview, acknowledgeChecks: true }),
    /marked Done, but worktree cleanup failed.*changed after publication/);
  const session = (await f.sessions.get(f.task.id))!;
  assert.equal(session.status, 'completed');
  assert.equal(session.publication!.status, 'pushed');
  assert.match(session.publication!.error, /cleanup failed/);
  assert.equal((await f.db.task.findUniqueOrThrow({ where: { id: f.task.id } })).status, 'Done');
  assert.equal(await readFile(path.join(f.completed.workspace!, 'later.txt'), 'utf8'), 'Keep my later work\n');
  const remoteCommit = git(f.source.url, 'rev-parse', preview.branch);
  await unlink(path.join(f.completed.workspace!, 'later.txt'));
  f.repositories.operations.cleanupPublishedTicket = cleanup;
  await f.sessions.publication.execute('tasks', f.task.id, {
    ...await f.sessions.publication.preview('tasks', f.task.id), acknowledgeChecks: true,
  });
  assert.equal((await f.sessions.get(f.task.id))!.workspace, null);
  assert.equal((await f.sessions.get(f.task.id))!.publication!.error, '');
  assert.equal(git(f.source.url, 'rev-parse', preview.branch), remoteCommit);
});

test('cleanup refuses private staged content; a retry after removal is idempotent', async (t) => {
  const f = await fixture(t);
  await writeFile(path.join(f.completed.workspace!, 'README.md'), 'Private staged content\n');
  git(f.completed.workspace!, 'add', 'README.md');
  await writeFile(path.join(f.completed.workspace!, 'README.md'), '# delivered\n');
  await f.accept();
  const input = { ...await f.sessions.publication.preview('tasks', f.task.id), acknowledgeChecks: true };
  await assert.rejects(f.sessions.publication.execute('tasks', f.task.id, input), /partially staged/);
  assert.equal(git(f.completed.workspace!, 'show', ':README.md'), 'Private staged content');
  git(f.completed.workspace!, 'add', '--all');
  const cleanup = f.repositories.operations.cleanupPublishedTicket.bind(f.repositories.operations);
  f.repositories.operations.cleanupPublishedTicket = async (...args) => { await cleanup(...args); throw new Error('Disconnected after removal'); };
  await assert.rejects(f.sessions.publication.execute('tasks', f.task.id, {
    ...await f.sessions.publication.preview('tasks', f.task.id), acknowledgeChecks: true,
  }), /Disconnected after removal/);
  await assert.rejects(readFile(path.join(f.completed.workspace!, '.git')), { code: 'ENOENT' });
  f.repositories.operations.cleanupPublishedTicket = cleanup;
  await f.sessions.publication.execute('tasks', f.task.id, {
    ...await f.sessions.publication.preview('tasks', f.task.id), acknowledgeChecks: true,
  });
  assert.equal((await f.sessions.get(f.task.id))!.workspace, null);
});

test('cleanup preserves ignored files rather than force-removing them', async (t) => {
  const f = await fixture(t);
  await writeFile(path.join(f.completed.workspace!, '.gitignore'), 'private-cache.txt\n');
  await writeFile(path.join(f.completed.workspace!, 'private-cache.txt'), 'Keep ignored content\n');
  await f.accept();
  await assert.rejects(f.sessions.publication.execute('tasks', f.task.id, {
    ...await f.sessions.publication.preview('tasks', f.task.id), acknowledgeChecks: true,
  }), /contains ignored files/);
  assert.equal(await readFile(path.join(f.completed.workspace!, 'private-cache.txt'), 'utf8'), 'Keep ignored content\n');
  assert.equal((await f.sessions.get(f.task.id))!.publication!.status, 'pushed');
  assert.ok((await f.sessions.get(f.task.id))!.workspace);
});

test('a disconnect after remote success reconciles on explicit retry without duplicate commits', async (t) => {
  const f = await fixture(t);
  await f.accept();
  const preview = await f.sessions.publication.preview('tasks', f.task.id);
  const push = f.repositories.publication.pushReviewCommit.bind(f.repositories.publication);
  f.repositories.publication.pushReviewCommit = async (...args) => { await push(...args); throw new Error('Disconnected after push'); };
  await assert.rejects(f.sessions.publication.execute('tasks', f.task.id, { ...preview, acknowledgeChecks: true }), /Disconnected/);
  assert.equal((await f.db.task.findUniqueOrThrow({ where: { id: f.task.id } })).status, 'Review');
  const commit = git(f.source.url, 'rev-parse', preview.branch);
  await f.db.agentSession.update({ where: { id: preview.tasks[0].sessionId }, data: { status: 'delivering' } });
  await f.db.reviewPublication.updateMany({ data: { status: 'pushing' } });
  await f.sessions.delivery.recover();
  await f.sessions.publication.recover();
  assert.equal((await f.sessions.get(f.task.id))!.publication!.status, 'failed');
  f.repositories.publication.pushReviewCommit = push;
  await f.sessions.publication.execute('tasks', f.task.id, {
    ...await f.sessions.publication.preview('tasks', f.task.id), acknowledgeChecks: true,
  });
  assert.equal(git(f.source.url, 'rev-parse', preview.branch), commit);
  assert.equal((await f.db.task.findUniqueOrThrow({ where: { id: f.task.id } })).status, 'Done');
});

test('validation rejects missing human acceptance, unchecked warnings, stale files, and missing documentation', async (t) => {
  const f = await fixture(t);
  await assert.rejects(f.sessions.publication.preview('tasks', f.task.id), /accept the human review/);
  await f.accept();
  const preview = await f.sessions.publication.preview('tasks', f.task.id);
  assert.ok(preview.warnings.length);
  await assert.rejects(f.sessions.publication.execute('tasks', f.task.id, { ...preview, acknowledgeChecks: false }), /Acknowledge/);
  await writeFile(path.join(f.completed.workspace!, 'README.md'), 'not reviewed\n');
  await assert.rejects(f.sessions.publication.execute('tasks', f.task.id, { ...preview, acknowledgeChecks: true }), /files changed after acceptance/);
  await writeFile(path.join(f.completed.workspace!, 'README.md'), '# delivered\n');
  await unlink(path.join(f.completed.workspace!, f.review.documentation!.path));
  await assert.rejects(f.sessions.publication.preview('tasks', f.task.id), /documentation is missing/);
  assert.equal(await f.db.reviewPublication.count(), 0);
  assert.equal((await f.db.task.findUniqueOrThrow({ where: { id: f.task.id } })).status, 'Review');
});

test('feature conflicts never overwrite origin and leave the ticket in Review', async (t) => {
  const f = await fixture(t);
  await f.accept();
  const preview = await f.sessions.publication.preview('tasks', f.task.id);
  git(f.source.url, 'checkout', '-b', preview.branch);
  await writeFile(path.join(f.source.url, 'README.md'), 'conflicting remote feature work\n');
  git(f.source.url, 'add', '.');
  git(f.source.url, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'Remote feature work');
  const remote = git(f.source.url, 'rev-parse', 'HEAD');
  git(f.source.url, 'checkout', 'main');
  await assert.rejects(f.sessions.publication.execute('tasks', f.task.id, { ...preview, acknowledgeChecks: true }), /conflict-free merge/);
  assert.equal(git(f.source.url, 'rev-parse', preview.branch), remote);
  assert.equal((await f.db.task.findUniqueOrThrow({ where: { id: f.task.id } })).status, 'Review');
  assert.equal((await f.sessions.get(f.task.id))!.publication!.status, 'failed');
});

test('publication refuses the origin default branch, rejects stale versions, and locks context while pushing', async (t) => {
  const f = await fixture(t);
  await f.accept();
  const preview = await f.sessions.publication.preview('tasks', f.task.id);
  await assert.rejects(f.sessions.publication.execute('tasks', f.task.id, {
    ...preview, tasks: preview.tasks.map((item) => ({ ...item, updatedAt: '2020-01-01T00:00:00.000Z' })), acknowledgeChecks: true,
  }), /review or epic changed/);
  git(f.source.url, 'branch', preview.branch);
  git(f.source.url, 'symbolic-ref', 'HEAD', `refs/heads/${preview.branch}`);
  await assert.rejects(f.sessions.publication.execute('tasks', f.task.id, { ...preview, acknowledgeChecks: true }), /default branch/);
  assert.equal((await f.db.task.findUniqueOrThrow({ where: { id: f.task.id } })).status, 'Review');
  git(f.source.url, 'symbolic-ref', 'HEAD', 'refs/heads/main');
  const push = f.repositories.publication.pushReviewCommit.bind(f.repositories.publication);
  f.repositories.publication.pushReviewCommit = async (...args) => {
    const task = await f.db.task.findUniqueOrThrow({ where: { id: f.task.id } });
    await assert.rejects(f.entities.moveTask(f.task.id, { revision: task.revision, status: 'Done' }), /AI session/);
    await assert.rejects(f.sessions.retry(f.task.id, preview.tasks[0].sessionId, 'Corrections'), /Only stopped sessions/);
    return push(...args);
  };
  await f.sessions.publication.execute('tasks', f.task.id, {
    ...await f.sessions.publication.preview('tasks', f.task.id), acknowledgeChecks: true,
  });
  assert.equal((await f.db.task.findUniqueOrThrow({ where: { id: f.task.id } })).status, 'Done');
});

test('epic validation pushes all tickets to one shared feature branch and only then finishes the epic', async (t) => {
  const f = await fixture(t, true);
  const sibling = f.sibling!;
  await f.entities.moveTask(sibling.id, { revision: sibling.revision!, status: 'In Progress' });
  await f.sessions.tick();
  const planned = (await f.sessions.get(sibling.id))!;
  if (planned.status === 'awaiting_approval') await f.sessions.approve(sibling.id, planned.id, planned.updatedAt);
  await f.sessions.tick();
  // Multi-ticket epics reach Review after their individual tickets are Done.
  for (const id of [f.task.id, sibling.id]) {
    const task = await f.db.task.findUniqueOrThrow({ where: { id } });
    await f.entities.moveTask(id, { revision: task.revision, status: 'Done' });
  }
  // The epic's review UI must be able to accept its already-Done children.
  for (const id of [f.task.id, sibling.id]) {
    const row = (await f.sessions.get(id))!;
    const review = await f.sessions.review(id);
    await f.sessions.acceptReview(id, row.id, row.updatedAt, review.token);
  }
  const preview = await f.sessions.publication.preview('features', 'delivery-epic');
  const siblingWorkspace = (await f.sessions.get(sibling.id))!.workspace!;
  assert.equal(preview.branch, 'feature/reviewed-feature');
  const push = f.repositories.publication.pushReviewCommit.bind(f.repositories.publication);
  let pushes = 0;
  f.repositories.publication.pushReviewCommit = async (...args) => {
    pushes++;
    assert.equal((await f.db.feature.findUniqueOrThrow({ where: { id: 'delivery-epic' } })).status, 'Review');
    if (pushes === 2) throw new Error('Second push failed');
    return push(...args);
  };
  await assert.rejects(f.sessions.publication.execute('features', 'delivery-epic', { ...preview, acknowledgeChecks: true }), /Second push failed/);
  assert.equal((await f.db.feature.findUniqueOrThrow({ where: { id: 'delivery-epic' } })).status, 'Review');
  assert.equal(await f.db.reviewPublication.count({ where: { status: 'pushed' } }), 1);
  assert.ok((await f.sessions.get(f.task.id))!.workspace, 'Keep epic worktrees until the entire epic is Done');
  f.repositories.publication.pushReviewCommit = push;
  await f.sessions.publication.execute('features', 'delivery-epic', {
    ...await f.sessions.publication.preview('features', 'delivery-epic'), acknowledgeChecks: true,
  });
  assert.equal((await f.db.feature.findUniqueOrThrow({ where: { id: 'delivery-epic' } })).status, 'Done');
  const publications = await f.db.reviewPublication.findMany();
  assert.equal(new Set(publications.map((item) => item.branch)).size, 1);
  assert.ok(publications.every((item) => item.status === 'pushed'));
  assert.equal((await f.sessions.get(f.task.id))!.workspace, null);
  assert.equal((await f.sessions.get(sibling.id))!.workspace, null);
  for (const workspace of [f.completed.workspace!, siblingWorkspace]) {
    await assert.rejects(readFile(path.join(workspace, '.git')), { code: 'ENOENT' });
  }
  for (const item of publications) {
    assert.equal(git(f.source.url, 'merge-base', item.commitHash, preview.branch), item.commitHash);
  }
});

test('validating the only ticket in a reviewed epic pushes its feature branch and marks both Done', async (t) => {
  const f = await fixture(t, true, false);
  assert.equal((await f.db.feature.findUniqueOrThrow({ where: { id: 'delivery-epic' } })).status, 'Review');
  await f.accept();
  const preview = await f.sessions.publication.preview('tasks', f.task.id);
  assert.equal(preview.branch, 'feature/reviewed-feature');
  await f.sessions.publication.execute('tasks', f.task.id, { ...preview, acknowledgeChecks: true });
  assert.equal((await f.db.task.findUniqueOrThrow({ where: { id: f.task.id } })).status, 'Done');
  assert.equal((await f.db.feature.findUniqueOrThrow({ where: { id: 'delivery-epic' } })).status, 'Done');
});

test('local delivery: human review, warning acknowledgment, separate commit/merge, Done and source isolation', async (t) => {
  const f = await fixture(t);
  await assert.rejects(f.sessions.delivery.preview(f.task.id), /Accept the human code review/);
  const preview = await f.accept();
  assert.equal(preview.fileCount, 3);
  assert.equal(preview.warnings.length, 2);
  assert.equal(git(f.completed.workspace!, 'status', '--porcelain').includes('??'), true);
  await assert.rejects(f.sessions.delivery.execute(f.task.id, 'commit', request(preview, false)), /acknowledge/);
  await assert.rejects(f.sessions.delivery.execute(f.task.id, 'merge', request(preview)), /Commit the reviewed snapshot/);
  const committed = await f.sessions.delivery.execute(f.task.id, 'commit', request(preview));
  assert.equal(committed.delivery?.status, 'committed');
  assert.equal(committed.reviewToken, preview.reviewToken, 'review fingerprint survives staging/commit of new files');
  assert.equal(git(f.completed.workspace!, 'status', '--porcelain'), '');
  assert.equal(git(f.root, 'rev-parse', 'HEAD'), preview.targetHead);
  assert.equal((await f.db.task.findUniqueOrThrow({ where: { id: f.task.id } })).status, 'Review');
  assert.match(git(f.root, 'show', '-s', '--format=%B', committed.delivery!.commitHash!), /Co-authored-by: Copilot/);
  const delivered = await f.sessions.delivery.execute(f.task.id, 'merge', request(committed));
  assert.equal(delivered.delivery?.status, 'delivered');
  assert.equal(git(f.root, 'rev-parse', 'HEAD'), delivered.delivery!.mergeHash);
  assert.equal(await readFile(path.join(f.root, 'README.md'), 'utf8'), '# delivered\n');
  assert.equal(git(f.root, 'status', '--porcelain'), '');
  const task = await f.db.task.findUniqueOrThrow({ where: { id: f.task.id } });
  assert.equal(task.status, 'Done');
  assert.equal(task.revision, f.task.revision! + 3);
  const project = await f.db.project.findUniqueOrThrow({ where: { id: 'project-delivery' } });
  assert.equal(project.repositoryCommit, delivered.delivery!.mergeHash);
  assert.equal(project.revision, 1);
  assert.equal(await readFile(path.join(f.source.url, 'README.md'), 'utf8'), '# main\n');
  assert.equal(git(f.source.url, 'rev-parse', 'HEAD'), preview.targetHead);
  assert.equal((await f.sessions.get(f.task.id))!.delivery?.status, 'delivered');
  const again = await f.sessions.delivery.execute(f.task.id, 'merge', request(committed));
  assert.equal(again.delivery!.mergeHash, delivered.delivery!.mergeHash);
  assert.equal((await f.db.task.findUniqueOrThrow({ where: { id: f.task.id } })).revision, task.revision);
});

test('delivery also refuses legacy accepted sessions if their required ticket document is missing', async (t) => {
  const f = await fixture(t);
  const row = (await f.sessions.get(f.task.id))!;
  const review = await f.sessions.review(f.task.id);
  const documentationPath = requiredTicketDocumentationPath({
    taskId: f.task.id,
    taskTitle: f.task.title,
    docsPath: (await f.db.project.findUniqueOrThrow({ where: { id: 'project-delivery' } })).docsPath,
  });
  await unlink(path.join(row.workspace!, documentationPath));
  await f.db.agentSession.update({
    where: { id: row.id },
    data: { reviewStatus: 'accepted', reviewToken: review.token },
  });
  await assert.rejects(f.sessions.delivery.preview(f.task.id), /Ticket documentation is missing or empty/);
});

test('changed accepted files, stale session versions, trees and targets are rejected without writes', async (t) => {
  const f = await fixture(t);
  const preview = await f.accept();
  for (const patch of [{ updatedAt: '2000-01-01T00:00:00.000Z' }, { tree: '0'.repeat(40) }, { targetHead: '0'.repeat(40) }]) {
    await assert.rejects(f.sessions.delivery.execute(f.task.id, 'commit', { ...request(preview), ...patch }), /changed/);
  }
  await writeFile(path.join(f.completed.workspace!, 'new file.txt'), 'changed after acceptance');
  await assert.rejects(f.sessions.delivery.execute(f.task.id, 'commit', request(preview)), /Files changed after human review/);
  assert.equal(await f.db.agentDelivery.count(), 0);
  await f.accept();
});

test('dirty target, wrong target branch and git operation in progress refuse delivery', async (t) => {
  const f = await fixture(t);
  const preview = await f.accept();
  await writeFile(path.join(f.root, 'untracked.txt'), 'Do not overwrite');
  await assert.rejects(f.sessions.delivery.execute(f.task.id, 'commit', request(preview)), /uncommitted or untracked/);
  await rm(path.join(f.root, 'untracked.txt'));
  await f.repositories.workspaces.switchBranch('project-delivery', 'dev');
  await assert.rejects(f.sessions.delivery.preview(f.task.id), /Switch the project clone back to main/);
  await f.repositories.workspaces.switchBranch('project-delivery', 'main');
  await writeFile(path.join(f.root, '.git', 'MERGE_HEAD'), preview.targetHead);
  await assert.rejects(f.sessions.delivery.preview(f.task.id), /git operation is in progress/);
  assert.equal(await f.db.agentDelivery.count(), 0);
});

test('latest checks of the current attempt determine warnings, not earlier successes', async (t) => {
  const f = await fixture(t);
  const preview = await f.accept();
  for (const [id, attempt, script, passed, createdAt] of [
    ['old', 0, 'test', true, '2026-01-01T00:00:00.000Z'],
    ['test-ok', 1, 'test', true, '2026-01-01T00:00:01.000Z'],
    ['test-failed', 1, 'test', false, '2026-01-01T00:00:02.000Z'],
    ['lint-ok', 1, 'lint', true, '2026-01-01T00:00:03.000Z'],
  ] as const) {
    await f.db.agentCheck.create({ data: { id, sessionId: preview.sessionId, attempt, script, passed, output: '', createdAt } });
  }
  assert.deepEqual((await f.sessions.delivery.preview(f.task.id)).warnings, ['npm run test: failed for this attempt']);
  await f.db.agentCheck.create({ data: { id: 'test-fixed', sessionId: preview.sessionId, attempt: 1, script: 'test', passed: true, output: '', createdAt: '2026-01-01T00:00:04.000Z' } });
  const ready = await f.sessions.delivery.preview(f.task.id);
  assert.deepEqual(ready.warnings, []);
  assert.equal((await f.sessions.delivery.execute(f.task.id, 'commit', request(ready, false))).delivery?.status, 'committed');
});

test('conflicts leave the clone clean, preserve ticket commit, never mark Done, and allow explicit retry', async (t) => {
  const f = await fixture(t);
  const preview = await f.accept();
  const committed = await f.sessions.delivery.execute(f.task.id, 'commit', request(preview));
  await writeFile(path.join(f.root, 'README.md'), '# target changed\n');
  git(f.root, 'add', '.');
  git(f.root, 'commit', '-m', 'Concurrent target change');
  const target = git(f.root, 'rev-parse', 'HEAD');
  await assert.rejects(f.sessions.delivery.execute(f.task.id, 'merge', request(committed)), /changed/);
  const refreshed = await f.sessions.delivery.preview(f.task.id);
  await assert.rejects(f.sessions.delivery.execute(f.task.id, 'merge', request(refreshed)), /conflict-free merge/);
  assert.equal(git(f.root, 'rev-parse', 'HEAD'), target);
  assert.equal(git(f.root, 'status', '--porcelain'), '');
  assert.equal(git(f.completed.workspace!, 'rev-parse', 'HEAD'), committed.delivery!.commitHash);
  assert.equal((await f.sessions.get(f.task.id))!.status, 'completed');
  assert.equal((await f.sessions.get(f.task.id))!.delivery?.status, 'failed');
  assert.notEqual((await f.db.task.findUniqueOrThrow({ where: { id: f.task.id } })).status, 'Done');
  await writeFile(path.join(f.root, 'README.md'), '# main\n');
  git(f.root, 'add', '.');
  git(f.root, 'commit', '-m', 'Resolve target divergence');
  const retry = await f.sessions.delivery.preview(f.task.id);
  const delivered = await f.sessions.delivery.execute(f.task.id, 'merge', request(retry));
  assert.equal(delivered.delivery!.status, 'delivered');
  assert.equal(delivered.delivery!.commitHash, committed.delivery!.commitHash);
});

test('interruption after ticket commit is recoverable without a duplicate commit', async (t) => {
  const f = await fixture(t);
  const preview = await f.accept();
  const original = f.repositories.operations.applyTicketCommit.bind(f.repositories.operations);
  f.repositories.operations.applyTicketCommit = async (...args) => { await original(...args); throw new Error('Simulated disconnect after commit'); };
  await assert.rejects(f.sessions.delivery.execute(f.task.id, 'commit', request(preview)), /Simulated disconnect/);
  f.repositories.operations.applyTicketCommit = original;
  const failed = await f.sessions.delivery.preview(f.task.id);
  assert.equal(failed.ticketHead, failed.delivery!.commitHash);
  assert.equal((await f.sessions.delivery.execute(f.task.id, 'merge', request(failed))).delivery!.status, 'delivered');
  assert.equal(git(f.completed.workspace!, 'rev-list', '--count', `${preview.ticketHead}..HEAD`), '1');
});

test('prepared ticket commit can be resumed when failure happened before ref update', async (t) => {
  const f = await fixture(t);
  const preview = await f.accept();
  const original = f.repositories.operations.applyTicketCommit.bind(f.repositories.operations);
  f.repositories.operations.applyTicketCommit = async () => { throw new Error('Before commit ref'); };
  await assert.rejects(f.sessions.delivery.execute(f.task.id, 'commit', request(preview)), /Before commit ref/);
  const failed = await f.sessions.delivery.preview(f.task.id);
  assert.ok(failed.delivery!.commitHash);
  assert.equal(failed.ticketHead, preview.ticketHead);
  f.repositories.operations.applyTicketCommit = original;
  const resumed = await f.sessions.delivery.execute(f.task.id, 'commit', request(failed));
  assert.equal(resumed.ticketHead, failed.delivery!.commitHash);
  assert.equal(resumed.delivery!.status, 'committed');
});

test('interruption after Git merge can be reconciled after restart without another merge or premature Done', async (t) => {
  const f = await fixture(t);
  const committed = await f.sessions.delivery.execute(f.task.id, 'commit', request(await f.accept()));
  const original = f.repositories.operations.applyDeliveryMerge.bind(f.repositories.operations);
  f.repositories.operations.applyDeliveryMerge = async (...args) => { await original(...args); throw new Error('Disconnect after merge'); };
  await assert.rejects(f.sessions.delivery.execute(f.task.id, 'merge', request(committed)), /Disconnect after merge/);
  const interrupted = (await f.sessions.get(f.task.id))!.delivery!;
  assert.equal(git(f.root, 'rev-parse', 'HEAD'), interrupted.mergeHash);
  assert.notEqual((await f.db.task.findUniqueOrThrow({ where: { id: f.task.id } })).status, 'Done');
  await f.db.agentSession.update({ where: { id: committed.sessionId }, data: { status: 'delivering' } });
  await f.db.agentDelivery.update({ where: { id: interrupted.id }, data: { status: 'merging' } });
  const count = git(f.root, 'rev-list', '--count', 'HEAD');
  await f.sessions.delivery.recover();
  assert.equal((await f.sessions.get(f.task.id))!.status, 'completed');
  assert.equal((await f.sessions.get(f.task.id))!.delivery!.status, 'failed');
  f.repositories.operations.applyDeliveryMerge = original;
  const delivered = await f.sessions.delivery.execute(f.task.id, 'merge', request(await f.sessions.delivery.preview(f.task.id)));
  assert.equal(delivered.delivery!.status, 'delivered');
  assert.equal(delivered.delivery!.mergeHash, interrupted.mergeHash);
  assert.equal(git(f.root, 'rev-list', '--count', 'HEAD'), count);
});

test('concurrent requests are serialized and context stays locked throughout delivery', async (t) => {
  const f = await fixture(t);
  const preview = await f.accept();
  const original = f.repositories.operations.createTicketCommit.bind(f.repositories.operations);
  f.repositories.operations.createTicketCommit = async (...args) => {
    const task = await f.db.task.findUniqueOrThrow({ where: { id: f.task.id } });
    await assert.rejects(f.entities.moveTask(f.task.id, { revision: task.revision, status: 'Review' }), /AI session/);
    await assert.rejects(f.sessions.retry(f.task.id, preview.sessionId, 'Corrections'), /Only stopped sessions/);
    return original(...args);
  };
  const results = await Promise.allSettled([
    f.sessions.delivery.execute(f.task.id, 'commit', request(preview)),
    f.sessions.delivery.execute(f.task.id, 'commit', request(preview)),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(git(f.completed.workspace!, 'rev-list', '--count', `${preview.ticketHead}..HEAD`), '1');
});

test('missing git identity is explicit and creates no delivery record or commit', async (t) => {
  const f = await fixture(t);
  const preview = await f.accept();
  git(f.root, 'config', 'user.name', '');
  git(f.root, 'config', 'user.email', '');
  await assert.rejects(f.sessions.delivery.execute(f.task.id, 'commit', request(preview)), /Configure git user.name and user.email/);
  assert.equal(await f.db.agentDelivery.count(), 0);
  assert.equal(git(f.completed.workspace!, 'rev-parse', 'HEAD'), preview.ticketHead);
});

test('partially staged user content is never discarded by delivery', async (t) => {
  const f = await fixture(t);
  await writeFile(path.join(f.completed.workspace!, 'README.md'), 'staged private version\n');
  git(f.completed.workspace!, 'add', 'README.md');
  await writeFile(path.join(f.completed.workspace!, 'README.md'), '# delivered\n');
  const preview = await f.accept();
  await assert.rejects(f.sessions.delivery.execute(f.task.id, 'commit', request(preview)), /partially staged snapshot/);
  assert.equal(git(f.completed.workspace!, 'show', ':README.md'), 'staged private version');
  assert.equal(git(f.completed.workspace!, 'rev-parse', 'HEAD'), preview.ticketHead);
  git(f.completed.workspace!, 'add', '--all');
  const retry = await f.sessions.delivery.preview(f.task.id);
  assert.equal((await f.sessions.delivery.execute(f.task.id, 'commit', request(retry))).delivery!.status, 'committed');
});

test('binary, empty-file, deletion and pathspec-looking names survive commit and merge exactly', async (t) => {
  const f = await fixture(t);
  await rm(path.join(f.completed.workspace!, 'README.md'));
  await writeFile(path.join(f.completed.workspace!, ':(glob)*.bin'), Buffer.from([0, 1, 200, 255]));
  await writeFile(path.join(f.completed.workspace!, 'empty.txt'), '');
  const preview = await f.accept();
  const committed = await f.sessions.delivery.execute(f.task.id, 'commit', request(preview));
  assert.equal(preview.reviewToken, committed.reviewToken);
  await f.sessions.delivery.execute(f.task.id, 'merge', request(committed));
  await assert.rejects(readFile(path.join(f.root, 'README.md')), { code: 'ENOENT' });
  assert.deepEqual(await readFile(path.join(f.root, ':(glob)*.bin')), Buffer.from([0, 1, 200, 255]));
  assert.equal(await readFile(path.join(f.root, 'empty.txt'), 'utf8'), '');
});

test('a later target commit after an interrupted merge is retained and recovery does not merge twice', async (t) => {
  const f = await fixture(t);
  const committed = await f.sessions.delivery.execute(f.task.id, 'commit', request(await f.accept()));
  const original = f.repositories.operations.applyDeliveryMerge.bind(f.repositories.operations);
  f.repositories.operations.applyDeliveryMerge = async (...args) => { await original(...args); throw new Error('Merge applied before disconnect'); };
  await assert.rejects(f.sessions.delivery.execute(f.task.id, 'merge', request(committed)), /disconnect/);
  const prepared = (await f.sessions.get(f.task.id))!.delivery!.mergeHash;
  await writeFile(path.join(f.root, 'later.txt'), 'independent target work\n');
  git(f.root, 'add', '.');
  git(f.root, 'commit', '-m', 'Later target commit');
  const target = git(f.root, 'rev-parse', 'HEAD');
  f.repositories.operations.applyDeliveryMerge = original;
  const delivered = await f.sessions.delivery.execute(f.task.id, 'merge', request(await f.sessions.delivery.preview(f.task.id)));
  assert.equal(delivered.delivery!.mergeHash, prepared);
  assert.equal(git(f.root, 'rev-parse', 'HEAD'), target);
  assert.equal((await f.db.project.findUniqueOrThrow({ where: { id: 'project-delivery' } })).repositoryCommit, target);
  assert.equal(delivered.delivery!.status, 'delivered');
});

test('HTTP delivery endpoints validate input and return durable typed previews', async (t) => {
  const f = await fixture(t);
  const app = express();
  app.use(express.json(), createAgentRouter(f.sessions));
  const server = await new Promise<Server>((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}/tasks/${f.task.id}/session/delivery`;
  assert.equal((await fetch(url)).status, 409);
  const preview = await f.accept();
  const malformed = await fetch(`${url}/commit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(malformed.status, 400);
  const response = await fetch(`${url}/commit`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request(preview)),
  });
  assert.equal(response.status, 200);
  assert.equal(deliveryPreviewSchema.parse(await response.json()).delivery!.status, 'committed');
  assert.match(response.headers.get('cache-control')!, /no-store/);
});

test('HTTP review publication requires explicit confirmation snapshots and returns a verifiable feature branch', async (t) => {
  const f = await fixture(t);
  const app = express();
  app.use(express.json(), createAgentRouter(f.sessions));
  const server = await new Promise<Server>((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}/tasks/${f.task.id}/review-publication`;
  assert.equal((await fetch(url)).status, 409);
  await f.accept();
  const preview = await (await fetch(url)).json();
  const malformed = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(malformed.status, 400);
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...preview, acknowledgeChecks: true }) });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { branch: preview.branch });
  assert.match(response.headers.get('cache-control')!, /no-store/);
  assert.equal(git(f.source.url, 'rev-parse', preview.branch), (await f.sessions.get(f.task.id))!.publication!.commitHash);
});

async function publishedFixture(t: TestContext, epic = false) {
  const f = await fixture(t, epic, false);
  await f.accept();
  await f.sessions.publication.execute('tasks', f.task.id, {
    ...await f.sessions.publication.preview('tasks', f.task.id), acknowledgeChecks: true,
  });
  git(f.source.url, 'config', 'receive.denyCurrentBranch', 'updateInstead');
  return f;
}

test('Finish lists Done published work after cleanup, merges/pushes main, closes both feature refs, and counts toward its release', async (t) => {
  const f = await publishedFixture(t);
  const list = await f.sessions.finish.list('project-delivery');
  assert.equal(list.length, 1);
  assert.equal(list[0].kind, 'tasks');
  assert.equal(list[0].tasks[0].releaseId, 'release-delivery');
  assert.equal((await f.sessions.get(f.task.id))!.workspace, null);
  const preview = await f.sessions.finish.preview('tasks', f.task.id);
  git(f.root, 'branch', preview.branch, preview.featureHead);
  const result = await f.sessions.finish.execute('tasks', f.task.id, preview);
  assert.equal(result.status, 'finished');
  assert.equal(git(f.root, 'rev-parse', 'main'), git(f.source.url, 'rev-parse', 'main'));
  assert.equal(git(f.source.url, 'show', 'main:README.md'), '# delivered');
  assert.equal(git(f.source.url, 'for-each-ref', '--format=%(refname)', `refs/heads/${preview.branch}`), '');
  assert.equal(git(f.root, 'for-each-ref', '--format=%(refname)', `refs/heads/${preview.branch}`), '');
  const releases = new ReleaseService(f.db, f.repositories);
  const detail = await releases.detail('project-delivery', 'release-delivery');
  assert.equal(detail.deliveredCount, 1);
  assert.equal(detail.tickets[0].delivered, true);
  assert.ok(detail.tickets[0].mergeHash);
  assert.equal(git(f.source.url, 'tag', '--list'), '');
  assert.equal((await f.sessions.finish.list('project-delivery'))[0].finishStatus, 'finished');
  await assert.rejects(f.sessions.publication.preview('tasks', f.task.id), /Finish has already started/);
  const count = git(f.root, 'rev-list', '--count', 'main');
  await f.sessions.finish.execute('tasks', f.task.id, result);
  assert.equal(git(f.root, 'rev-list', '--count', 'main'), count);
});

test('Finish epic lists the epic, not its children, and finishes its shared branch', async (t) => {
  const f = await publishedFixture(t, true);
  const work = (await f.sessions.finish.list('project-delivery'))[0];
  assert.equal(work.kind, 'features');
  assert.equal(work.id, 'delivery-epic');
  await assert.rejects(f.sessions.finish.preview('tasks', f.task.id), /entire epic/);
  const preview = await f.sessions.finish.preview('features', work.id);
  await f.sessions.finish.execute('features', work.id, preview);
  assert.equal((await f.sessions.finish.list('project-delivery'))[0].finishStatus, 'finished');
  assert.equal(git(f.source.url, 'show', 'main:README.md'), '# delivered');
});

test('Finish retries saved merges after project push failure and a disconnect after branch deletion', async (t) => {
  const f = await publishedFixture(t);
  const preview = await f.sessions.finish.preview('tasks', f.task.id);
  const push = f.repositories.publication.pushFinishedProject.bind(f.repositories.publication);
  f.repositories.publication.pushFinishedProject = async () => { throw new Error('Project push unavailable'); };
  await assert.rejects(f.sessions.finish.execute('tasks', f.task.id, preview), /Project push unavailable/);
  const saved = await f.db.branchFinish.findFirstOrThrow();
  assert.ok(saved.mergeHash);
  assert.equal(git(f.source.url, 'rev-parse', preview.branch), preview.featureHead);
  assert.equal(git(f.root, 'rev-parse', 'main'), saved.mergeHash);
  assert.notEqual(git(f.source.url, 'rev-parse', 'main'), saved.mergeHash);
  f.repositories.publication.pushFinishedProject = push;
  const close = f.repositories.publication.closeFinishedBranch.bind(f.repositories.publication);
  f.repositories.publication.closeFinishedBranch = async (...args) => { await close(...args); throw new Error('Disconnected after closing'); };
  await assert.rejects(f.sessions.finish.execute('tasks', f.task.id, await f.sessions.finish.preview('tasks', f.task.id)), /Disconnected after closing/);
  assert.equal(git(f.source.url, 'rev-parse', 'main'), saved.mergeHash);
  assert.equal(git(f.source.url, 'for-each-ref', '--format=%(refname)', `refs/heads/${preview.branch}`), '');
  await f.db.branchFinish.update({ where: { id: saved.id }, data: { status: 'closing' } });
  await f.sessions.finish.recover();
  assert.equal((await f.db.branchFinish.findUniqueOrThrow({ where: { id: saved.id } })).status, 'failed');
  f.repositories.publication.closeFinishedBranch = close;
  await f.sessions.finish.execute('tasks', f.task.id, await f.sessions.finish.preview('tasks', f.task.id));
  assert.equal(git(f.root, 'rev-parse', 'main'), saved.mergeHash);
  assert.equal((await f.db.branchFinish.findUniqueOrThrow({ where: { id: saved.id } })).status, 'finished');
});

test('Finish conflicts, dirty clone, stale previews and remote divergence never delete the feature branch', async (t) => {
  const f = await publishedFixture(t);
  const preview = await f.sessions.finish.preview('tasks', f.task.id);
  await assert.rejects(f.sessions.finish.execute('tasks', f.task.id, { ...preview, featureHead: 'f'.repeat(40) }), /branch or release changed/);
  await writeFile(path.join(f.root, 'dirty.txt'), 'Keep local work\n');
  await assert.rejects(f.sessions.finish.preview('tasks', f.task.id), /must be clean/);
  await unlink(path.join(f.root, 'dirty.txt'));
  await writeFile(path.join(f.root, 'README.md'), 'Conflict on main\n');
  git(f.root, 'add', '.'); git(f.root, 'commit', '-m', 'Conflicting project change');
  const conflict = await f.sessions.finish.preview('tasks', f.task.id);
  await assert.rejects(f.sessions.finish.execute('tasks', f.task.id, conflict), /conflict-free merge/);
  assert.equal(git(f.source.url, 'rev-parse', preview.branch), preview.featureHead);
  assert.equal(git(f.root, 'show', 'main:README.md'), 'Conflict on main');
  assert.equal((await f.sessions.finish.list('project-delivery'))[0].finishStatus, 'failed');
});

test('Finish requires a next release; creation backfills unassigned tickets and new tickets use earliest upcoming without replacing assignments', async (t) => {
  const f = await publishedFixture(t);
  await f.db.task.update({ where: { id: f.task.id }, data: { releaseId: null } });
  await assert.rejects(f.sessions.finish.preview('tasks', f.task.id), /upcoming or in-progress release/);
  const releases = new ReleaseService(f.db, f.repositories);
  await releases.create('project-delivery', { version: '2.0.0', status: 'upcoming' });
  const first = await f.db.release.findFirstOrThrow({ where: { version: '2.0.0' } });
  assert.equal((await f.db.task.findUniqueOrThrow({ where: { id: f.task.id } })).releaseId, first.id);
  await releases.create('project-delivery', { version: '3.0.0', status: 'upcoming' });
  assert.equal((await f.db.task.findUniqueOrThrow({ where: { id: f.task.id } })).releaseId, first.id);
  const now = new Date().toISOString();
  const newTask = await f.entities.createTask(taskSchema.parse({
    ...f.task, id: 'next-release-task', featureId: undefined, releaseId: undefined,
    status: 'To Do', title: 'Next task', createdAt: now, updatedAt: now,
  }));
  assert.equal(newTask.releaseId, first.id);
  const explicit = await f.entities.createTask(taskSchema.parse({ ...newTask, id: 'explicit-release-task', releaseId: 'release-delivery' }));
  assert.equal(explicit.releaseId, 'release-delivery');
  const preview = await f.sessions.finish.preview('tasks', f.task.id);
  assert.equal(preview.releaseId, first.id);
  await f.sessions.finish.execute('tasks', f.task.id, preview);
  const current = await f.db.task.findUniqueOrThrow({ where: { id: f.task.id } });
  await assert.rejects(releases.assign('project-delivery', f.task.id, 'release-delivery', current.revision), /pinned by Finish/);
});

test('Finish locks session and release context while pushing and preserves concurrently advanced feature branches', async (t) => {
  const f = await publishedFixture(t);
  const preview = await f.sessions.finish.preview('tasks', f.task.id);
  const push = f.repositories.publication.pushFinishedProject.bind(f.repositories.publication);
  f.repositories.publication.pushFinishedProject = async (...args) => {
    const task = await f.db.task.findUniqueOrThrow({ where: { id: f.task.id } });
    await assert.rejects(f.entities.moveTask(task.id, { revision: task.revision, status: 'Done' }), /AI session/);
    await push(...args);
    const newHead = git(f.root, 'rev-parse', 'main');
    git(f.source.url, 'update-ref', `refs/heads/${preview.branch}`, newHead);
  };
  await assert.rejects(f.sessions.finish.execute('tasks', f.task.id, preview), /feature branch changed/);
  assert.notEqual(git(f.source.url, 'rev-parse', preview.branch), preview.featureHead);
  assert.equal((await f.sessions.get(f.task.id))!.status, 'completed');
});
