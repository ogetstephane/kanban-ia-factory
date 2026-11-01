import { execFile } from 'node:child_process';
import { lstat, mkdir, readFile, readdir, realpath, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

const hidden = (name: string) => name.startsWith('.') || name === 'node_modules';
const MAX_FILE_SIZE = 128_000;
const MAX_RANGE_FILE_SIZE = 2_000_000;
const MAX_RANGE_LINES = 500;
const MAX_RANGE_OUTPUT_SIZE = 128_000;
const MAX_SEARCH_RESULTS = 100;
const MAX_SEARCH_FILES = 500;
const MAX_SEARCH_FILE_SIZE = 2_000_000;
const MAX_SEARCH_BYTES = 20_000_000;

/** Custom tools keep file operations in the worktree and expose no general-purpose shell. */
export class WorkspaceTools {
  constructor(private readonly root: string, private readonly signal?: AbortSignal) {}

  private async resolve(relative: string, create = false): Promise<string> {
    this.signal?.throwIfAborted();
    const parts = relative.split(/[\\/]/);
    if (path.isAbsolute(relative) || parts.some((part) => part === '..' || hidden(part))) {
      throw new Error('Use a relative workspace path without hidden folders or node_modules');
    }
    const root = await realpath(this.root);
    const target = path.resolve(root, relative);
    const resolved = await realpath(create ? path.dirname(target) : target);
    if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) throw new Error('Path leaves the ticket worktree');
    if (path.relative(root, resolved).split(path.sep).some(hidden)) throw new Error('Hidden paths and node_modules are not accessible');
    if (create) {
      try {
        if ((await lstat(target)).isSymbolicLink()) throw new Error('Writing through a symlink is not allowed');
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
      }
    }
    return target;
  }

  async list(relative: string) {
    return (await readdir(await this.resolve(relative === '.' ? '' : relative), { withFileTypes: true }))
      .filter((entry) => !hidden(entry.name) && !entry.isSymbolicLink())
      .map((entry) => ({ name: entry.name, directory: entry.isDirectory() }));
  }

  async read(relative: string, startLine?: number, endLine?: number) {
    const file = await this.resolve(relative);
    const ranged = startLine !== undefined || endLine !== undefined;
    const info = await stat(file);
    if (!info.isFile()) throw new Error('Path is not a file');
    if (!ranged) {
      if (info.size > MAX_FILE_SIZE) throw new Error('File is too large; read a line range');
      return readFile(file, 'utf8');
    }
    if (info.size > MAX_RANGE_FILE_SIZE) throw new Error('File is too large to inspect safely');
    const first = startLine ?? 1;
    const last = endLine ?? first + MAX_RANGE_LINES - 1;
    if (!Number.isSafeInteger(first) || first < 1 || !Number.isSafeInteger(last) ||
        last < first || last - first + 1 > MAX_RANGE_LINES) {
      throw new Error(`Choose a valid range of at most ${MAX_RANGE_LINES} lines`);
    }
    const lines = (await readFile(file, 'utf8')).split(/\r?\n/);
    if (first > lines.length) throw new Error(`Start line ${first} is beyond the end of the file (${lines.length} lines)`);
    const result = lines.slice(first - 1, last).map((line, index) => `L${first + index}:${line}`).join('\n');
    return result.length > MAX_RANGE_OUTPUT_SIZE
      ? `${result.slice(0, MAX_RANGE_OUTPUT_SIZE)}\n[Range output truncated; request a smaller line range]`
      : result;
  }

  async search(relative: string, query: string) {
    if (!query.trim() || query.length > 200) throw new Error('Search text must contain 1 to 200 characters');
    const directory = await this.resolve(relative === '.' ? '' : relative);
    if (!(await stat(directory)).isDirectory()) throw new Error('Search path is not a directory');
    const matches: Array<{ path: string; line: number; text: string }> = [];
    let filesScanned = 0;
    let bytesScanned = 0;
    let skippedFiles = 0;
    let truncated = false;
    const needle = query.toLocaleLowerCase();
    const root = await realpath(this.root);

    const visit = async (folder: string, depth: number): Promise<void> => {
      if (depth > 12 || truncated) { truncated = true; return; }
      for (const entry of await readdir(folder, { withFileTypes: true })) {
        this.signal?.throwIfAborted();
        if (hidden(entry.name) || entry.isSymbolicLink()) continue;
        const file = path.join(folder, entry.name);
        if (entry.isDirectory()) {
          await visit(file, depth + 1);
          if (truncated) return;
          continue;
        }
        if (!entry.isFile()) continue;
        if (filesScanned >= MAX_SEARCH_FILES) { truncated = true; return; }
        filesScanned += 1;
        const info = await stat(file);
        if (info.size > MAX_SEARCH_FILE_SIZE) { skippedFiles += 1; continue; }
        if (bytesScanned + info.size > MAX_SEARCH_BYTES) { truncated = true; return; }
        bytesScanned += info.size;
        const content = await readFile(file);
        if (content.includes(0)) { skippedFiles += 1; continue; }
        const text = content.toString('utf8');
        const relativePath = path.relative(root, file).split(path.sep).join('/');
        for (const [index, line] of text.split(/\r?\n/).entries()) {
          if (!line.toLocaleLowerCase().includes(needle)) continue;
          matches.push({ path: relativePath, line: index + 1, text: line.slice(0, 1000) });
          if (matches.length >= MAX_SEARCH_RESULTS) { truncated = true; return; }
        }
      }
    };

    await visit(directory, 0);
    return { matches, filesScanned, bytesScanned, skippedFiles, truncated };
  }

  async write(relative: string, content: string) {
    if (Buffer.byteLength(content) > 256_000) throw new Error('File is too large');
    await writeFile(await this.resolve(relative, true), content, 'utf8');
    return 'File saved';
  }

  async directory(relative: string) {
    await mkdir(await this.resolve(relative, true));
    return 'Directory created';
  }

  async remove(relative: string) {
    await unlink(await this.resolve(relative));
    return 'File removed';
  }

  async test(script: 'test' | 'lint') {
    return new Promise<string>((resolve, reject) => {
      execFile('npm', ['run', script], {
        cwd: this.root, timeout: 120_000, maxBuffer: 256_000,
        signal: this.signal,
        env: { PATH: process.env.PATH, LANG: 'C.UTF-8', CI: 'true' },
      }, (error, stdout, stderr) => {
        if (error) reject(new Error(`npm run ${script} failed: ${stdout}\n${stderr}\n${error.message}`));
        else resolve(`${stdout}\n${stderr}`);
      });
    });
  }
}
