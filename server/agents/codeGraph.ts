import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { cp, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { RepositoryError } from '../git/repositoryService';

const MAX_REPORT_CHARS = 16_000;
const MAX_VIEW_REPORT_CHARS = 500_000;
const MAX_OUTPUT_CHARS = 30_000;
const BUILD_TIMEOUT_MS = 180_000;
const QUERY_TIMEOUT_MS = 30_000;
const VERSION_FILE = '.kanban-version';
// Keep dependencies and published graph outputs out of subsequent extractions.
const EXCLUDES = ['node_modules/', 'graphify-out/'];

export interface CodeGraphOptions {
  binary?: string;
  cacheDir?: string;
  enabled?: boolean;
}

export interface PreparedCodeGraph {
  /** GRAPH_REPORT.md without the placeholder navigation list, capped for prompts. */
  report: string;
  query(question: string, budget?: number): Promise<string>;
  explain(node: string): Promise<string>;
  path(from: string, to: string): Promise<string>;
  affected(node: string): Promise<string>;
  /** Removes this graph's files; call when the agent phase ends. */
  dispose(): Promise<void>;
}

export interface CodeGraphSnapshot {
  generatedAt: string;
  commit: string | null;
  report: string;
  visualization: boolean;
}

export function trimGraphReport(report: string, max = MAX_REPORT_CHARS) {
  const trimmed = report
    .replace(/^## Community Hubs \(Navigation\)\n[\s\S]*?(?=^## )/m, '')
    .replace(/^# Graph Report - .*$/m, '# Graph Report')
    .trim();
  return trimmed.length > max
    ? `${trimmed.slice(0, max)}\n[Graph report truncated; use the graph tools for details]`
    : trimmed;
}

function checkTerm(value: string) {
  const term = value.trim();
  if (!term || term.length > 200 || term.startsWith('-') || /[\u0000-\u001f]/.test(term)) {
    throw new Error('Graph terms must contain 1 to 200 printable characters and must not start with "-"');
  }
  return term;
}

const exists = (file: string) => stat(file).then(() => true, () => false);

interface EnsureOptions { visualization: boolean; rebuild: boolean; signal?: AbortSignal }

/**
 * Builds code-only Graphify knowledge graphs (local tree-sitter AST, no LLM) in a cache.
 * Project snapshots are also published in the main clone; ticket graphs stay external.
 */
export class CodeGraph {
  private readonly binary: string;
  private readonly cacheDir: string;
  readonly enabled: boolean;
  private readonly builds = new Map<string, Promise<void>>();

  constructor(options: CodeGraphOptions = {}) {
    this.binary = options.binary || 'graphify';
    this.cacheDir = options.cacheDir || path.join(tmpdir(), 'kanban-graphify');
    this.enabled = options.enabled ?? true;
  }

  static fromEnv(env = process.env) {
    return new CodeGraph({
      binary: env.GRAPHIFY_BIN,
      cacheDir: env.GRAPHIFY_CACHE_DIR ? path.resolve(env.GRAPHIFY_CACHE_DIR) : undefined,
      enabled: !['0', 'false', 'off', 'no'].includes((env.GRAPHIFY_ENABLED ?? '').trim().toLowerCase()),
    });
  }

  // API keys are deliberately not forwarded so Graphify can never fall back to an LLM backend.
  private run(command: string, args: string[], cwd: string, timeout: number, signal?: AbortSignal) {
    return new Promise<{ code: number; stdout: string; stderr: string }>((resolve, reject) => {
      execFile(command, args, {
        cwd, timeout, signal, maxBuffer: 4 * 1024 * 1024,
        env: { PATH: process.env.PATH, HOME: process.env.HOME, LANG: 'C.UTF-8', PYTHONIOENCODING: 'utf-8' },
      }, (error, stdout, stderr) => {
        const code = error ? (typeof error.code === 'number' ? error.code : -1) : 0;
        if (error && code === -1) reject(error);
        else resolve({ code, stdout, stderr });
      });
    });
  }

  private outputFor(workspace: string, visualization: boolean) {
    const key = `${path.resolve(workspace)}${visualization ? '\0view' : ''}`;
    return path.join(this.cacheDir, createHash('sha256').update(key).digest('hex').slice(0, 24));
  }

  private async commitOf(workspace: string) {
    const result = await this.run('git', ['rev-parse', 'HEAD'], workspace, QUERY_TIMEOUT_MS).catch(() => undefined);
    return result?.code === 0 ? result.stdout.trim() : null;
  }

  /** Builds into a staging folder, then swaps it in so readers never see a half-written graph. */
  private async build(workspace: string, output: string, visualization: boolean, signal?: AbortSignal) {
    await mkdir(this.cacheDir, { recursive: true, mode: 0o700 });
    const staging = `${output}.build-${randomUUID()}`;
    const trash = `${output}.old-${randomUUID()}`;
    try {
      await mkdir(staging, { mode: 0o700 });
      const commit = await this.commitOf(workspace);
      const extract = await this.run(this.binary, ['extract', workspace, '--code-only', '--force', ...EXCLUDES.flatMap((pattern) => ['--exclude', pattern]), '--out', staging], staging, BUILD_TIMEOUT_MS, signal);
      if (extract.code !== 0) throw new Error(`graphify extract failed (${extract.code}): ${extract.stderr || extract.stdout}`.slice(0, 2000));
      const cluster = await this.run(this.binary, ['cluster-only', staging, ...(visualization ? [] : ['--no-viz']), '--no-label'], staging, BUILD_TIMEOUT_MS, signal);
      if (cluster.code !== 0) throw new Error(`graphify cluster-only failed (${cluster.code}): ${cluster.stderr || cluster.stdout}`.slice(0, 2000));
      await writeFile(path.join(staging, VERSION_FILE), JSON.stringify({ commit, generatedAt: new Date().toISOString() }));
      await rename(output, trash).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; });
      await rename(staging, output);
    } finally {
      await Promise.all([rm(staging, { recursive: true, force: true }), rm(trash, { recursive: true, force: true })]);
    }
  }

  private async version(output: string) {
    try {
      const value = JSON.parse(await readFile(path.join(output, VERSION_FILE), 'utf8')) as { commit?: unknown; generatedAt?: unknown };
      return {
        commit: typeof value.commit === 'string' ? value.commit : null,
        generatedAt: typeof value.generatedAt === 'string' ? value.generatedAt : new Date(0).toISOString(),
      };
    } catch { return undefined; }
  }

  /** Throws a user-facing error when Graphify is disabled, missing or fails. */
  private async ensure(workspace: string, { visualization, rebuild, signal }: EnsureOptions) {
    if (!this.enabled) throw new RepositoryError(503, 'The code graph is disabled (GRAPHIFY_ENABLED=false).');
    // Concurrent drafts can inspect the same clone, but each run owns its graph.
    const output = `${this.outputFor(workspace, visualization)}${visualization ? '' : `-${randomUUID()}`}`;
    let build = this.builds.get(output);
    if (!build) {
      const stale = async () => {
        if (rebuild || !(await exists(path.join(output, 'graphify-out', 'GRAPH_REPORT.md')))) return true;
        const commit = await this.commitOf(workspace);
        return commit !== null && commit !== (await this.version(output))?.commit;
      };
      build = stale().then(async (needed) => {
        if (needed) await this.build(workspace, output, visualization, signal);
        if (visualization) {
          await cp(path.join(output, 'graphify-out'), path.join(workspace, 'graphify-out'), {
            recursive: true,
            filter: async (source, destination) => {
              if (!(await stat(source)).isFile()) return true;
              let current: Buffer;
              try { current = await readFile(destination); }
              catch (error) {
                if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true;
                throw error;
              }
              return !current.equals(await readFile(source));
            },
          });
        }
      })
        .finally(() => this.builds.delete(output));
      this.builds.set(output, build);
    }
    try { await build; }
    catch (error) {
      if (signal?.aborted) throw error;
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        throw new RepositoryError(503, 'Graphify is not installed on the server. Run "uv tool install graphifyy" (or set GRAPHIFY_BIN) and restart the server.');
      }
      throw new RepositoryError(503, `Unable to build the code graph: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
    return output;
  }

  /** Agent context: rebuilt for every phase; undefined when unavailable, since the graph is optional. */
  async prepare(workspace: string, signal?: AbortSignal): Promise<PreparedCodeGraph | undefined> {
    if (!this.enabled) return undefined;
    try {
      const output = await this.ensure(workspace, { visualization: false, rebuild: true, signal });
      const report = trimGraphReport(await readFile(path.join(output, 'graphify-out', 'GRAPH_REPORT.md'), 'utf8'));
      return this.prepared(output, report, signal);
    } catch (error) {
      if (signal?.aborted) throw error;
      console.warn('Code graph unavailable, continuing without Graphify:', error instanceof Error ? error.message : error);
      return undefined;
    }
  }

  /** Project graph (main clone) shown in the Code graph view; rebuilt when HEAD changes or on request. */
  async snapshot(workspace: string, options: { rebuild?: boolean; signal?: AbortSignal } = {}): Promise<CodeGraphSnapshot> {
    const output = await this.ensure(workspace, { visualization: true, rebuild: options.rebuild ?? false, signal: options.signal });
    const report = await readFile(path.join(output, 'graphify-out', 'GRAPH_REPORT.md'), 'utf8');
    const version = await this.version(output);
    return {
      generatedAt: version?.generatedAt ?? new Date(0).toISOString(),
      commit: version?.commit ?? null,
      report: trimGraphReport(report, MAX_VIEW_REPORT_CHARS),
      visualization: await exists(path.join(output, 'graphify-out', 'graph.html')),
    };
  }

  /** Interactive HTML of the last project graph build, without rebuilding. */
  async visualization(workspace: string) {
    if (!this.enabled) return undefined;
    return readFile(path.join(this.outputFor(workspace, true), 'graphify-out', 'graph.html'), 'utf8').catch(() => undefined);
  }

  private prepared(output: string, report: string, signal?: AbortSignal): PreparedCodeGraph {
    const graph = path.join(output, 'graphify-out', 'graph.json');
    // Exit codes 3 (ambiguous name) and 4 (no match) are informative answers, not failures.
    const ask = async (args: string[]) => {
      const result = await this.run(this.binary, [...args, '--graph', graph], output, QUERY_TIMEOUT_MS, signal);
      if (![0, 3, 4].includes(result.code)) throw new Error(`graphify ${args[0]} failed: ${result.stderr || result.stdout}`.slice(0, 2000));
      const text = (result.stdout || result.stderr).trim() || 'No result.';
      return text.length > MAX_OUTPUT_CHARS ? `${text.slice(0, MAX_OUTPUT_CHARS)}\n[Output truncated]` : text;
    };
    return {
      report,
      query: async (question, budget = 2000) => ask(['query', checkTerm(question), '--budget', String(Math.min(Math.max(Math.trunc(budget), 200), 6000))]),
      explain: async (node) => ask(['explain', checkTerm(node)]),
      path: async (from, to) => ask(['path', checkTerm(from), checkTerm(to), '--undirected']),
      affected: async (node) => ask(['affected', checkTerm(node)]),
      dispose: () => rm(output, { recursive: true, force: true }),
    };
  }
}
