import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readdir, realpath, rename, rm, lstat, readFile, readlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { RepositoryInput } from '../../src/types/board';

function slugify(value: string) {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48).replace(/-+$/, '');
}

export class RepositoryError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export interface ClonedRepository { url: string; branch: string; commit?: string }
export interface RemoteBranches { defaultBranch?: string; branches: string[] }
export interface WorkspaceBranches { current: string; branches: string[] }
export interface SwitchedBranch { branch: string; commit?: string; previous: string }

const SCP_LIKE = /^[\w.-]+@[\w.-]+:[^\s]+$/;
const BRANCH = /^(?!-)(?!.*\.\.)(?!.*\/\/)(?!.*@\{)[\w./-]+(?<![./]|\.lock)$/;
const PROJECT_ID = /^[\w-]+$/;
const PROJECT_MARKER = 'kanban-project-id';
const TOKEN_SSH = 'Access tokens only work with HTTPS URLs. SSH URLs use the server\'s SSH keys.';

export function checkRepositoryUrl(raw: string, token?: string) {
  const url = raw.trim();
  if (!url || url.startsWith('-') || /\s/.test(url)) throw new RepositoryError(400, 'Invalid repository URL');
  if (SCP_LIKE.test(url)) {
    if (token) throw new RepositoryError(400, TOKEN_SSH);
    return url;
  }
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new RepositoryError(400, 'Invalid repository URL'); }
  if (!['https:', 'ssh:'].includes(parsed.protocol)) {
    throw new RepositoryError(400, 'Only https://, ssh:// and git@host:path repository URLs are supported');
  }
  if (parsed.password) throw new RepositoryError(400, 'Do not put credentials in the URL; use the access token field instead');
  if (token && parsed.protocol !== 'https:') throw new RepositoryError(400, TOKEN_SSH);
  return url;
}

export function checkBranch(branch: string) {
  if (!BRANCH.test(branch)) throw new RepositoryError(400, `Invalid branch name: ${branch}`);
  return branch;
}

const isLocalPath = (value: string) => value.startsWith('/') || value.startsWith('file://');
const isInside = (parent: string, child: string) => {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
};

interface Source { url: string; protocols: string; local: boolean }

export class RepositoryService {
  private readonly locks = new Map<string, Promise<void>>();

  constructor(
    readonly root: string,
    private readonly options: { localRoots?: string[]; timeoutMs?: number } = {},
  ) {}

  get localRoots() { return this.options.localRoots ?? []; }

