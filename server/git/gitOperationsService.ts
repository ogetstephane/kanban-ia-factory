import { mkdtemp, realpath, rm, lstat, readFile, readlink } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { checkBranch, checkRepositoryUrl, isInside, PROJECT_ID, RepositoryError, type Git } from './gitCommand';
import type { WorkspaceService } from './workspaceService';

/** Local git work in project clones and ticket worktrees: documentation commits, reviews, deliveries and tags. */
export class GitOperationsService {
  constructor(private readonly workspaces: WorkspaceService, private readonly git: Git) {}

  /** Throws unless a documentation file can be committed on the checked-out branch right now. */
  async assertDocsCommittable(projectId: string) {
    const { cwd, branch } = await this.workspaces.docsWorkspace(projectId);
    if (!branch) throw new RepositoryError(409, 'The project clone is on a detached HEAD; switch to a branch before editing documentation');
    await this.noGitOperation(cwd);
    await this.deliveryIdentity(projectId);
    return { cwd, branch };
  }

  /** Uncommitted changes under the docs folder, and commits not yet on origin (null when origin/<branch> is unknown). */
  async docsChanges(projectId: string, docsPath: string) {
    const cwd = await this.workspaces.clonePath(projectId);
    const output = await this.git(['--literal-pathspecs', 'status', '--porcelain=v1', '-z', '--no-renames', '--untracked-files=all', '--', docsPath], { cwd });
    const changes: { path: string; status: 'added' | 'modified' | 'deleted' }[] = [];
    for (const entry of output.split('\0').filter(Boolean)) {
      const code = entry.slice(0, 2);
      changes.push({ path: entry.slice(3), status: code.includes('?') || code.includes('A') ? 'added' : code.includes('D') ? 'deleted' : 'modified' });
    }
    const { branch } = await this.workspaces.docsWorkspace(projectId);
    let ahead: number | null = null;
    const origin = (await this.git(['remote', 'get-url', '--push', 'origin'], { cwd }).catch(() => '')).trim();
    const pushable = (() => { try { checkRepositoryUrl(origin); return true; } catch { return false; } })();
    if (branch && pushable) {
      const count = await this.git(['rev-list', '--count', `refs/remotes/origin/${checkBranch(branch)}..HEAD`], { cwd }).catch(() => '');
      ahead = /^\d+$/.test(count.trim()) ? Number(count.trim()) : null;
    }
    return { changes, ahead, branch };
  }

  /** Commits only the given files; resolves to null when none has a change to commit. */
  async commitDocs(projectId: string, files: string[], message: string) {
    if (!files.length) return null;
    const cwd = await this.workspaces.clonePath(projectId);
    const literal = ['--literal-pathspecs'];
    await this.git([...literal, 'add', '-A', '--', ...files], { cwd });
    const staged = await this.git([...literal, 'diff', '--cached', '--name-only', '--', ...files], { cwd });
    if (!staged.trim()) return null;
    await this.git([...literal, '-c', 'commit.gpgsign=false', 'commit', '--no-verify', '--only', '-m', message, '--', ...files], { cwd });
    return (await this.git(['rev-parse', '--verify', 'HEAD'], { cwd })).trim();
  }

  async unstageDocs(projectId: string, files: string[]) {
    const cwd = await this.workspaces.clonePath(projectId);
    await this.git(['--literal-pathspecs', 'reset', '--quiet', '--', ...files], { cwd }).catch(() => undefined);
  }

