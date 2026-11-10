import { query, type Options, type Query } from '@anthropic-ai/claude-agent-sdk';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { z } from 'zod';

const require = createRequire(import.meta.url);
const metadata = z.object({ version: z.string().min(1), claudeCodeVersion: z.string().min(1) })
  .parse(JSON.parse(readFileSync(path.join(path.dirname(require.resolve('@anthropic-ai/claude-agent-sdk')), 'package.json'), 'utf8')));
export const CLAUDE_SDK_VERSION = metadata.version;
export const CLAUDE_RUNTIME_VERSION = metadata.claudeCodeVersion;

export type ClaudeRuntimeQuery = AsyncIterable<{ type: string }>
  & Pick<Query, 'close' | 'supportedModels' | 'accountInfo' | 'mcpServerStatus'> & {
    initializationResult(): Promise<Pick<Awaited<ReturnType<Query['initializationResult']>>,
      'hooks_applied' | 'hook_on_failure_supported' | 'agents'>>;
  };
export interface ClaudeRuntimeOptions {
  apiKey?: string;
  createQuery?: (input: Parameters<typeof query>[0]) => ClaudeRuntimeQuery;
}
export class ClaudeShutdownError extends Error {}

export async function withClaudeQuery<T>(
  runtime: ClaudeRuntimeOptions, options: Options, signal: AbortSignal,
  action: (session: ClaudeRuntimeQuery, send: (prompt: string) => void, directory: string) => Promise<T>,
): Promise<T> {
  signal.throwIfAborted();
  if (!runtime.apiKey?.trim()) throw new Error('Claude requires an explicitly supplied Anthropic API key.');
  const directory = await mkdtemp(path.join(tmpdir(), 'kanban-claude-'));
  const controller = new AbortController();
  let release!: (prompt: string | undefined) => void;
  const input = new Promise<string | undefined>((resolve) => { release = resolve; });
  const children: { child: ChildProcess; exited: Promise<void> }[] = [];
  let session: ClaudeRuntimeQuery | undefined;
  const abort = () => controller.abort(signal.reason);
  signal.addEventListener('abort', abort, { once: true });
  try {
    if (signal.aborted) abort();
    controller.signal.throwIfAborted();
    session = (runtime.createQuery ?? query)({
      prompt: (async function* () {
        const prompt = await input;
        if (prompt !== undefined) yield {
          type: 'user' as const, message: { role: 'user' as const, content: prompt }, parent_tool_use_id: null,
        };
      })(),
      options: {
        tools: [], agents: {}, skills: [], plugins: [], settingSources: [], strictMcpConfig: true,
        persistSession: false, ...options, cwd: directory, abortController: controller,
        env: {
          HOME: directory, TMPDIR: directory, CLAUDE_CONFIG_DIR: path.join(directory, '.claude'),
          ANTHROPIC_API_KEY: runtime.apiKey,
        },
        spawnClaudeCodeProcess: (configuration) => {
          const child = spawn(configuration.command, configuration.args, {
            cwd: configuration.cwd, env: configuration.env, stdio: ['pipe', 'pipe', 'pipe'], signal: configuration.signal,
          });
          const exited = new Promise<void>((resolve) => {
            child.once('exit', () => resolve());
            child.once('error', () => { if (!child.pid) resolve(); });
          });
          children.push({ child, exited });
          return child;
        },
      },
    });
    return await action(session, release, directory);
  } finally {
    signal.removeEventListener('abort', abort);
    release(undefined);
    let closeError: unknown;
    try { session?.close(); } catch (error) { closeError = error; }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const exited = await Promise.race([
      Promise.all(children.map(({ exited }) => exited)).then(() => true),
      new Promise<false>((resolve) => { timer = setTimeout(() => resolve(false), 3000); }),
    ]).finally(() => clearTimeout(timer));
    if (!exited) {
      for (const { child } of children) {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      }
    }
    if (closeError || !exited || (session && !children.length)) {
      throw new ClaudeShutdownError(`Claude runtime shutdown was not confirmed. Temporary directory retained: ${directory}`, { cause: closeError });
    }
    await rm(directory, { recursive: true, force: true });
  }
}
