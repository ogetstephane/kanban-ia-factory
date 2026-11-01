import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { EntityStore } from '../db/entityStore';
import { RepositoryService } from '../git/repositoryService';
import { createSourceRepository } from '../git/testRepository';
import { DocsService } from './docsService';

const git = (cwd: string, ...args: string[]) => execFileSync('git', cwd.endsWith('.git') ? ['--git-dir', cwd, ...args] : args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
const ssh = `node ${path.resolve('server/git/testSsh.cjs')}`;

test('wiki edits are committed on the project branch and pushed to origin', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'kanban-wiki-test-'));
  const databaseUrl = `file:${path.join(directory, 'test.db')}`;
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: 'pipe',
  });
  const db = new PrismaClient({ datasourceUrl: databaseUrl });
  const repositories = new RepositoryService(path.join(directory, 'workspaces'), { localRoots: [directory] });
  const source = await createSourceRepository(path.join(directory, 'source'));
  const cloned = await repositories.clone('project-wiki', { url: source.url });
  const root = repositories.pathFor('project-wiki');
  git(root, 'config', 'user.name', 'Wiki Test');
  git(root, 'config', 'user.email', 'wiki@example.com');
  const bare = path.join(directory, 'origin.git');
  git(directory, 'clone', '--bare', source.url, bare);
  const previousSsh = process.env.GIT_SSH_COMMAND;
  const previousRoot = process.env.TEST_RELEASE_REMOTE_ROOT;
  process.env.GIT_SSH_COMMAND = ssh;
  process.env.TEST_RELEASE_REMOTE_ROOT = directory;
  git(root, 'remote', 'set-url', 'origin', `ssh://release.test${bare}`);
  t.after(async () => {
    await db.$disconnect();
    if (previousSsh === undefined) delete process.env.GIT_SSH_COMMAND; else process.env.GIT_SSH_COMMAND = previousSsh;
    if (previousRoot === undefined) delete process.env.TEST_RELEASE_REMOTE_ROOT; else process.env.TEST_RELEASE_REMOTE_ROOT = previousRoot;
    await rm(directory, { recursive: true, force: true });
  });
  const now = new Date().toISOString();
  const entities = new EntityStore(db);
  await entities.createProject({
    id: 'project-wiki', revision: 0, name: 'Wiki project', description: '', color: '#6366f1', docsPath: 'doc',
    repositoryUrl: cloned.url, repositoryBranch: cloned.branch, repositoryCommit: cloned.commit, createdAt: now, updatedAt: now,
  });
  const docs = new DocsService(db, repositories);

  assert.deepEqual((await docs.list('project-wiki')).files, []);

  const created = await docs.save('project-wiki', 'guides/start.md', '# Start\n', null);
  assert.equal(created.unchanged, false);
  assert.equal(git(root, 'rev-parse', 'HEAD'), cloned.commit, 'save must not commit');
  assert.deepEqual(await docs.status('project-wiki'), { pending: [{ path: 'guides/start.md', status: 'added' }], ahead: 0 });

  const listed = await docs.list('project-wiki');
  assert.deepEqual(listed.files.map((file) => file.path), ['guides/start.md']);
  const opened = await docs.read('project-wiki', 'guides/start.md');
  assert.equal(opened.sha, created.sha);

  await writeFile(path.join(root, 'unrelated.txt'), 'dirty\n');
  const updated = await docs.save('project-wiki', 'guides/start.md', '# Start\n\nMore.\n', opened.sha);
  await docs.save('project-wiki', 'guides/second.md', '# Second\n', null);
  assert.equal((await docs.status('project-wiki')).pending.length, 2);

  const synced = await docs.sync('project-wiki');
  assert.equal(synced.pushed, true);
  assert.equal(synced.files, 2);
  assert.equal(synced.branch, 'main');
  assert.equal(git(root, 'show', '--name-only', '--format=%s', 'HEAD'), 'docs: update 2 documents\n\ndoc/guides/second.md\ndoc/guides/start.md');
  assert.equal(git(bare, 'show', 'main:doc/guides/start.md'), '# Start\n\nMore.');
  assert.match(git(root, 'status', '--porcelain'), /unrelated\.txt/);
  assert.equal(git(bare, 'rev-parse', 'main'), git(root, 'rev-parse', 'HEAD'));
  assert.deepEqual(await docs.status('project-wiki'), { pending: [], ahead: 0 });
  assert.deepEqual(await docs.sync('project-wiki'), { branch: 'main', commit: null, files: 0, pushed: false });

  await assert.rejects(docs.save('project-wiki', 'guides/start.md', 'stale', opened.sha), { status: 409 });
  await assert.rejects(docs.save('project-wiki', 'guides/start.md', 'again', null), { status: 409 });
  assert.equal((await docs.save('project-wiki', 'guides/start.md', '# Start\n\nMore.\n', updated.sha)).unchanged, true);

  for (const bad of ['../outside.md', 'a/../../x.md', '.git/config.md', 'notes.txt', '/etc/passwd.md', 'a\\b.md', 'a//b.md']) {
    await assert.rejects(docs.save('project-wiki', bad, 'x', null), { status: 400 }, bad);
  }

  await mkdir(path.join(directory, 'secret'));
  await writeFile(path.join(directory, 'secret', 'private.md'), 'private\n');
  await symlink(path.join(directory, 'secret'), path.join(root, 'doc', 'linked'));
  await symlink(path.join(directory, 'secret', 'private.md'), path.join(root, 'doc', 'leak.md'));
  await assert.rejects(docs.read('project-wiki', 'linked/private.md'), { status: 400 });
  await assert.rejects(docs.save('project-wiki', 'linked/new.md', 'x', null), { status: 400 });
  await assert.rejects(docs.read('project-wiki', 'leak.md'), { status: 400 });
  assert.deepEqual((await docs.list('project-wiki')).files.map((file) => file.path), ['guides/second.md', 'guides/start.md']);

  const activity = await db.activityEvent.findMany({ where: { action: 'docs_saved' } });
  assert.equal(activity.length, 1);
});
