import { checkBranch, checkRepositoryUrl, RepositoryError, slugify, type Git } from './gitCommand';
import type { GitOperationsService } from './gitOperationsService';
import type { WorkspaceService } from './workspaceService';

/** Exchanges with the origin remote: documentation, review, finished-branch and release-tag pushes. */
export class GitPublicationService {
  constructor(
    private readonly workspaces: WorkspaceService,
    private readonly operations: GitOperationsService,
    private readonly git: Git,
  ) {}

  /** Pushes the checked-out branch to a remote origin without forcing. Failures never undo the local commit. */
  async pushCheckedOutBranch(projectId: string): Promise<{ pushed: boolean; reason?: string }> {
    const { cwd, branch } = await this.workspaces.docsWorkspace(projectId);
    if (!branch) return { pushed: false, reason: 'Detached HEAD' };
    try {
      const urls = (await this.git(['remote', 'get-url', '--push', '--all', 'origin'], { cwd })).trim().split('\n');
      if (urls.length !== 1) return { pushed: false, reason: 'Origin must have exactly one push URL' };
      let remoteUrl: string;
      try { remoteUrl = checkRepositoryUrl(urls[0]); }
      catch { return { pushed: false, reason: 'The origin is a local folder, so nothing was pushed' }; }
      await this.git(['-c', 'push.recurseSubmodules=no', 'push', '--porcelain', '--no-verify', '--',
        remoteUrl, `refs/heads/${checkBranch(branch)}:refs/heads/${branch}`], { cwd, timeout: 60_000 });
      // Pushing to a URL does not move origin/<branch>, which the "commits to push" count relies on.
      await this.git(['update-ref', `refs/remotes/origin/${branch}`, 'HEAD'], { cwd }).catch(() => undefined);
      return { pushed: true };
    } catch (error) {
      if (!(error instanceof RepositoryError)) throw error;
      return { pushed: false, reason: error.message };
    }
  }

  featureBranch(title: string) { return `feature/${slugify(title) || 'untitled'}`; }

  async publicationOrigin(projectId: string) {
    const cwd = await this.workspaces.clonePath(projectId);
    const urls = (await this.git(['remote', 'get-url', '--push', '--all', 'origin'], { cwd })).trim().split('\n');
    if (urls.length !== 1) throw new RepositoryError(409, 'Review publication requires exactly one origin push URL');
    return (await this.workspaces.resolveSource(urls[0])).url;
  }

  private async originRef(projectId: string, branch: string, origin: string, fetch = false) {
    checkBranch(branch);
    if (await this.publicationOrigin(projectId) !== origin) throw new RepositoryError(409, 'Origin changed. Restore it before retrying Finish.');
    const cwd = await this.workspaces.clonePath(projectId);
    const { url, protocols } = await this.workspaces.resolveSource(origin);
    const ref = `refs/heads/${branch}`;
    const output = (await this.git(['ls-remote', '--refs', '--', url, ref], { cwd, protocols, timeout: 60_000 })).trim();
    const head = output ? output.split(/\s/)[0] : null;
    if (fetch && head) {
      await this.git(['fetch', '--no-tags', '--', url, ref], { cwd, protocols, timeout: 60_000 });
      if ((await this.git(['rev-parse', 'FETCH_HEAD'], { cwd })).trim() !== head) throw new RepositoryError(409, 'Remote branch changed while fetching. Reload Finish.');
    }
    return head;
  }

  async finishState(projectId: string, branch: string, targetBranch: string, origin: string) {
    checkBranch(branch); checkBranch(targetBranch);
    if (!branch.startsWith('feature/') || branch === targetBranch) throw new RepositoryError(409, 'Finish must close a feature branch distinct from the project branch');
    const cwd = await this.workspaces.clonePath(projectId);
    const inventory = await this.workspaces.inventory(projectId);
    const remote = await this.workspaces.resolveSource(origin);
    const symref = await this.git(['ls-remote', '--symref', '--', remote.url, 'HEAD'], { cwd, protocols: remote.protocols, timeout: 60_000 });
    if (symref.split('\n').includes(`ref: refs/heads/${branch}\tHEAD`)) throw new RepositoryError(409, 'Finish cannot close the origin default branch');
    if (inventory.worktrees.some((tree) => tree.branch === branch)) throw new RepositoryError(409, 'The feature branch is checked out in a worktree. Remove it safely before Finish.');
    const current = (await this.git(['symbolic-ref', '--short', 'HEAD'], { cwd })).trim();
    if (current !== targetBranch) throw new RepositoryError(409, `Switch the project clone to ${targetBranch} before Finish`);
    await this.operations.noGitOperation(cwd);
    if ((await this.git(['status', '--porcelain', '--untracked-files=all'], { cwd })).trim()) throw new RepositoryError(409, 'The project clone must be clean before Finish');
    const targetHead = (await this.git(['rev-parse', 'HEAD'], { cwd })).trim();
    const remoteTarget = await this.originRef(projectId, targetBranch, origin, true);
    if (remoteTarget && !await this.operations.containsDeliveryMerge(projectId, remoteTarget, targetHead)) {
      throw new RepositoryError(409, 'The project branch is behind or diverged from origin. Synchronize it locally before Finish.');
    }
    return { targetHead, featureHead: await this.originRef(projectId, branch, origin, true) };
  }

