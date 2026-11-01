import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { access, mkdir, mkdtemp, readdir, readFile, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { checkBranch, checkRepositoryUrl, RepositoryError, RepositoryService } from './repositoryService';
import { createSourceRepository } from './testRepository';

let directory: string;
let source: { url: string; devCommit: string };
let service: RepositoryService;

before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'kanban-git-test-'));
  directory = await realpath(directory);
  source = await createSourceRepository(path.join(directory, 'allowed', 'source'));
  service = new RepositoryService(path.join(directory, 'workspaces'), { localRoots: [path.join(directory, 'allowed')] });
});

after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});

const rejects = (fn: () => unknown, status = 400) => assert.throws(fn, (error) => error instanceof RepositoryError && error.status === status);

test('accepts https, ssh and scp-like URLs only', () => {
  assert.equal(checkRepositoryUrl(' https://github.com/org/repo.git '), 'https://github.com/org/repo.git');
  assert.equal(checkRepositoryUrl('ssh://git@host/org/repo.git'), 'ssh://git@host/org/repo.git');
  assert.equal(checkRepositoryUrl('git@github.com:org/repo.git'), 'git@github.com:org/repo.git');
  for (const url of ['file:///etc', 'ext::sh -c id', '--upload-pack=x', 'http://host/repo', 'https://u:secret@host/repo', '']) {
    rejects(() => checkRepositoryUrl(url));
  }
  rejects(() => checkRepositoryUrl('git@github.com:org/repo.git', 'token'));
  assert.ok(checkRepositoryUrl('https://github.com/org/repo.git', 'token'));
});

test('validates branch names', () => {
  assert.equal(checkBranch('feature/login-v2'), 'feature/login-v2');
  for (const branch of ['-b', 'a..b', 'a b', 'x.lock', 'dir/', 'a@{1}']) rejects(() => checkBranch(branch));
});

test('lists remote branches with the default branch', async () => {
  assert.deepEqual(await service.branches({ url: source.url }), { defaultBranch: 'main', branches: ['dev', 'main'] });
});

test('clones the selected branch into the project workspace', async () => {
  const cloned = await service.clone('proj-1', { url: source.url, branch: 'dev' });
  assert.deepEqual(cloned, { url: source.url, branch: 'dev', commit: source.devCommit });
  assert.equal(await readFile(path.join(service.pathFor('proj-1'), 'DEV.md'), 'utf8'), '# dev\n');
  assert.deepEqual(await readdir(service.root), ['proj-1']);
});

test('clones the default branch when none is given', async () => {
  assert.equal((await service.clone('proj-2', { url: source.url })).branch, 'main');
});

test('failed clones leave nothing behind', async () => {
  await mkdir(path.join(directory, 'allowed', 'not-git'));
  await assert.rejects(service.clone('proj-3', { url: path.join(directory, 'allowed', 'not-git') }), (error) => error instanceof RepositoryError && error.status === 422);
  await assert.rejects(service.clone('proj-4', { url: source.url, branch: 'nope' }), RepositoryError);
  assert.deepEqual((await readdir(service.root)).sort(), ['proj-1', 'proj-2']);
});

test('refuses to overwrite an existing workspace and rejects unsafe project IDs', async () => {
  await assert.rejects(service.clone('proj-1', { url: source.url }), (error) => error instanceof RepositoryError && error.status === 409);
  rejects(() => service.pathFor('../escape'));
});

test('removes workspaces', async () => {
  await service.remove('proj-2');
  await assert.rejects(access(service.pathFor('proj-2')));
  await service.removeAllExcept([]);
  assert.deepEqual(await readdir(service.root), []);
});

const status = (code: number) => (error: unknown) => error instanceof RepositoryError && error.status === code;

test('local folders: copies the source, accepts file:// URLs, and rejects tokens', async () => {
  const cloned = await service.clone('proj-local', { url: `file://${source.url}` });
  assert.equal(cloned.url, source.url);
  assert.equal(await readFile(path.join(service.pathFor('proj-local'), 'README.md'), 'utf8'), '# main\n');
  // No hard links into the source repository: every cloned object file has a single link.
  const packs = path.join(service.pathFor('proj-local'), '.git', 'objects', 'pack');
  for (const file of await readdir(packs)) assert.equal((await stat(path.join(packs, file))).nlink, 1);
  await service.remove('proj-local');
  await assert.rejects(service.branches({ url: source.url, token: 'x' }), status(400));
});

test('local folders must stay inside the allowed roots', async () => {
  const outside = await createSourceRepository(path.join(directory, 'outside'));
  await assert.rejects(service.branches({ url: outside.url }), status(403));
  await assert.rejects(service.branches({ url: path.join(source.url, '..', '..', 'outside') }), status(403));
  await symlink(outside.url, path.join(directory, 'allowed', 'link'));
  await assert.rejects(service.branches({ url: path.join(directory, 'allowed', 'link') }), status(403));
  await assert.rejects(service.branches({ url: path.join(directory, 'allowed', 'missing') }), status(400));
});