  async ticketReview(
    projectId: string,
    sessionId: string,
    baseCommit: string,
    previewPath?: string,
    requiredDocumentationPath?: string,
    includePatches = false,
  ) {
    if (!/^[\w-]+$/.test(sessionId) || !/^[a-f0-9]{40,64}$/.test(baseCommit)) {
      throw new RepositoryError(400, 'Invalid ticket workspace or base commit');
    }
    const root = await this.workspaces.clonePath(projectId);
    const cwd = await this.workspaces.ticketDir(root, sessionId);
    const common = (await this.git(['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd })).trim();
    if (await realpath(common) !== await realpath(path.join(root, '.git'))) {
      throw new RepositoryError(409, 'Ticket workspace does not belong to this project');
    }
    const tracked = (await this.git(['diff', '--no-ext-diff', '--no-textconv', '--no-renames', '--name-status', '-z', baseCommit, '--'], { cwd })).split('\0');
    const entries: { path: string; status: string }[] = [];
    for (let index = 0; index + 1 < tracked.length; index += 2) {
      entries.push({ status: tracked[index], path: tracked[index + 1] });
    }
    for (const file of (await this.git(['ls-files', '--others', '--exclude-standard', '-z'], { cwd })).split('\0').filter(Boolean)) {
      entries.push({ path: file, status: 'untracked' });
    }
    if (entries.length > 300) throw new RepositoryError(422, 'Too many changed files to review (maximum 300). Review this worktree locally.');
    entries.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
    const hash = createHash('sha256').update(baseCommit);
    const files = [];
    let patchBudget = 500_000;
    for (const entry of entries) {
      let patch: string;
      let binary = false;
      if (entry.status === 'untracked') {
        const target = path.join(cwd, entry.path);
        const parent = await realpath(path.dirname(target));
        if (!isInside(await realpath(cwd), parent)) throw new RepositoryError(409, 'Changed path leaves the ticket worktree');
        const info = await lstat(target);
        if (info.size > 2_000_000) throw new RepositoryError(422, `File too large to review: ${entry.path}. Review it locally.`);
        const content = info.isSymbolicLink() ? Buffer.from(await readlink(target)) : await readFile(target);
        binary = content.includes(0);
        const text = content.toString('utf8');
        const lines = text ? text.replace(/\n$/, '').split('\n') : [];
        patch = binary ? 'Binary file (no text preview)' : `--- /dev/null\n+++ b/${entry.path}\n${lines.length
          ? `@@ -0,0 +1,${lines.length} @@\n${lines.map((line) => `+${line}`).join('\n')}\n${text.endsWith('\n') ? '' : '\\ No newline at end of file\n'}`
          : ''}`;
      } else {
        patch = await this.git(['--literal-pathspecs', 'diff', '--binary', '--no-ext-diff', '--no-textconv', '--no-renames', '--no-color', baseCommit, '--', entry.path], { cwd });
        binary = patch.includes('GIT binary patch') || patch.includes('Binary files ');
        if (entry.path === previewPath && !binary) {
          patch = await this.git(['--literal-pathspecs', 'diff', '--unified=1000000', '--no-ext-diff', '--no-textconv', '--no-renames', '--no-color', baseCommit, '--', entry.path], { cwd });
        }
      }
      if (entry.status === 'D') hash.update(JSON.stringify([entry.path, 'deleted']));
      else {
        const target = path.join(cwd, entry.path);
        const parent = await realpath(path.dirname(target));
        if (!isInside(await realpath(cwd), parent)) throw new RepositoryError(409, 'Changed path leaves the ticket worktree');
        const info = await lstat(target);
        if (!info.isFile() && !info.isSymbolicLink()) throw new RepositoryError(422, 'Submodule or directory changes must be reviewed and delivered locally');
        if (info.size > 2_000_000) throw new RepositoryError(422, `File too large to review: ${entry.path}. Review it locally.`);
        const content = info.isSymbolicLink() ? Buffer.from(await readlink(target)) : await readFile(target);
        hash.update(JSON.stringify([entry.path, info.isSymbolicLink() ? 'symlink' : 'file', !!(info.mode & 0o111), createHash('sha256').update(content).digest('hex')]));
      }
      const displayedPatch = entry.path === previewPath || includePatches
        ? patch.slice(0, Math.min(128_000, patchBudget))
        : '';
      if (includePatches) patchBudget -= displayedPatch.length;
      files.push({
        ...entry, patch: displayedPatch ? binary ? 'Binary file (no text preview)' : displayedPatch : '',
        binary, truncated: !binary && !!(entry.path === previewPath || includePatches) && patch.length > displayedPatch.length,
      });
    }
    if (previewPath && !entries.some((entry) => entry.path === previewPath)) throw new RepositoryError(404, 'Changed file not found. Reload the review.');
    let documentation: { path: string; ready: boolean } | undefined;
    if (requiredDocumentationPath) {
      const entry = entries.find((item) => item.path === requiredDocumentationPath);
      let ready = false;
      if (entry && entry.status !== 'D') {
        let parent = cwd;
        let plainParents = true;
        for (const segment of requiredDocumentationPath.split('/').slice(0, -1)) {
          parent = path.join(parent, segment);
          const info = await lstat(parent).catch((error: NodeJS.ErrnoException) => {
            if (error.code === 'ENOENT') return null;
            throw error;
          });
          if (!info || !info.isDirectory() || info.isSymbolicLink()) { plainParents = false; break; }
        }
        if (plainParents) {
          const target = path.join(cwd, requiredDocumentationPath);
          const info = await lstat(target).catch((error: NodeJS.ErrnoException) => {
            if (error.code === 'ENOENT') return null;
            throw error;
          });
          if (info?.isFile() && !info.isSymbolicLink()) {
            const content = await readFile(target);
            ready = !content.includes(0) && content.toString('utf8').trim().length > 0;
          }
        }
      }
      documentation = { path: requiredDocumentationPath, ready };
    }
    return { baseCommit, token: hash.digest('hex'), files, ...(documentation ? { documentation } : {}) };
  }

  async noGitOperation(cwd: string) {
    for (const name of ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply', 'sequencer', 'BISECT_LOG']) {
      const location = (await this.git(['rev-parse', '--git-path', name], { cwd })).trim();
      const exists = await lstat(path.resolve(cwd, location)).then(() => true, (error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return false;
        throw error;
      });
      if (exists) throw new RepositoryError(409, 'A git operation is in progress. Finish or abort it locally before delivering.');
    }
  }

  async deliveryState(projectId: string, sessionId: string, targetBranch: string) {
    if (!PROJECT_ID.test(sessionId)) throw new RepositoryError(400, 'Invalid session ID');
    checkBranch(targetBranch);
    const root = await this.workspaces.clonePath(projectId);
    const workspace = await this.workspaces.ticketDir(root, sessionId);
    const common = (await this.git(['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: workspace })).trim();
    if (await realpath(common) !== await realpath(path.join(root, '.git'))) throw new RepositoryError(409, 'Ticket workspace does not belong to this project');
    const branch = (await this.git(['symbolic-ref', '--short', 'HEAD'], { cwd: workspace })).trim();
    if (branch !== `kanban/${sessionId}` || targetBranch === branch) throw new RepositoryError(409, 'Ticket and target branches are invalid for delivery');
    const current = (await this.git(['symbolic-ref', '--short', 'HEAD'], { cwd: root })).trim();
    if (current !== targetBranch) throw new RepositoryError(409, `Switch the project clone back to ${targetBranch} before delivering. The target is pinned to the ticket's original project branch.`);
    await this.noGitOperation(root);
    await this.noGitOperation(workspace);
    if ((await this.git(['status', '--porcelain', '--untracked-files=all'], { cwd: root })).trim()) {
      throw new RepositoryError(409, 'The project clone has uncommitted or untracked changes. Commit or move them locally before delivering.');
    }
    const targetHead = (await this.git(['rev-parse', '--verify', 'HEAD'], { cwd: root })).trim();
    const ticketHead = (await this.git(['rev-parse', '--verify', 'HEAD'], { cwd: workspace })).trim();
    // Stage a snapshot in a private index; preview must not modify the user's real index.
    const temporary = await mkdtemp(path.join(root, '.git', 'kanban-delivery-'));
    let tree: string;
    try {
      const indexFile = path.join(temporary, 'index');
      await this.git(['read-tree', 'HEAD'], { cwd: workspace, indexFile });
      await this.git(['-c', 'core.hooksPath=/dev/null', 'add', '--all', '--', '.'], { cwd: workspace, indexFile });
      tree = (await this.git(['write-tree'], { cwd: workspace, indexFile })).trim();
    } finally { await rm(temporary, { recursive: true, force: true }); }
    return { targetHead, ticketHead, tree, clonePath: root };
  }

  async deliveryIdentity(projectId: string) {
    const cwd = await this.workspaces.clonePath(projectId);
    try {
      await this.git(['var', 'GIT_AUTHOR_IDENT'], { cwd });
      await this.git(['var', 'GIT_COMMITTER_IDENT'], { cwd });
    } catch (error) {
      if (!(error instanceof RepositoryError)) throw error;
      throw new RepositoryError(422, `Configure git user.name and user.email for the server user or project clone before committing. ${error.message}`);
    }
  }

  async pinReviewCommit(projectId: string, publicationId: string, commit: string) {
    if (!PROJECT_ID.test(publicationId) || !/^[a-f0-9]{40,64}$/.test(commit)) throw new RepositoryError(400, 'Invalid review commit');
    await this.git(['update-ref', `refs/kanban/reviews/${publicationId}`, commit], { cwd: await this.workspaces.clonePath(projectId) });
  }

  async createTicketCommit(projectId: string, sessionId: string, tree: string, parent: string, message: string, deliveryId: string) {
    const cwd = await this.workspaces.ticketDir(await this.workspaces.clonePath(projectId), sessionId);
    return (await this.git(['-c', 'commit.gpgsign=false', 'commit-tree', tree, '-p', parent, '-m',
      `${message}\n\nKanban-Delivery: ${deliveryId}\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`], { cwd })).trim();
  }

  async applyTicketCommit(projectId: string, sessionId: string, commit: string, parent: string) {
    const cwd = await this.workspaces.ticketDir(await this.workspaces.clonePath(projectId), sessionId);
    const head = (await this.git(['rev-parse', 'HEAD'], { cwd })).trim();
    const index = (await this.git(['write-tree'], { cwd })).trim();
    const parentTree = (await this.git(['rev-parse', `${parent}^{tree}`], { cwd })).trim();
    const commitTree = (await this.git(['rev-parse', `${commit}^{tree}`], { cwd })).trim();
    if (index !== parentTree && index !== commitTree) throw new RepositoryError(409, 'The ticket has a partially staged snapshot. Preserve it locally, or stage all reviewed changes before retrying; delivery will not discard staged content.');
    if (head !== commit && head !== parent) throw new RepositoryError(409, 'The ticket branch changed while committing');
    if (head !== commit) await this.git(['update-ref', `refs/heads/kanban/${sessionId}`, commit, parent], { cwd });
    await this.git(['read-tree', commit], { cwd });
  }

  async containsDeliveryMerge(projectId: string, merge: string, head: string) {
    const cwd = await this.workspaces.clonePath(projectId);
    return (await this.git(['merge-base', merge, head], { cwd })).trim() === merge;
  }

  async releaseTag(projectId: string, tag: string) {
    const cwd = await this.workspaces.clonePath(projectId);
    await this.git(['check-ref-format', `refs/tags/${tag}`], { cwd });
    const output = await this.git(['for-each-ref', '--format=%(refname) %(objectname)', '--', `refs/tags/${tag}`], { cwd });
    return output.split('\n').map((line) => line.split(' ')).find(([ref]) => ref === `refs/tags/${tag}`)?.[1] ?? null;
  }

  async createReleaseTag(projectId: string, tag: string, commit: string) {
    const cwd = await this.workspaces.clonePath(projectId);
    const existing = await this.releaseTag(projectId, tag);
    if (existing) {
      if (existing !== commit) throw new RepositoryError(409, `Tag ${tag} already exists on a different object; it will never be overwritten`);
      return existing;
    }
    await this.git(['update-ref', `refs/tags/${tag}`, commit, '0'.repeat(commit.length)], { cwd });
    return commit;
  }

  async prepareDeliveryMerge(projectId: string, targetHead: string, commit: string, deliveryId: string) {
    const cwd = await this.workspaces.clonePath(projectId);
    let output: string;
    try {
      output = await this.git(['-c', 'merge.renames=false', 'merge-tree', '--write-tree', targetHead, commit], { cwd });
    } catch (error) {
      if (!(error instanceof RepositoryError)) throw error;
      throw new RepositoryError(409, `Unable to prepare a conflict-free merge. The target clone is unchanged; resolve the branch differences locally, then reload delivery. ${error.message}`);
    }
    const tree = output.trim().split('\n')[0];
    if (!/^[a-f0-9]{40,64}$/.test(tree)) throw new RepositoryError(422, 'Git did not return a merge tree');
    return (await this.git(['-c', 'commit.gpgsign=false', 'commit-tree', tree, '-p', targetHead, '-p', commit, '-m',
      `Deliver Kanban ticket\n\nKanban-Delivery: ${deliveryId}\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`], { cwd })).trim();
  }

  async applyDeliveryMerge(projectId: string, targetBranch: string, expectedHead: string, merge: string) {
    const cwd = await this.workspaces.clonePath(projectId);
    const branch = (await this.git(['symbolic-ref', '--short', 'HEAD'], { cwd })).trim();
    const head = (await this.git(['rev-parse', 'HEAD'], { cwd })).trim();
    if (branch !== targetBranch) throw new RepositoryError(409, 'The project branch changed. Reload delivery.');
    if (head !== merge) {
      if (await this.containsDeliveryMerge(projectId, merge, head)) return head;
      if (head !== expectedHead) throw new RepositoryError(409, 'The target branch changed. Reload delivery before merging.');
      await this.noGitOperation(cwd);
      if ((await this.git(['status', '--porcelain', '--untracked-files=all'], { cwd })).trim()) throw new RepositoryError(409, 'The target clone is no longer clean');
      await this.git(['-c', 'core.hooksPath=/dev/null', '-c', 'merge.autoStash=false', 'merge', '--ff-only', '--no-overwrite-ignore', merge], { cwd });
    }
    return (await this.git(['rev-parse', 'HEAD'], { cwd })).trim();
  }

  async cleanupTicket(projectId: string, sessionId: string, baseCommit: string) {
    const review = await this.ticketReview(projectId, sessionId, baseCommit);
    if (review.files.length) throw new RepositoryError(409, 'This worktree contains ticket changes. Keep or integrate them locally before cleanup; no changes will be discarded.');
    await this.workspaces.removeTicketWorktree(projectId, sessionId);
  }

  async cleanupPublishedTicket(projectId: string, sessionId: string, baseCommit: string, token: string, commit: string, parent: string) {
    if (!PROJECT_ID.test(sessionId)) throw new RepositoryError(400, 'Invalid session ID');
    const root = await this.workspaces.clonePath(projectId);
    const listing = await this.git(['worktree', 'list', '--porcelain', '-z'], { cwd: root });
    if (!listing.split('\0').includes(`branch refs/heads/kanban/${sessionId}`)) return;
    const cwd = await this.workspaces.ticketDir(root, sessionId);
    await this.noGitOperation(cwd);
    if ((await this.ticketReview(projectId, sessionId, baseCommit)).token !== token) {
      throw new RepositoryError(409, 'Worktree changed after publication. Local changes were preserved; inspect them before retrying cleanup.');
    }
    if ((await this.git(['ls-files', '--others', '--ignored', '--exclude-standard'], { cwd })).trim()) {
      throw new RepositoryError(409, 'Worktree contains ignored files. Remove or preserve them locally before retrying cleanup.');
    }
    // Make the reviewed snapshot clean without discarding staged or later local changes.
    await this.applyTicketCommit(projectId, sessionId, commit, parent);
    await this.workspaces.removeTicketWorktree(projectId, sessionId);
  }
}