  async pushFinishedProject(projectId: string, branch: string, commit: string, origin: string) {
    const cwd = await this.workspaces.clonePath(projectId);
    await this.originRef(projectId, branch, origin);
    const { url, protocols } = await this.workspaces.resolveSource(origin);
    await this.git(['-c', 'push.followTags=false', '-c', 'push.recurseSubmodules=no', 'push',
      '--porcelain', '--no-verify', '--no-follow-tags', '--', url, `${commit}:refs/heads/${branch}`], { cwd, protocols, timeout: 60_000 });
    const remote = await this.originRef(projectId, branch, origin, true);
    if (!remote || !await this.operations.containsDeliveryMerge(projectId, commit, remote)) throw new RepositoryError(409, 'The pushed project commit could not be verified on origin');
  }

  async closeFinishedBranch(projectId: string, branch: string, featureHead: string, targetBranch: string, merge: string, origin: string) {
    if (!branch.startsWith('feature/') || branch === targetBranch) throw new RepositoryError(409, 'Invalid feature branch for closure');
    const cwd = await this.workspaces.clonePath(projectId);
    const target = await this.originRef(projectId, targetBranch, origin, true);
    if (!target || !await this.operations.containsDeliveryMerge(projectId, merge, target)) throw new RepositoryError(409, 'Origin project branch no longer contains the finished merge');
    const remote = await this.originRef(projectId, branch, origin);
    if (remote && remote !== featureHead) throw new RepositoryError(409, 'The feature branch changed after Finish started. It was not deleted; inspect it locally.');
    const { url, protocols } = await this.workspaces.resolveSource(origin);
    const ref = `refs/heads/${branch}`;
    const symref = await this.git(['ls-remote', '--symref', '--', url, 'HEAD'], { cwd, protocols, timeout: 60_000 });
    if (symref.split('\n').includes(`ref: ${ref}\tHEAD`)) throw new RepositoryError(409, 'Finish cannot close the origin default branch');
    if (remote) {
      // Conditional deletion protects commits pushed concurrently, unlike an unconditional --delete.
      await this.git(['-c', 'push.followTags=false', '-c', 'push.recurseSubmodules=no', 'push', '--no-verify',
        `--force-with-lease=${ref}:${featureHead}`, '--', url, `:${ref}`], { cwd, protocols, timeout: 60_000 });
    }
    if (await this.originRef(projectId, branch, origin)) throw new RepositoryError(409, 'Origin feature branch deletion could not be verified');
    if ((await this.workspaces.inventory(projectId)).worktrees.some((tree) => tree.branch === branch)) throw new RepositoryError(409, 'Feature branch is checked out; local deletion blocked');
    const refs = (await this.git(['for-each-ref', '--format=%(objectname)', ref], { cwd })).trim();
    if (refs) {
      if (!await this.operations.containsDeliveryMerge(projectId, refs, merge)) throw new RepositoryError(409, 'Local feature branch contains unmerged changes and was preserved');
      await this.git(['update-ref', '-d', ref, refs], { cwd });
    }
    const tracking = `refs/remotes/origin/${branch}`;
    const tracked = (await this.git(['for-each-ref', '--format=%(objectname)', tracking], { cwd })).trim();
    if (tracked === featureHead) await this.git(['update-ref', '-d', tracking, tracked], { cwd });
  }

