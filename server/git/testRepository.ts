import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, {
  cwd, stdio: 'pipe', encoding: 'utf8',
  env: { ...process.env, GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 't@example.com' },
}).trim();

/** Creates a local repository with `main` (default) and `dev` branches; returns its path as `url`. */
export async function createSourceRepository(directory: string) {
  await mkdir(directory, { recursive: true });
  git(directory, 'init', '--initial-branch=main');
  await writeFile(path.join(directory, 'README.md'), '# main\n');
  git(directory, 'add', '.');
  git(directory, 'commit', '-m', 'main');
  git(directory, 'checkout', '-b', 'dev');
  await writeFile(path.join(directory, 'DEV.md'), '# dev\n');
  git(directory, 'add', '.');
  git(directory, 'commit', '-m', 'dev');
  const devCommit = git(directory, 'rev-parse', 'HEAD');
  git(directory, 'checkout', 'main');
  return { url: directory, devCommit };
}
