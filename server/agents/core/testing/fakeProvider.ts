import type {
  AIProvider,
  AgentExecutionResult,
  ExecutionControls,
  PreparedExecutionRequest,
  ProviderCapabilities,
  ExecutionTarget,
} from '../index';
import type { DeepReadonly } from '../snapshot';

export type FakeExecution = (
  request: DeepReadonly<PreparedExecutionRequest>,
  controls: ExecutionControls,
) => Promise<AgentExecutionResult>;

export class FakeAIProvider implements AIProvider {
  readonly id: string = 'fake';
  readonly requests: DeepReadonly<PreparedExecutionRequest>[] = [];

  constructor(private readonly results: (AgentExecutionResult | FakeExecution)[] = []) {}

  async getCapabilities(target?: ExecutionTarget): Promise<ProviderCapabilities> {
    return {
      providerId: this.id,
      ...(target?.modelId ? { modelId: target.modelId } : {}),
      sdkVersion: 'test',
      observedAt: new Date(0).toISOString(),
      features: {
        nativeAgents: 'unsupported',
        nativeSkills: 'unsupported',
        delegation: 'unsupported',
        structuredOutput: 'unsupported',
        textStreaming: 'unsupported',
        sessionResume: 'unsupported',
        blockingToolPermissions: 'native',
        toolHooks: 'unsupported',
        parallelSessions: 'unsupported',
      },
      customTools: 'direct',
      usageReporting: 'unavailable',
      maxConcurrentSessions: 1,
    };
  }

  async listModels() {
    return [{ id: 'fake-model', name: 'Deterministic fake model' }];
  }

  async health() {
    return { available: true, authenticated: true };
  }

  async execute(
    request: DeepReadonly<PreparedExecutionRequest>,
    controls: ExecutionControls,
  ): Promise<AgentExecutionResult> {
    if (controls.signal.aborted) {
      return {
        status: 'cancelled',
        reason: 'Execution was aborted before the fake provider started.',
        artifacts: [],
        usage: { basis: 'unavailable' },
      };
    }

    this.requests.push(request);
    await controls.onEvent({
      executionId: request.executionId,
      sequence: 0,
      occurredAt: new Date(0).toISOString(),
      payload: { type: 'started' },
    });

    if (controls.signal.aborted) {
      return {
        status: 'cancelled',
        reason: 'Execution was aborted while the fake provider was starting.',
        artifacts: [],
        usage: { basis: 'unavailable' },
      };
    }

    const result = this.results.shift();
    if (!result) throw new Error('FakeAIProvider has no queued result for this execution.');
    return typeof result === 'function' ? result(request, controls) : result;
  }
}
