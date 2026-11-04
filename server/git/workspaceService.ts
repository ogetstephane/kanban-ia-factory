import { mkdir, readdir, realpath, rename, rm, lstat, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { RepositoryInput } from '../../shared/types/board';
import { checkBranch, checkRepositoryUrl, isInside, PROJECT_ID, RepositoryError, slugify, type Git } from './gitCommand';

export interface ClonedRepository { url: string; branch: string; commit?: string }
export interface RemoteBranches { defaultBranch?: string; branches: string[] }
export interface WorkspaceBranches { current: string; branches: string[] }
export interface SwitchedBranch { branch: string; commit?: string; previous: string }

const PROJECT_MARKER = 'kanban-project-id';
const isLocalPath = (value: string) => value.startsWith('/') || value.startsWith('file://');

interface Source { url: string; protocols: string; local: boolean }

/** Project clones under `root`, their branches and the ticket worktrees created inside them. */
export class WorkspaceService {
  private readonly locks = new Map<string, Promise<void>>();

  constructor(
    readonly root: string,
    private readonly git: Git,
    readonly localRoots: string[] = [],
  ) {}

  /**
   * Lists git folders under the allowed roots (symlinks, hidden folders and node_modules are skipped).
   * A root that is itself a git folder is listed and still scanned; other repositories are not descended into.
   */
  async localRepositories(maxDepth = 3, limit = 200): Promise<string[]> {
    const found: string[] = [];
    const walk = async (folder: string, depth: number): Promise<void> => {
      if (found.length >= limit) return;
      const entries = await readdir(folder, { withFileTypes: true }).catch(() => []);
      if (entries.some((entry) => entry.name === '.git')) {
        found.push(folder);
        if (depth > 0) return;
      }
      if (depth >= maxDepth) return;
      for (const entry of entries) {
        if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
          await walk(path.join(folder, entry.name), depth + 1);
        }
      }
    };
    for (const root of this.localRoots) {
      const resolved = await realpath(root).catch(() => undefined);
      if (resolved) await walk(resolved, 0);
    }
    return [...new Set(found)].sort((a, b) => a.localeCompare(b));
  }

  /** Resolves a remote URL or a local folder; local folders must be inside an allowed root. */
  async resolveSource(raw: string, token?: string): Promise<Source> {
    const value = raw.trim();
    if (!isLocalPath(value)) return { url: checkRepositoryUrl(value, token), protocols: 'https:ssh', local: false };
    if (!this.localRoots.length) {
      throw new RepositoryError(400, 'Local folders are disabled. Set LOCAL_REPOSITORY_ROOTS on the server to enable them.');
    }
    if (token) throw new RepositoryError(400, 'Access tokens are not used for local folders');
    let folder: string;
    try {
      // realpath resolves symlinks and "..", so the root check cannot be bypassed.
      folder = await realpath(value.startsWith('file://') ? fileURLToPath(value) : value);
    } catch {
      throw new RepositoryError(400, `Local folder not found: ${value}`);
    }
    const roots = await Promise.all(this.localRoots.map((root) => realpath(root).catch(() => undefined)));
    if (!roots.some((root) => root && isInside(root, folder))) {
      throw new RepositoryError(403, `Local folders must be inside: ${this.localRoots.join(', ')}`);
    }
    return { url: folder, protocols: 'file', local: true };
  }

  /** Workspace folder names by project ID. Projects cloned before slugged names existed use their ID. */
  private folders = new Map<string, string>();

  pathFor(projectId: string) {
    if (!PROJECT_ID.test(projectId)) throw new RepositoryError(400, 'Invalid project ID for a workspace');
    return path.join(this.root, this.folders.get(projectId) ?? projectId);
  }

  private async markerOf(folder: string) {
    const id = (await readFile(path.join(this.root, folder, '.git', PROJECT_MARKER), 'utf8').catch(() => '')).trim();
    return PROJECT_ID.test(id) ? id : undefined;
  }

  /** Rebuilds the project-to-folder map from the marker each workspace carries. Call once at startup. */
  async init() {
    const entries = await readdir(this.root).catch(() => [] as string[]);
    for (const entry of entries) {
      if (entry.startsWith('.clone-')) continue;
      const id = await this.markerOf(entry);
      if (id) this.folders.set(id, entry);
    }
  }

  private async folderFor(projectId: string, name?: string) {
    const slug = slugify(name ?? '');
    if (!slug) return projectId;
    const taken = new Set(this.folders.values());
    const free = async (folder: string) => !taken.has(folder) && !(await lstat(path.join(this.root, folder)).then(() => true, () => false));
    return (await free(slug)) ? slug : `${slug}-${projectId.slice(0, 8)}`;
  }

  async branches(input: Pick<RepositoryInput, 'url' | 'token'>): Promise<RemoteBranches> {
    const { url, protocols } = await this.resolveSource(input.url, input.token);
    const output = await this.git(['ls-remote', '--symref', '--', url, 'HEAD', 'refs/heads/*'], {
      token: input.token, url, protocols, timeout: 60_000,
    });
    const branches: string[] = [];
    let defaultBranch: string | undefined;
    for (const line of output.split('\n')) {
      const symref = /^ref: refs\/heads\/(.+)\tHEAD$/.exec(line);
      if (symref) defaultBranch = symref[1];
      const head = /^[0-9a-f]+\trefs\/heads\/(.+)$/.exec(line);
      if (head) branches.push(head[1]);
    }
    return { defaultBranch, branches: branches.sort() };
  }

  /** Clones into a temporary folder, then moves it into the project's workspace. */
  async clone(projectId: string, input: RepositoryInput, name?: string): Promise<ClonedRepository> {
    const { url, protocols, local } = await this.resolveSource(input.url, input.token);
    const branch = input.branch ? checkBranch(input.branch) : undefined;
    if (!PROJECT_ID.test(projectId)) throw new RepositoryError(400, 'Invalid project ID for a workspace');
    if (this.folders.has(projectId)) throw new RepositoryError(409, 'A workspace already exists for this project');
    await mkdir(this.root, { recursive: true });
    const folder = await this.folderFor(projectId, name);
    const target = path.join(this.root, folder);
    const temporary = path.join(this.root, `.clone-${randomUUID()}`);
    await mkdir(this.root, { recursive: true });
    try {
      // --no-local copies objects instead of hard-linking them, so the source folder is never shared.
      await this.git([
        'clone', ...(local ? ['--no-local'] : []), ...(branch ? ['--branch', branch] : []), '--', url, temporary,
      ], { token: input.token, url, protocols });
      const checkedOut = (await this.git(['symbolic-ref', '--short', 'HEAD'], { cwd: temporary })).trim();
      // An empty repository has a branch but no commit yet.
      const commit = (await this.git(['rev-parse', '--verify', '--quiet', 'HEAD'], { cwd: temporary }).catch(() => '')).trim() || undefined;
      await writeFile(path.join(temporary, '.git', PROJECT_MARKER), `${projectId}\n`);
      await rename(temporary, target).catch((error: NodeJS.ErrnoException) => {
        throw error.code === 'ENOTEMPTY' || error.code === 'EEXIST'
          ? new RepositoryError(409, 'A workspace already exists for this project') : error;
      });
      this.folders.set(projectId, folder);
      return { url, branch: checkedOut, commit };
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }

  /** Folder of the project's clone; throws 404 when the project has none. */
  async clonePath(projectId: string) {
    const folder = this.pathFor(projectId);
    const isRepository = await readdir(folder).then((entries) => entries.includes('.git'), () => false);
    if (!isRepository) throw new RepositoryError(404, 'No cloned repository for this project');
    return folder;
  }

  /** Branches available offline in the clone: local branches plus those fetched from origin. */
  async workspaceBranches(projectId: string): Promise<WorkspaceBranches> {
    const cwd = await this.clonePath(projectId);
    const current = (await this.git(['symbolic-ref', '--short', 'HEAD'], { cwd })).trim();
    const refs = await this.git(['for-each-ref', '--format=%(refname)', 'refs/heads', 'refs/remotes/origin'], { cwd });
    const branches = new Set<string>();
    for (const ref of refs.split('\n')) {
      const name = /^refs\/(?:heads|remotes\/origin)\/(.+)$/.exec(ref)?.[1];
      if (name && name !== 'HEAD') branches.add(name);
    }
    return { current, branches: [...branches].sort() };
  }

  async inventory(projectId: string) {
    const cwd = await this.clonePath(projectId);
    const output = await this.git(['worktree', 'list', '--porcelain', '-z'], { cwd });
    const worktrees: {
      path: string; head: string | null; branch: string | null; main: boolean;
      bare: boolean; detached: boolean; locked: string | null; prunable: string | null;
    }[] = [];
    for (const record of output.split('\0\0').filter(Boolean)) {
      const fields = record.split('\0');
      const location = fields.find((field) => field.startsWith('worktree '))?.slice(9);
      if (!location) throw new RepositoryError(422, 'Git returned an invalid worktree inventory');
      const value = (key: string) => {
        const field = fields.find((item) => item === key || item.startsWith(`${key} `));
        return field === undefined ? null : field === key ? '' : field.slice(key.length + 1);
      };
      const head = value('HEAD');
      worktrees.push({
        path: location, head: head && !/^0+$/.test(head) ? head : null,
        branch: value('branch')?.replace(/^refs\/heads\//, '') ?? null,
        main: worktrees.length === 0, bare: fields.includes('bare'), detached: fields.includes('detached'),
        locked: value('locked'), prunable: value('prunable'),
      });
    }
    if (!worktrees.length) throw new RepositoryError(422, 'Git returned no worktrees for this project');
    return { branch: worktrees[0].branch, head: worktrees[0].head, worktrees };
  }

  /** Checks out another branch of the clone. Refuses when the workspace has uncommitted changes. */
  async switchBranch(projectId: string, branch: string, persist?: (result: SwitchedBranch) => Promise<unknown>): Promise<SwitchedBranch> {
    checkBranch(branch);
    return this.withProjectLock(projectId, async () => {
      const cwd = await this.clonePath(projectId);
      const { current, branches } = await this.workspaceBranches(projectId);
      if (!branches.includes(branch)) throw new RepositoryError(404, `Branch not found in the clone: ${branch}`);
      if ((await this.git(['status', '--porcelain'], { cwd })).trim()) {
        throw new RepositoryError(409, 'The workspace has uncommitted changes; commit or discard them before switching branch');
      }
      await this.git(['switch', '--guess', branch], { cwd });
      const commit = (await this.git(['rev-parse', '--verify', '--quiet', 'HEAD'], { cwd }).catch(() => '')).trim() || undefined;
      const result = { branch, commit, previous: current };
      if (persist) {
        try { await persist(result); }
        catch (error) {
          await this.git(['switch', '--', current], { cwd })
            .catch((cause: unknown) => console.error(`Unable to restore branch of ${projectId}:`, cause));
          throw error;
        }
      }
      return result;
    });
  }

  async withProjectLock<T>(projectId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(projectId) ?? Promise.resolve();
    const run = previous.then(operation);
    const settled = run.then(() => undefined, () => undefined);
    this.locks.set(projectId, settled);
    void settled.then(() => { if (this.locks.get(projectId) === settled) this.locks.delete(projectId); });
    return run;
  }

  /** Clone folder of a project, plus the branch currently checked out; used for tracked documentation edits. */
  async docsWorkspace(projectId: string) {
    const cwd = await this.clonePath(projectId);
    const branch = (await this.git(['symbolic-ref', '--short', 'HEAD'], { cwd }).catch(() => '')).trim();
    return { cwd, branch: branch || null };
  }

  async remove(projectId: string) {
    await rm(this.pathFor(projectId), { recursive: true, force: true });
    this.folders.delete(projectId);
  }

  /** Finds a ticket's worktree through its kanban/<session> branch, so the folder name can be the task slug. */
  async ticketDir(root: string, sessionId: string) {
    const base = path.join(root, '.git', 'kanban-worktrees');
    const output = await this.git(['worktree', 'list', '--porcelain', '-z'], { cwd: root }).catch(() => '');
    const realBase = await realpath(base).catch(() => base);
    for (const record of output.split('\0\0').filter(Boolean)) {
      const fields = record.split('\0');
      const location = fields.find((field) => field.startsWith('worktree '))?.slice(9);
      if (location && fields.includes(`branch refs/heads/kanban/${sessionId}`) && [base, realBase].includes(path.dirname(location))) return location;
    }
    return path.join(base, sessionId);
  }

  private async newTicketDir(root: string, sessionId: string, name?: string) {
    const base = path.join(root, '.git', 'kanban-worktrees');
    const slug = slugify(name ?? '');
    if (!slug) return path.join(base, sessionId);
    const taken = await lstat(path.join(base, slug)).then(() => true, () => false);
    return path.join(base, taken ? `${slug}-${sessionId.slice(0, 8)}` : slug);
  }

  async ticketWorkspace(projectId: string, sessionId: string, branch: string, name?: string) {
    if (!/^[\w-]+$/.test(sessionId)) throw new RepositoryError(400, 'Invalid session ID');
    const cwd = await this.clonePath(projectId);
    checkBranch(branch);
    const baseCommit = (await this.git(['rev-parse', '--verify', `refs/heads/${branch}^{commit}`], { cwd })).trim();
    const ticketBranch = `kanban/${sessionId}`;
    const known = await this.ticketDir(cwd, sessionId);
    const existing = await readdir(known).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return undefined;
      throw error;
    });
    // Recover a worktree created immediately before an interrupted database update.
    const workspace = existing ? known : await this.newTicketDir(cwd, sessionId, name);
    if (existing) {
      const common = (await this.git(['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: workspace })).trim();
      const current = (await this.git(['symbolic-ref', '--short', 'HEAD'], { cwd: workspace })).trim();
      if (await realpath(common) !== await realpath(path.join(cwd, '.git')) || current !== ticketBranch) {
        throw new RepositoryError(409, 'The existing ticket worktree does not match this session');
      }
      const commit = (await this.git(['rev-parse', '--verify', 'HEAD'], { cwd: workspace })).trim();
      return { workspace, branch: ticketBranch, baseCommit: commit };
    }
    const refs = (await this.git(['for-each-ref', '--format=%(refname)', `refs/heads/${ticketBranch}`], { cwd })).trim().split('\n');
    await this.git(refs.includes(`refs/heads/${ticketBranch}`)
      ? ['worktree', 'add', workspace, ticketBranch]
      : ['worktree', 'add', '-b', ticketBranch, workspace, baseCommit], { cwd });
    return { workspace, branch: ticketBranch, baseCommit };
  }

  /** Removes a ticket worktree; callers first check that it holds nothing to keep. */
  async removeTicketWorktree(projectId: string, sessionId: string) {
    const root = await this.clonePath(projectId);
    await this.git(['worktree', 'remove', await this.ticketDir(root, sessionId)], { cwd: root });
  }

  async health(projectId: string) {
    const cwd = await this.clonePath(projectId);
    const branch = (await this.git(['symbolic-ref', '--short', 'HEAD'], { cwd })).trim();
    const commit = (await this.git(['rev-parse', '--verify', '--quiet', 'HEAD'], { cwd })).trim();
    let scripts: string[] = [];
    try {
      const manifest: unknown = JSON.parse(await readFile(path.join(cwd, 'package.json'), 'utf8'));
      if (manifest && typeof manifest === 'object' && 'scripts' in manifest && manifest.scripts && typeof manifest.scripts === 'object') {
        scripts = Object.keys(manifest.scripts);
      }
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    }
    return { branch, commit, scripts };
  }

  /** Removes workspaces of projects that no longer exist (in-progress clones are kept). */
  async removeAllExcept(projectIds: string[]) {
    const keep = new Set(projectIds);
    const entries = await readdir(this.root).catch(() => [] as string[]);
    const stale: string[] = [];
    for (const entry of entries) {
      if (entry.startsWith('.clone-')) continue;
      if (!keep.has((await this.markerOf(entry)) ?? entry)) stale.push(entry);
    }
    await Promise.all(stale.map((entry) => rm(path.join(this.root, entry), { recursive: true, force: true })));
    for (const [id, folder] of this.folders) if (stale.includes(folder)) this.folders.delete(id);
  }
}