test('local folders are disabled without allowed roots', async () => {
  const remoteOnly = new RepositoryService(path.join(directory, 'other'));
  await assert.rejects(remoteOnly.branches({ url: source.url }), status(400));
});

test('clones an empty repository without a commit', async () => {
  const empty = path.join(directory, 'allowed', 'empty');
  await mkdir(empty);
  execFileSync('git', ['init', '--initial-branch=trunk'], { cwd: empty, stdio: 'pipe' });
  assert.deepEqual(await service.clone('proj-empty', { url: empty }), { url: empty, branch: 'trunk', commit: undefined });
  await service.remove('proj-empty');
});

test('lists local git folders under the allowed roots without following symlinks', async () => {
  await mkdir(path.join(directory, 'allowed', 'group', 'node_modules', 'dep', '.git'), { recursive: true });
  await mkdir(path.join(directory, 'allowed', 'group', 'nested', '.git'), { recursive: true });
  assert.deepEqual(await service.localRepositories(), [
    path.join(directory, 'allowed', 'empty'),
    path.join(directory, 'allowed', 'group', 'nested'),
    source.url,
  ]);
  assert.deepEqual(await new RepositoryService(path.join(directory, 'other')).localRepositories(), []);
});

test('switches branches offline and refuses with uncommitted changes', async () => {
  await service.clone('proj-switch', { url: source.url });
  assert.deepEqual(await service.workspaceBranches('proj-switch'), { current: 'main', branches: ['dev', 'main'] });
  assert.deepEqual(await service.switchBranch('proj-switch', 'dev'), { branch: 'dev', commit: source.devCommit, previous: 'main' });
  assert.equal(await readFile(path.join(service.pathFor('proj-switch'), 'DEV.md'), 'utf8'), '# dev\n');
  assert.equal((await service.switchBranch('proj-switch', 'main')).previous, 'dev');
  await assert.rejects(service.switchBranch('proj-switch', 'missing'), status(404));
  await assert.rejects(service.switchBranch('proj-switch', '--orphan'), status(400));
  await writeFile(path.join(service.pathFor('proj-switch'), 'README.md'), 'changed\n');
  await assert.rejects(service.switchBranch('proj-switch', 'dev'), status(409));
  await assert.rejects(service.workspaceBranches('proj-unknown'), status(404));
  await service.remove('proj-switch');
});

test('selected text previews compare complete file context without changing the review fingerprint', async () => {
  const projectId = 'proj-diff-context';
  await service.clone(projectId, { url: source.url });
  const root = service.pathFor(projectId);
  const content = Array.from({ length: 60 }, (_, index) => `Line ${index + 1}`).join('\n') + '\n';
  await writeFile(path.join(root, 'README.md'), content);
  execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=t@example.com', 'commit', '-am', 'Diff fixture'], { cwd: root, stdio: 'pipe' });
  const prepared = await service.ticketWorkspace(projectId, 'diff-preview', 'main');
  await writeFile(path.join(prepared.workspace, 'README.md'), content.replace('Line 30\n', 'Updated line 30\n'));
  const overview = await service.ticketReview(projectId, 'diff-preview', prepared.baseCommit);
  const selected = await service.ticketReview(projectId, 'diff-preview', prepared.baseCommit, 'README.md');
  assert.equal(overview.files[0].patch, '');
  assert.equal(overview.token, selected.token);
  assert.match(selected.files[0].patch, /@@ -1,60 \+1,60 @@/);
  assert.match(selected.files[0].patch, /\n Line 1\n/);
  assert.match(selected.files[0].patch, /-Line 30\n\+Updated line 30\n/);
  assert.match(selected.files[0].patch, /\n Line 60\n/);
  await writeFile(path.join(prepared.workspace, 'new.txt'), 'New text');
  const added = (await service.ticketReview(projectId, 'diff-preview', prepared.baseCommit, 'new.txt')).files.find((file) => file.path === 'new.txt')!;
  assert.match(added.patch, /@@ -0,0 \+1,1 @@\n\+New text\n\\ No newline at end of file\n/);
  await writeFile(path.join(prepared.workspace, 'new.txt'), '\n');
  const emptyLine = (await service.ticketReview(projectId, 'diff-preview', prepared.baseCommit, 'new.txt')).files.find((file) => file.path === 'new.txt')!;
  assert.match(emptyLine.patch, /@@ -0,0 \+1,1 @@\n\+\n$/);
  await writeFile(path.join(prepared.workspace, 'new.txt'), '');
  const emptyFile = (await service.ticketReview(projectId, 'diff-preview', prepared.baseCommit, 'new.txt')).files.find((file) => file.path === 'new.txt')!;
  assert.doesNotMatch(emptyFile.patch, /@@/);
});

test('branch persistence holds the shared project lock and failed persistence restores the original branch', async () => {
  const projectId = 'proj-switch-persist';
  await service.clone(projectId, { url: source.url });
  let persisted = false;
  await service.switchBranch(projectId, 'dev', async () => {
    assert.equal((await service.workspaceBranches(projectId)).current, 'dev');
    persisted = true;
  });
  assert.equal(persisted, true);
  await assert.rejects(service.switchBranch(projectId, 'main', async () => { throw new Error('Database write failed'); }), /Database write failed/);
  assert.equal((await service.workspaceBranches(projectId)).current, 'dev');
  await service.remove(projectId);
});

