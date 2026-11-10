import { z } from 'zod';
import type {
  AIProvider, AgentExecutionResult, ExecutionControls, ExecutionTarget,
  PreparedExecutionRequest, ProviderCapabilities, ProviderQualification,
} from '../core/index';
import type { DeepReadonly } from '../core/snapshot';
import { analysisToolSchemas } from '../core/analysis';
import { claudeAnalysisSession, validateClaudeAnalysisInitialization } from './claudeAnalysisSession';
import { withClaudeQuery, ClaudeShutdownError, CLAUDE_SDK_VERSION, CLAUDE_RUNTIME_VERSION, type ClaudeRuntimeQuery, type ClaudeRuntimeOptions } from './claudeRuntime';
import { claudeInventorySchema, claudeResultSchema } from './claudeToolSession';

export const CLAUDE_ANALYSIS_SDK_VERSION = CLAUDE_SDK_VERSION;
export const CLAUDE_ANALYSIS_RUNTIME_VERSION = CLAUDE_RUNTIME_VERSION;
export type ClaudeAnalysisQuery = ClaudeRuntimeQuery;
export interface ClaudeAnalysisOptions extends ClaudeRuntimeOptions {
  qualifications?: readonly ProviderQualification[];
}

/** Not the ticket runtime: credentials are explicit and tools read frozen snapshots only. */
export class ClaudeAnalysisProvider implements AIProvider {
  readonly id = 'claude-code';

  constructor(private readonly options: ClaudeAnalysisOptions = {}) {}

  private qualification(target?: ExecutionTarget) {
    if (!target?.modelId) return undefined;
    return this.options.qualifications?.find((entry) => entry.providerId === this.id
      && entry.modelId === target?.modelId && entry.sdkVersion === CLAUDE_ANALYSIS_SDK_VERSION
      && entry.runtimeVersion === CLAUDE_ANALYSIS_RUNTIME_VERSION && entry.exclusiveToolBroker && entry.evidenceId.trim());
  }

  async health() {
    if (!this.options.apiKey?.trim()) return { available: true, authenticated: false, issue: 'Explicit Anthropic API key required; ambient authentication is disabled.' };
    return withClaudeQuery(this.options, {}, new AbortController().signal, async (session) => {
      const account = await session.accountInfo();
      return { available: true, authenticated: Boolean(account.apiKeySource && account.apiKeySource !== 'none') };
    });
  }

  async listModels() {
    return withClaudeQuery(this.options, {}, new AbortController().signal, async (session) =>
      (await session.supportedModels()).map(({ value, resolvedModel, displayName }) =>
        ({ id: resolvedModel ?? value, name: displayName })));
  }

  async getCapabilities(target?: ExecutionTarget): Promise<ProviderCapabilities> {
    return {
      providerId: this.id, modelId: target?.modelId, sdkVersion: CLAUDE_ANALYSIS_SDK_VERSION,
      runtimeVersion: CLAUDE_ANALYSIS_RUNTIME_VERSION, observedAt: new Date().toISOString(),
      features: {
        blockingToolPermissions: this.qualification(target) ? 'native' : 'unknown',
        structuredOutput: 'unsupported', nativeAgents: 'unsupported', nativeSkills: 'unsupported',
        delegation: 'unsupported', textStreaming: 'unsupported', sessionResume: 'unsupported',
        parallelSessions: 'unknown', toolHooks: 'native',
      },
      customTools: 'mcp', usageReporting: 'unavailable',
    };
  }

