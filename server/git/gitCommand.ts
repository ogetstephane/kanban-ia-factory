// Shared by the git services: the command runner, the error it throws and input validators.
import { execFile } from 'node:child_process';
import path from 'node:path';

export function slugify(value: string) {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48).replace(/-+$/, '');
}

export class RepositoryError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

const SCP_LIKE = /^[\w.-]+@[\w.-]+:[^\s]+$/;
const BRANCH = /^(?!-)(?!.*\.\.)(?!.*\/\/)(?!.*@\{)[\w./-]+(?<![./]|\.lock)$/;
export const PROJECT_ID = /^[\w-]+$/;
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

export const isInside = (parent: string, child: string) => {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
};

export interface GitOptions { token?: string; url?: string; cwd?: string; timeout?: number; protocols?: string; indexFile?: string }
export type Git = (args: string[], options?: GitOptions) => Promise<string>;

/** Runs git without prompts; `timeoutMs` applies to commands that set no timeout of their own. */
export function createGit(timeoutMs = 600_000): Git {
  return (args, options = {}) => {
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
    const timeout = options.timeout ?? timeoutMs;
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
  };
}