  async pushReviewCommit(projectId: string, branch: string, commit: string, expectedOrigin: string) {
    checkBranch(branch);
    if (!branch.startsWith('feature/')) throw new RepositoryError(409, 'Review publication can only push a feature/ branch');
    const cwd = await this.workspaces.clonePath(projectId);
    if (await this.publicationOrigin(projectId) !== expectedOrigin) throw new RepositoryError(409, 'Origin changed since review publication started');
    const { url, protocols } = await this.workspaces.resolveSource(expectedOrigin);
    const ref = `refs/heads/${branch}`;
    const defaultBranch = await this.git(['ls-remote', '--symref', '--', url, 'HEAD'], { cwd, protocols, timeout: 60_000 });
    if (defaultBranch.split('\n').some((line) => line === `ref: ${ref}\tHEAD`)) throw new RepositoryError(409, 'Review publication cannot push to the origin default branch');
    const remoteHead = async () => {
      const output = (await this.git(['ls-remote', '--refs', '--', url, ref], { cwd, protocols, timeout: 60_000 })).trim();
      return output ? output.split(/\s/)[0] : null;
    };
    const existing = await remoteHead();
    let head = commit;
    if (existing) {
      await this.git(['fetch', '--no-tags', '--', url, ref], { cwd, protocols, timeout: 60_000 });
      if (await this.operations.containsDeliveryMerge(projectId, commit, existing)) return existing;
      if (!await this.operations.containsDeliveryMerge(projectId, existing, commit)) {
        head = await this.operations.prepareDeliveryMerge(projectId, existing, commit, `review-${commit.slice(0, 12)}`);
      }
    }
    await this.git(['-c', 'push.followTags=false', '-c', 'push.recurseSubmodules=no', 'push',
      '--porcelain', '--no-verify', '--no-follow-tags', '--', url, `${head}:${ref}`], { cwd, protocols, timeout: 60_000 });
    const verified = await remoteHead();
    if (!verified) throw new RepositoryError(409, 'The remote feature branch could not be verified');
    if (verified !== head) {
      await this.git(['fetch', '--no-tags', '--', url, ref], { cwd, protocols, timeout: 60_000 });
      if (!await this.operations.containsDeliveryMerge(projectId, head, verified)) throw new RepositoryError(409, 'The remote feature branch changed; retry publication');
    }
    return verified;
  }

  async releaseTarget(projectId: string, branch: string) {
    checkBranch(branch);
    const cwd = await this.workspaces.clonePath(projectId);
    const current = (await this.git(['symbolic-ref', '--short', 'HEAD'], { cwd })).trim();
    if (current !== branch) throw new RepositoryError(409, `Switch the project clone to ${branch} before publishing this release`);
    await this.operations.noGitOperation(cwd);
    const commit = (await this.git(['rev-parse', '--verify', 'HEAD'], { cwd })).trim();
    const urls = (await this.git(['remote', 'get-url', '--push', '--all', 'origin'], { cwd })).trim().split('\n');
    if (urls.length !== 1) throw new RepositoryError(409, 'Release publication requires exactly one origin push URL');
    let remoteUrl: string;
    try { remoteUrl = checkRepositoryUrl(urls[0]); }
    catch (error) {
      if (!(error instanceof RepositoryError)) throw error;
      throw new RepositoryError(409, 'Release publication requires an HTTPS or SSH origin, not a local source folder. Configure a remote project before publishing.');
    }
    return { branch, commit, remoteUrl };
  }

  async pushReleaseTag(projectId: string, tag: string, commit: string, remoteUrl: string) {
    checkRepositoryUrl(remoteUrl);
    const cwd = await this.workspaces.clonePath(projectId);
    const ref = `refs/tags/${tag}`;
    if (await this.operations.releaseTag(projectId, tag) !== commit) throw new RepositoryError(409, 'The local release tag changed; publication was stopped');
    const remoteTag = async () => {
      const output = await this.git(['ls-remote', '--refs', '--', remoteUrl, ref], { cwd, timeout: 60_000 });
      return output.split('\n').map((line) => line.split('\t')).find(([, name]) => name === ref)?.[0] ?? null;
    };
    const existing = await remoteTag();
    if (existing && existing !== commit) throw new RepositoryError(409, `Remote tag ${tag} already exists on a different object; it will never be overwritten`);
    if (!existing) {
      await this.git(['-c', 'push.followTags=false', '-c', 'push.recurseSubmodules=no', 'push',
        '--porcelain', '--no-verify', '--no-follow-tags', '--', remoteUrl, `${commit}:${ref}`], { cwd, timeout: 60_000 });
    }
    if (await remoteTag() !== commit) throw new RepositoryError(409, 'The remote tag could not be verified. Reload and retry publication.');
    if (await this.operations.releaseTag(projectId, tag) !== commit) throw new RepositoryError(409, 'The remote tag was pushed, but the local tag changed. Restore it to the saved release commit, then retry to reconcile.');
  }
}