  async execute(request: DeepReadonly<PreparedExecutionRequest>, controls: ExecutionControls): Promise<AgentExecutionResult> {
    controls.signal.throwIfAborted();
    if (request.target.providerId !== this.id || !request.target.modelId || request.nativeSessionId
      || request.output.kind !== 'json' || request.policy.workspace.writablePaths.length
      || request.policy.workspace.network !== 'deny' || !controls.invokeTool
      || request.tools.some((name) => !Object.hasOwn(analysisToolSchemas, name))) {
      throw new Error('Claude analysis requires an explicit model and a new read-only JSON execution with the exclusive broker.');
    }
    if (!this.qualification(request.target)) throw new Error('Claude analysis runtime is not qualified for exclusive tool execution.');
    const configuration = claudeAnalysisSession(request, controls);
    return withClaudeQuery<AgentExecutionResult>(this.options, {
      ...configuration.options, model: request.target.modelId,
    }, controls.signal, async (session, send, directory) => {
      const initialized = await session.initializationResult();
      validateClaudeAnalysisInitialization(initialized);
      configuration.validateBroker(await session.mcpServerStatus());
      controls.signal.throwIfAborted();
      send(request.prompt);
      let nativeSessionId: string | undefined;
      let result: z.infer<typeof claudeResultSchema> | undefined;
      try {
        for await (const message of session) {
          configuration.assertNoRefusal();
          controls.signal.throwIfAborted();
          if (message.type === 'system' && 'subtype' in message && message.subtype === 'init') {
            const inventory = claudeInventorySchema.parse(message);
            configuration.validateInventory(inventory, directory, CLAUDE_ANALYSIS_RUNTIME_VERSION);
            if (nativeSessionId) throw new Error('Claude analysis emitted multiple session inventories.');
            // The init inventory is an observation, not proof it preceded inference.
            nativeSessionId = inventory.session_id;
            await controls.onEvent({
              executionId: request.executionId, sequence: 0, occurredAt: new Date().toISOString(),
              payload: { type: 'started', nativeSessionId },
            });
          } else if (message.type === 'assistant') {
            const assistant = z.object({
              parent_tool_use_id: z.string().nullable(),
              message: z.object({ content: z.array(z.object({
                type: z.string(), id: z.string().optional(), name: z.string().optional(),
              })) }),
            }).parse(message);
            if (assistant.parent_tool_use_id) await configuration.assertToolAllowed('Agent', assistant.parent_tool_use_id);
            for (const block of assistant.message.content) {
              if (block.type === 'tool_use') {
                if (!block.name || !block.id) throw new Error('Claude analysis received an invalid tool call.');
                await configuration.assertToolAllowed(block.name, block.id);
              }
            }
          } else if (message.type === 'system' && 'subtype' in message && message.subtype === 'task_started') {
            const task = z.object({ task_id: z.string().min(1) }).parse(message);
            await configuration.assertToolAllowed('Agent', task.task_id);
          } else if (message.type === 'result') {
            if (result) throw new Error('Claude analysis emitted multiple terminal results.');
            result = claudeResultSchema.parse(message);
          }
        }
      } catch (error) {
        configuration.assertNoRefusal();
        if (!controls.signal.aborted) throw error;
      }
      configuration.assertNoRefusal();
      if (controls.signal.aborted) return {
        status: 'cancelled', reason: 'Claude analysis aborted.', artifacts: [], usage: { basis: 'unavailable' },
      };
      if (!nativeSessionId || !result || result.session_id !== nativeSessionId) throw new Error('Claude analysis ended without a matching inventory and terminal result.');
      if (result.permission_denials.length) throw new Error('Claude analysis reported denied tool calls.');
      if (result.subtype !== 'success' || result.is_error) throw new Error(`Claude analysis failed: ${result.errors?.join('; ') || result.subtype}`);
      if (!result.result?.trim()) throw new Error('Claude analysis returned no response.');
      return { status: 'succeeded', output: result.result, artifacts: [], usage: { basis: 'unavailable' }, nativeSessionId };
    }).catch((error: unknown): AgentExecutionResult => {
      if (error instanceof ClaudeShutdownError) return {
        status: 'interrupted', reason: error.message, artifacts: [], usage: { basis: 'unavailable' },
      };
      configuration.assertNoRefusal();
      if (controls.signal.aborted) return {
        status: 'cancelled', reason: 'Claude analysis aborted.', artifacts: [], usage: { basis: 'unavailable' },
      };
      throw error;
    });
  }
}
