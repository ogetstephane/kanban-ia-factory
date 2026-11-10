import { randomUUID } from 'node:crypto';
import { agentRuntimeEventSchema, agentRuntimeSchema, type AgentRuntime } from '../../shared/types/agent';
import type { AgentRequest } from './provider';

export class RuntimeTelemetry {
  private runtime: AgentRuntime;
  private ids = new Set<string>();
  private writes = Promise.resolve();
  private writeError: unknown;
  private timer?: ReturnType<typeof setTimeout>;

  constructor(private readonly request: AgentRequest) {
    this.runtime = agentRuntimeSchema.parse(JSON.parse(JSON.stringify({
      id: randomUUID(), phase: request.phase, providerSessionId: null,
      status: 'running', startedAt: new Date().toISOString(), endedAt: null, error: '',
      metadata: {
        provider: request.context.task.agentProvider,
        requestedModel: request.resolvedModel ?? request.context.task.agentModel ?? (request.context.task.agentProvider === 'claude-code'
          ? null : process.env.COPILOT_MODEL) ?? null,
        workspace: request.workspace, context: request.context,
        approvedPlan: request.plan, feedback: request.feedback ?? null,
        previousAnswers: request.answers, reviewDiff: request.reviewDiff ?? null,
      },
      events: [],
    })));
  }

  async update(metadata: unknown, providerSessionId = this.runtime.providerSessionId) {
    this.runtime.metadata = {
      ...this.runtime.metadata,
      ...agentRuntimeSchema.shape.metadata.parse(JSON.parse(JSON.stringify(metadata))),
    };
    this.runtime.providerSessionId = providerSessionId;
    await this.flush();
  }

  event = (input: unknown) => {
    const parsed = agentRuntimeEventSchema.safeParse(JSON.parse(JSON.stringify(input ?? null)));
    if (!parsed.success) {
      console.warn('Ignoring unrecognized agent runtime event:', parsed.error.message);
      return;
    }
    const event = parsed.data;
    if (this.ids.has(event.id)) return;
    this.ids.add(event.id);
    this.runtime.events.push(event);
    if (!this.timer) this.timer = setTimeout(() => {
      this.timer = undefined;
      this.queueWrite();
    }, 250);
  };

  private queueWrite() {
    if (!this.request.onRuntime) return;
    const snapshot = agentRuntimeSchema.parse(JSON.parse(JSON.stringify(this.runtime)));
    this.writes = this.writes.then(async () => {
      if (this.writeError) return;
      try { await this.request.onRuntime?.(snapshot); }
      catch (error) {
        this.writeError = error;
        console.error('Unable to persist agent runtime telemetry:', error);
      }
    });
  }

  private async flush() {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.queueWrite();
    await this.writes;
    if (this.writeError) throw this.writeError;
  }

  setPhase(phase: AgentRuntime['phase']) {
    this.runtime.phase = phase;
  }

  async finish(error?: unknown) {
    this.runtime.status = error === undefined ? 'completed' : this.request.signal?.aborted ? 'cancelled' : 'failed';
    this.runtime.error = error === undefined ? '' : error instanceof Error ? error.message : String(error);
    this.runtime.endedAt = new Date().toISOString();
    await this.flush();
  }
}