test('Git inventory lists actual main, ticket, external, detached, locked and missing worktrees without pruning', async () => {
    const projectId = 'proj-inventory';
    await service.clone(projectId, { url: source.url });
    const root = service.pathFor(projectId);
    const ticket = await service.ticketWorkspace(projectId, 'inventory-session', 'main');
    const external = path.join(directory, 'external worktree\nwith newline');
    execFileSync('git', ['worktree', 'add', '--detach', external, 'HEAD'], { cwd: root, stdio: 'pipe' });
    execFileSync('git', ['worktree', 'lock', '--reason', 'Keep this\nexternal tree', external], { cwd: root, stdio: 'pipe' });
    const missing = path.join(directory, 'missing worktree');
    execFileSync('git', ['worktree', 'add', '-b', 'external-missing', missing, 'HEAD'], { cwd: root, stdio: 'pipe' });
    await rm(missing, { recursive: true, force: true });
    execFileSync('git', ['switch', 'dev'], { cwd: root, stdio: 'pipe' });
    const result = await service.inventory(projectId);
    assert.equal(result.branch, 'dev');
    assert.equal(result.head, source.devCommit);
    assert.equal(result.worktrees.length, 4);
    assert.equal(result.worktrees[0].main, true);
    assert.equal(result.worktrees.find((tree) => tree.path === ticket.workspace)?.branch, 'kanban/inventory-session');
    const detached = result.worktrees.find((tree) => tree.path === external)!;
    assert.equal(detached.detached, true);
    assert.equal(detached.branch, null);
    assert.equal(detached.locked, 'Keep this\nexternal tree');
    assert.notEqual(result.worktrees.find((tree) => tree.path === missing)?.prunable, null);
    assert.equal((await service.inventory(projectId)).worktrees.length, 4, 'inventory never prunes registrations');
    execFileSync('git', ['switch', '--detach', 'HEAD'], { cwd: root, stdio: 'pipe' });
    assert.equal((await service.inventory(projectId)).branch, null);
    execFileSync('git', ['worktree', 'unlock', external], { cwd: root, stdio: 'pipe' });
    execFileSync('git', ['worktree', 'remove', external], { cwd: root, stdio: 'pipe' });
    await service.remove(projectId);
  });

test('Git inventory supports an empty clone and reports missing repositories explicitly', async () => {
    const root = service.pathFor('proj-empty-inventory');
    await mkdir(root, { recursive: true });
    execFileSync('git', ['init', '--initial-branch=main'], { cwd: root, stdio: 'pipe' });
    const result = await service.inventory('proj-empty-inventory');
    assert.equal(result.branch, 'main');
    assert.equal(result.head, null);
    assert.equal(result.worktrees.length, 1);
    await assert.rejects(service.inventory('proj-no-inventory'), status(404));
    await service.remove('proj-empty-inventory');
  });

test('names workspaces after the slugged project name and keeps them across restarts', async () => {
  await service.clone('proj-slug-a', { url: source.url }, 'Mon Projet Été!');
  await service.clone('proj-slug-b', { url: source.url }, 'mon projet ete');
  assert.equal(path.basename(service.pathFor('proj-slug-a')), 'mon-projet-ete');
  assert.equal(path.basename(service.pathFor('proj-slug-b')), 'mon-projet-ete-proj-slu');
  const restarted = new RepositoryService(service.root, { localRoots: [path.join(directory, 'allowed')] });
  await restarted.init();
  assert.equal(restarted.pathFor('proj-slug-a'), service.pathFor('proj-slug-a'));
  await restarted.removeAllExcept(['proj-slug-b']);
  assert.deepEqual(await readdir(service.root), ['mon-projet-ete-proj-slu']);
  await restarted.remove('proj-slug-b');
  assert.deepEqual(await readdir(service.root), []);
});

test('names ticket worktrees after the slugged task title and still finds them by session', async () => {
  await service.clone('proj-wt', { url: source.url });
  const a = await service.ticketWorkspace('proj-wt', 'session-aaaaaaaa', 'main', 'Corriger le bug d\'accès !');
  const b = await service.ticketWorkspace('proj-wt', 'session-bbbbbbbb', 'main', 'corriger le bug d acces');
  assert.equal(path.basename(a.workspace), 'corriger-le-bug-d-acces');
  assert.equal(path.basename(b.workspace), 'corriger-le-bug-d-acces-session-');
  assert.equal(a.branch, 'kanban/session-aaaaaaaa');
  assert.deepEqual(await service.ticketWorkspace('proj-wt', 'session-aaaaaaaa', 'main', 'Renamed'), a);
  const review = await service.ticketReview('proj-wt', 'session-aaaaaaaa', a.baseCommit);
  assert.deepEqual(review.files, []);
  await service.cleanupTicket('proj-wt', 'session-aaaaaaaa', a.baseCommit);
  await assert.rejects(access(a.workspace));
  await service.remove('proj-wt');
});