  /** Lists git folders under the allowed roots (symlinks, hidden folders and node_modules are skipped). */
  async localRepositories(maxDepth = 3, limit = 200): Promise<string[]> {
    const found: string[] = [];
    const walk = async (folder: string, depth: number): Promise<void> => {
      if (found.length >= limit) return;
      const entries = await readdir(folder, { withFileTypes: true }).catch(() => []);
      if (entries.some((entry) => entry.name === '.git')) {
        found.push(folder);
        return;
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
  private async resolveSource(raw: string, token?: string): Promise<Source> {
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

  private git(args: string[], options: { token?: string; url?: string; cwd?: string; timeout?: number; protocols?: string; indexFile?: string } = {}) {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      GIT_TERMINAL_PROMPT: '0',
      LC_ALL: 'C',
      GIT_ALLOW_PROTOCOL: options.protocols ?? 'https:ssh',
      GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND ?? 'ssh -o BatchMode=yes',
    };
    if (options.indexFile) env.GIT_INDEX_FILE = options.indexFile;
    if (options.token && options.url) {
      // Scope the header to the repository origin and keep it out of argv and .git/config.
      const basic = Buffer.from(`x-access-token:${options.token}`).toString('base64');
      Object.assign(env, {
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: `http.${new URL(options.url).origin}/.extraHeader`,
        GIT_CONFIG_VALUE_0: `Authorization: Basic ${basic}`,
      });
    }
    const timeout = options.timeout ?? this.options.timeoutMs ?? 600_000;
    return new Promise<string>((resolve, reject) => {
      execFile('git', args, { env, cwd: options.cwd, timeout, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
        if (!error) return resolve(stdout);
        if (error.killed) return reject(new RepositoryError(504, 'Git operation timed out'));
        if (/terminal prompts disabled|Authentication failed|Permission denied \(publickey|could not read (Username|Password)/i.test(stderr)) {
          return reject(new RepositoryError(422, 'Git authentication failed: check the access token, or the server\'s SSH keys / git credentials'));
        }
        const detail = stderr.trim().split('\n').filter(Boolean).pop() ?? error.message;
        reject(new RepositoryError(422, `Git failed: ${detail.replace(/^fatal:\s*/, '')}`));
      });
    });
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

  private async workspace(projectId: string) {
    const folder = this.pathFor(projectId);
    const isRepository = await readdir(folder).then((entries) => entries.includes('.git'), () => false);
    if (!isRepository) throw new RepositoryError(404, 'No cloned repository for this project');
    return folder;
  }

  /** Branches available offline in the clone: local branches plus those fetched from origin. */
  async workspaceBranches(projectId: string): Promise<WorkspaceBranches> {
    const cwd = await this.workspace(projectId);
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
    const cwd = await this.workspace(projectId);
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
      const cwd = await this.workspace(projectId);
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
    const cwd = await this.workspace(projectId);
    const branch = (await this.git(['symbolic-ref', '--short', 'HEAD'], { cwd }).catch(() => '')).trim();
    return { cwd, branch: branch || null };
  }

  /** Throws unless a documentation file can be committed on the checked-out branch right now. */
  async assertDocsCommittable(projectId: string) {
    const { cwd, branch } = await this.docsWorkspace(projectId);
    if (!branch) throw new RepositoryError(409, 'The project clone is on a detached HEAD; switch to a branch before editing documentation');
    await this.noGitOperation(cwd);
    await this.deliveryIdentity(projectId);
    return { cwd, branch };
  }

  /** Uncommitted changes under the docs folder, and commits not yet on origin (null when origin/<branch> is unknown). */
  async docsChanges(projectId: string, docsPath: string) {
    const cwd = await this.workspace(projectId);
    const output = await this.git(['--literal-pathspecs', 'status', '--porcelain=v1', '-z', '--no-renames', '--untracked-files=all', '--', docsPath], { cwd });
    const changes: { path: string; status: 'added' | 'modified' | 'deleted' }[] = [];
    for (const entry of output.split('\0').filter(Boolean)) {
      const code = entry.slice(0, 2);
      changes.push({ path: entry.slice(3), status: code.includes('?') || code.includes('A') ? 'added' : code.includes('D') ? 'deleted' : 'modified' });
    }
    const { branch } = await this.docsWorkspace(projectId);
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
    const cwd = await this.workspace(projectId);
    const literal = ['--literal-pathspecs'];
    await this.git([...literal, 'add', '-A', '--', ...files], { cwd });
    const staged = await this.git([...literal, 'diff', '--cached', '--name-only', '--', ...files], { cwd });
    if (!staged.trim()) return null;
    await this.git([...literal, '-c', 'commit.gpgsign=false', 'commit', '--no-verify', '--only', '-m', message, '--', ...files], { cwd });
    return (await this.git(['rev-parse', '--verify', 'HEAD'], { cwd })).trim();
  }

  async unstageDocs(projectId: string, files: string[]) {
    const cwd = await this.workspace(projectId);
    await this.git(['--literal-pathspecs', 'reset', '--quiet', '--', ...files], { cwd }).catch(() => undefined);
  }

  /** Pushes the checked-out branch to a remote origin without forcing. Failures never undo the local commit. */
  async pushCheckedOutBranch(projectId: string): Promise<{ pushed: boolean; reason?: string }> {
    const { cwd, branch } = await this.docsWorkspace(projectId);
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

  async remove(projectId: string) {
    await rm(this.pathFor(projectId), { recursive: true, force: true });
    this.folders.delete(projectId);
  }

  /** Finds a ticket's worktree through its kanban/<session> branch, so the folder name can be the task slug. */
  private async ticketDir(root: string, sessionId: string) {
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
    const cwd = await this.workspace(projectId);
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
    const root = await this.workspace(projectId);
    const cwd = await this.ticketDir(root, sessionId);
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

  private async noGitOperation(cwd: string) {
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
    const root = await this.workspace(projectId);
    const workspace = await this.ticketDir(root, sessionId);
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
    const cwd = await this.workspace(projectId);
    try {
      await this.git(['var', 'GIT_AUTHOR_IDENT'], { cwd });
      await this.git(['var', 'GIT_COMMITTER_IDENT'], { cwd });
    } catch (error) {
      if (!(error instanceof RepositoryError)) throw error;
      throw new RepositoryError(422, `Configure git user.name and user.email for the server user or project clone before committing. ${error.message}`);
    }
  }

  featureBranch(title: string) { return `feature/${slugify(title) || 'untitled'}`; }

  async pinReviewCommit(projectId: string, publicationId: string, commit: string) {
    if (!PROJECT_ID.test(publicationId) || !/^[a-f0-9]{40,64}$/.test(commit)) throw new RepositoryError(400, 'Invalid review commit');
    await this.git(['update-ref', `refs/kanban/reviews/${publicationId}`, commit], { cwd: await this.workspace(projectId) });
  }

  async publicationOrigin(projectId: string) {
    const cwd = await this.workspace(projectId);
    const urls = (await this.git(['remote', 'get-url', '--push', '--all', 'origin'], { cwd })).trim().split('\n');
    if (urls.length !== 1) throw new RepositoryError(409, 'Review publication requires exactly one origin push URL');
    return (await this.resolveSource(urls[0])).url;
  }

  private async originRef(projectId: string, branch: string, origin: string, fetch = false) {
    checkBranch(branch);
    if (await this.publicationOrigin(projectId) !== origin) throw new RepositoryError(409, 'Origin changed. Restore it before retrying Finish.');
    const cwd = await this.workspace(projectId);
    const { url, protocols } = await this.resolveSource(origin);
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
    const cwd = await this.workspace(projectId);
    const inventory = await this.inventory(projectId);
    const remote = await this.resolveSource(origin);
    const symref = await this.git(['ls-remote', '--symref', '--', remote.url, 'HEAD'], { cwd, protocols: remote.protocols, timeout: 60_000 });
    if (symref.split('\n').includes(`ref: refs/heads/${branch}\tHEAD`)) throw new RepositoryError(409, 'Finish cannot close the origin default branch');
    if (inventory.worktrees.some((tree) => tree.branch === branch)) throw new RepositoryError(409, 'The feature branch is checked out in a worktree. Remove it safely before Finish.');
    const current = (await this.git(['symbolic-ref', '--short', 'HEAD'], { cwd })).trim();
    if (current !== targetBranch) throw new RepositoryError(409, `Switch the project clone to ${targetBranch} before Finish`);
    await this.noGitOperation(cwd);
    if ((await this.git(['status', '--porcelain', '--untracked-files=all'], { cwd })).trim()) throw new RepositoryError(409, 'The project clone must be clean before Finish');
    const targetHead = (await this.git(['rev-parse', 'HEAD'], { cwd })).trim();
    const remoteTarget = await this.originRef(projectId, targetBranch, origin, true);
    if (remoteTarget && !await this.containsDeliveryMerge(projectId, remoteTarget, targetHead)) {
      throw new RepositoryError(409, 'The project branch is behind or diverged from origin. Synchronize it locally before Finish.');
    }
    return { targetHead, featureHead: await this.originRef(projectId, branch, origin, true) };
  }

  async pushFinishedProject(projectId: string, branch: string, commit: string, origin: string) {
    const cwd = await this.workspace(projectId);
    await this.originRef(projectId, branch, origin);
    const { url, protocols } = await this.resolveSource(origin);
    await this.git(['-c', 'push.followTags=false', '-c', 'push.recurseSubmodules=no', 'push',
      '--porcelain', '--no-verify', '--no-follow-tags', '--', url, `${commit}:refs/heads/${branch}`], { cwd, protocols, timeout: 60_000 });
    const remote = await this.originRef(projectId, branch, origin, true);
    if (!remote || !await this.containsDeliveryMerge(projectId, commit, remote)) throw new RepositoryError(409, 'The pushed project commit could not be verified on origin');
  }

  async closeFinishedBranch(projectId: string, branch: string, featureHead: string, targetBranch: string, merge: string, origin: string) {
    if (!branch.startsWith('feature/') || branch === targetBranch) throw new RepositoryError(409, 'Invalid feature branch for closure');
    const cwd = await this.workspace(projectId);
    const target = await this.originRef(projectId, targetBranch, origin, true);
    if (!target || !await this.containsDeliveryMerge(projectId, merge, target)) throw new RepositoryError(409, 'Origin project branch no longer contains the finished merge');
    const remote = await this.originRef(projectId, branch, origin);
    if (remote && remote !== featureHead) throw new RepositoryError(409, 'The feature branch changed after Finish started. It was not deleted; inspect it locally.');
    const { url, protocols } = await this.resolveSource(origin);
    const ref = `refs/heads/${branch}`;
    const symref = await this.git(['ls-remote', '--symref', '--', url, 'HEAD'], { cwd, protocols, timeout: 60_000 });
    if (symref.split('\n').includes(`ref: ${ref}\tHEAD`)) throw new RepositoryError(409, 'Finish cannot close the origin default branch');
    if (remote) {
      // Conditional deletion protects commits pushed concurrently, unlike an unconditional --delete.
      await this.git(['-c', 'push.followTags=false', '-c', 'push.recurseSubmodules=no', 'push', '--no-verify',
        `--force-with-lease=${ref}:${featureHead}`, '--', url, `:${ref}`], { cwd, protocols, timeout: 60_000 });
    }
    if (await this.originRef(projectId, branch, origin)) throw new RepositoryError(409, 'Origin feature branch deletion could not be verified');
    if ((await this.inventory(projectId)).worktrees.some((tree) => tree.branch === branch)) throw new RepositoryError(409, 'Feature branch is checked out; local deletion blocked');
    const refs = (await this.git(['for-each-ref', '--format=%(objectname)', ref], { cwd })).trim();
    if (refs) {
      if (!await this.containsDeliveryMerge(projectId, refs, merge)) throw new RepositoryError(409, 'Local feature branch contains unmerged changes and was preserved');
      await this.git(['update-ref', '-d', ref, refs], { cwd });
    }
    const tracking = `refs/remotes/origin/${branch}`;
    const tracked = (await this.git(['for-each-ref', '--format=%(objectname)', tracking], { cwd })).trim();
    if (tracked === featureHead) await this.git(['update-ref', '-d', tracking, tracked], { cwd });
  }

  async pushReviewCommit(projectId: string, branch: string, commit: string, expectedOrigin: string) {
    checkBranch(branch);
    if (!branch.startsWith('feature/')) throw new RepositoryError(409, 'Review publication can only push a feature/ branch');
    const cwd = await this.workspace(projectId);
    if (await this.publicationOrigin(projectId) !== expectedOrigin) throw new RepositoryError(409, 'Origin changed since review publication started');
    const { url, protocols } = await this.resolveSource(expectedOrigin);
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
      if (await this.containsDeliveryMerge(projectId, commit, existing)) return existing;
      if (!await this.containsDeliveryMerge(projectId, existing, commit)) {
        head = await this.prepareDeliveryMerge(projectId, existing, commit, `review-${commit.slice(0, 12)}`);
      }
    }
    await this.git(['-c', 'push.followTags=false', '-c', 'push.recurseSubmodules=no', 'push',
      '--porcelain', '--no-verify', '--no-follow-tags', '--', url, `${head}:${ref}`], { cwd, protocols, timeout: 60_000 });
    const verified = await remoteHead();
    if (!verified) throw new RepositoryError(409, 'The remote feature branch could not be verified');
    if (verified !== head) {
      await this.git(['fetch', '--no-tags', '--', url, ref], { cwd, protocols, timeout: 60_000 });
      if (!await this.containsDeliveryMerge(projectId, head, verified)) throw new RepositoryError(409, 'The remote feature branch changed; retry publication');
    }
    return verified;
  }

  async createTicketCommit(projectId: string, sessionId: string, tree: string, parent: string, message: string, deliveryId: string) {
    const cwd = await this.ticketDir(await this.workspace(projectId), sessionId);
    return (await this.git(['-c', 'commit.gpgsign=false', 'commit-tree', tree, '-p', parent, '-m',
      `${message}\n\nKanban-Delivery: ${deliveryId}\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`], { cwd })).trim();
  }

  async applyTicketCommit(projectId: string, sessionId: string, commit: string, parent: string) {
    const cwd = await this.ticketDir(await this.workspace(projectId), sessionId);
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
    const cwd = await this.workspace(projectId);
    return (await this.git(['merge-base', merge, head], { cwd })).trim() === merge;
  }

  async releaseTarget(projectId: string, branch: string) {
    checkBranch(branch);
    const cwd = await this.workspace(projectId);
    const current = (await this.git(['symbolic-ref', '--short', 'HEAD'], { cwd })).trim();
    if (current !== branch) throw new RepositoryError(409, `Switch the project clone to ${branch} before publishing this release`);
    await this.noGitOperation(cwd);
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

  async releaseTag(projectId: string, tag: string) {
    const cwd = await this.workspace(projectId);
    await this.git(['check-ref-format', `refs/tags/${tag}`], { cwd });
    const output = await this.git(['for-each-ref', '--format=%(refname) %(objectname)', '--', `refs/tags/${tag}`], { cwd });
    return output.split('\n').map((line) => line.split(' ')).find(([ref]) => ref === `refs/tags/${tag}`)?.[1] ?? null;
  }

  async createReleaseTag(projectId: string, tag: string, commit: string) {
    const cwd = await this.workspace(projectId);
    const existing = await this.releaseTag(projectId, tag);
    if (existing) {
      if (existing !== commit) throw new RepositoryError(409, `Tag ${tag} already exists on a different object; it will never be overwritten`);
      return existing;
    }
    await this.git(['update-ref', `refs/tags/${tag}`, commit, '0'.repeat(commit.length)], { cwd });
    return commit;
  }

  async pushReleaseTag(projectId: string, tag: string, commit: string, remoteUrl: string) {
    checkRepositoryUrl(remoteUrl);
    const cwd = await this.workspace(projectId);
    const ref = `refs/tags/${tag}`;
    if (await this.releaseTag(projectId, tag) !== commit) throw new RepositoryError(409, 'The local release tag changed; publication was stopped');
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
    if (await this.releaseTag(projectId, tag) !== commit) throw new RepositoryError(409, 'The remote tag was pushed, but the local tag changed. Restore it to the saved release commit, then retry to reconcile.');
  }

  async prepareDeliveryMerge(projectId: string, targetHead: string, commit: string, deliveryId: string) {
    const cwd = await this.workspace(projectId);
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
    const cwd = await this.workspace(projectId);
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

  async health(projectId: string) {
    const cwd = await this.workspace(projectId);
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

  async cleanupTicket(projectId: string, sessionId: string, baseCommit: string) {
    const review = await this.ticketReview(projectId, sessionId, baseCommit);
    if (review.files.length) throw new RepositoryError(409, 'This worktree contains ticket changes. Keep or integrate them locally before cleanup; no changes will be discarded.');
    const root = await this.workspace(projectId);
    await this.git(['worktree', 'remove', await this.ticketDir(root, sessionId)], { cwd: root });
  }

  async cleanupPublishedTicket(projectId: string, sessionId: string, baseCommit: string, token: string, commit: string, parent: string) {
    if (!PROJECT_ID.test(sessionId)) throw new RepositoryError(400, 'Invalid session ID');
    const root = await this.workspace(projectId);
    const listing = await this.git(['worktree', 'list', '--porcelain', '-z'], { cwd: root });
    if (!listing.split('\0').includes(`branch refs/heads/kanban/${sessionId}`)) return;
    const cwd = await this.ticketDir(root, sessionId);
    await this.noGitOperation(cwd);
    if ((await this.ticketReview(projectId, sessionId, baseCommit)).token !== token) {
      throw new RepositoryError(409, 'Worktree changed after publication. Local changes were preserved; inspect them before retrying cleanup.');
    }
    if ((await this.git(['ls-files', '--others', '--ignored', '--exclude-standard'], { cwd })).trim()) {
      throw new RepositoryError(409, 'Worktree contains ignored files. Remove or preserve them locally before retrying cleanup.');
    }
    // Make the reviewed snapshot clean without discarding staged or later local changes.
    await this.applyTicketCommit(projectId, sessionId, commit, parent);
    await this.git(['worktree', 'remove', cwd], { cwd: root });
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
