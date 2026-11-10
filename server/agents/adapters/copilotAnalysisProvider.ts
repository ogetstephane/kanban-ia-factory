import { CopilotClient, type CopilotSession, type SessionConfig } from '@github/copilot-sdk';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import type {
  AIProvider, AgentExecutionResult, ExecutionControls, ExecutionTarget,
  PreparedExecutionRequest, ProviderCapabilities, ProviderQualification,
} from '../core/index';
import type { DeepReadonly } from '../core/snapshot';
import { analysisToolSchemas } from '../core/analysis';
import { copilotAnalysisSession, validateCopilotAnalysisSession, type AnalysisSessionInventory } from './copilotAnalysisSession';

const require = createRequire(import.meta.url);
export const COPILOT_ANALYSIS_SDK_VERSION = z.object({ version: z.string().min(1) })
  .parse(JSON.parse(readFileSync(path.resolve(path.dirname(require.resolve('@github/copilot-sdk')), '../../package.json'), 'utf8'))).version;

export type AnalysisSession = Pick<CopilotSession, 'sessionId' | 'sendAndWait' | 'abort'> & {
  rpc: AnalysisSessionInventory;
};
export type AnalysisCopilotClient = Pick<CopilotClient, 'start' | 'stop' | 'getAuthStatus' | 'getStatus' | 'listModels'> & {
  createSession(configuration: SessionConfig): Promise<AnalysisSession>;
};
export interface CopilotAnalysisOptions {
  qualifications?: readonly ProviderQualification[];
  createClient?: (options: { mode: 'empty'; workingDirectory: string; baseDirectory: string }) => AnalysisCopilotClient;
}

class RuntimeShutdownError extends AggregateError {}

/** Separate from the ticket provider: no live workspace or ambient CLI tools. */
export class CopilotAnalysisProvider implements AIProvider {
  readonly id = 'copilot';

  constructor(private readonly options: CopilotAnalysisOptions = {}) {}

  private async withClient<T>(action: (client: AnalysisCopilotClient, directory: string) => Promise<T>): Promise<T> {
    const directory = await mkdtemp(path.join(tmpdir(), 'kanban-analysis-'));
    let client: AnalysisCopilotClient | undefined;
    try {
      const clientOptions = { mode: 'empty' as const, workingDirectory: directory, baseDirectory: directory };
      client = this.options.createClient?.(clientOptions) ?? new CopilotClient(clientOptions);
      await client.start();
      return await action(client, directory);
    } finally {
      if (client) {
        try {
          const errors = await client.stop();
          if (errors.length) throw new AggregateError(errors, 'Copilot runtime stop returned errors.');
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          throw new RuntimeShutdownError([error], `Copilot analysis runtime shutdown was not confirmed: ${reason}. Temporary directory retained: ${directory}`);
        }
      }
      await rm(directory, { recursive: true, force: true });
    }
  }

  private qualification(target: ExecutionTarget | undefined, runtimeVersion: string) {
    return this.options.qualifications?.find((entry) => entry.providerId === this.id
      && entry.modelId === target?.modelId && entry.sdkVersion === COPILOT_ANALYSIS_SDK_VERSION
      && entry.runtimeVersion === runtimeVersion && entry.exclusiveToolBroker && entry.evidenceId.trim());
  }

  async health() {
    return this.withClient(async (client) => ({
      available: true, authenticated: (await client.getAuthStatus()).isAuthenticated,
    }));
  }

  async listModels() {
    return this.withClient(async (client) => (await client.listModels())
      .filter((model) => model.policy?.state !== 'disabled')
      .map(({ id, name }) => ({ id, name })));
  }

  async getCapabilities(target?: ExecutionTarget): Promise<ProviderCapabilities> {
    return this.withClient(async (client) => {
      const { version } = await client.getStatus();
      return {
        providerId: this.id, modelId: target?.modelId, sdkVersion: COPILOT_ANALYSIS_SDK_VERSION,
        runtimeVersion: version, observedAt: new Date().toISOString(),
        features: {
          blockingToolPermissions: this.qualification(target, version) ? 'native' : 'unknown',
          structuredOutput: 'unsupported', nativeAgents: 'unsupported', nativeSkills: 'unsupported',
          delegation: 'unsupported', textStreaming: 'unsupported', sessionResume: 'unsupported',
          parallelSessions: 'unknown', toolHooks: 'native',
        },
        customTools: 'direct', usageReporting: 'unavailable',
      };
    });
  }

  async execute(request: DeepReadonly<PreparedExecutionRequest>, controls: ExecutionControls): Promise<AgentExecutionResult> {
    controls.signal.throwIfAborted();
    if (request.target.providerId !== this.id || request.nativeSessionId || request.output.kind !== 'json'
      || request.policy.workspace.writablePaths.length || request.policy.workspace.network !== 'deny'
      || !controls.invokeTool || request.tools.some((name) => !Object.hasOwn(analysisToolSchemas, name))) {
      throw new Error('Copilot analysis requires a new read-only JSON execution with the exclusive broker.');
    }
    return this.withClient<AgentExecutionResult>(async (client, directory) => {
      controls.signal.throwIfAborted();
      const { version } = await client.getStatus();
      if (!this.qualification(request.target, version)) throw new Error('Copilot analysis runtime is not qualified for exclusive tool execution.');
      if (!(await client.getAuthStatus()).isAuthenticated) throw new Error('Authenticate Copilot CLI before running an analysis.');
      controls.signal.throwIfAborted();
      const { configuration, assertNoRefusal } = copilotAnalysisSession(request, controls, directory);
      const session = await client.createSession(configuration);
      let abortWrite: Promise<void> | undefined;
      const abort = () => {
        abortWrite ??= session.abort();
        // Keep rejection observed until cleanup can propagate it.
        void abortWrite.catch(() => {});
      };
      controls.signal.addEventListener('abort', abort, { once: true });
      try {
        if (controls.signal.aborted) abort();
        controls.signal.throwIfAborted();
        await validateCopilotAnalysisSession(session.rpc, configuration.tools?.map(({ name }) => name) ?? []);
        controls.signal.throwIfAborted();
        await controls.onEvent({
          executionId: request.executionId, sequence: 0, occurredAt: new Date().toISOString(),
          payload: { type: 'started', nativeSessionId: session.sessionId },
        });
        const response = await session.sendAndWait({ prompt: request.prompt }, request.budget.limits.maxDurationMs)
          .catch(async (error: unknown) => {
            assertNoRefusal();
            if (controls.signal.aborted) {
              await abortWrite;
              return undefined;
            }
            throw error;
          });
        assertNoRefusal();
        if (controls.signal.aborted) {
          await abortWrite;
          return { status: 'cancelled', reason: 'Copilot analysis aborted.', artifacts: [], usage: { basis: 'unavailable' }, nativeSessionId: session.sessionId };
        }
        if (!response?.data.content?.trim()) throw new Error('Copilot analysis returned no response.');
        return { status: 'succeeded', output: response.data.content, artifacts: [],
          usage: { basis: 'unavailable' }, nativeSessionId: session.sessionId };
      } finally {
        controls.signal.removeEventListener('abort', abort);
        await abortWrite;
      }
    }).catch((error: unknown): AgentExecutionResult => {
      if (error instanceof RuntimeShutdownError) {
        return { status: 'interrupted', reason: error.message, artifacts: [], usage: { basis: 'unavailable' } };
      }
      throw error;
    });
  }
}
