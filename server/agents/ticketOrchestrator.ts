import { agentProviderSchema, type AgentProviderId } from '../../shared/types/agentProvider';
import type { AgentOptions } from '../../shared/types/agent';
import type { AgentProvider, AgentRequest } from './provider';
import { ticketWorkflowAgent, workflowNodeAgent } from './workflowRuntime';
import { runWorkflowGraph } from './workflowGraphRunner';

export interface TicketRuntimeRegistration {
  id: AgentProviderId;
  name: string;
  provider?: AgentProvider;
  defaultModel: string | null;
  experimental?: boolean;
  issue?: string;
}

/** The persisted workflow stays in SessionService; runtime choice never changes between its phases. */
export class TicketOrchestrator implements AgentProvider {
  readonly id = 'copilot';
  private readonly runtimes = new Map<AgentProviderId, TicketRuntimeRegistration>();

  constructor(registrations: TicketRuntimeRegistration[]) {
    for (const registration of registrations) {
      if (this.runtimes.has(registration.id)) throw new Error(`Duplicate ticket runtime: ${registration.id}`);
      if (registration.provider && registration.provider.id !== registration.id) throw new Error('Ticket runtime registration ID mismatch.');
      this.runtimes.set(registration.id, registration);
    }
    if (!this.runtimes.get('copilot')?.provider) throw new Error('The default Copilot ticket runtime is required.');
  }

  private runtime(id: string) {
    const registration = this.runtimes.get(agentProviderSchema.parse(id));
    if (!registration?.provider) throw new Error(registration?.issue ?? `Ticket runtime unavailable: ${id}`);
    return registration;
  }

  async options(): Promise<AgentOptions> {
    return { providers: await Promise.all([...this.runtimes.values()].map(async (registration) => {
      const base = {
        id: registration.id, name: registration.name, defaultModel: registration.defaultModel,
        experimental: !!registration.experimental,
      };
      if (!registration.provider) return {
        ...base, available: false, issue: registration.issue ?? 'Ticket runtime is disabled.', models: [],
      };
      try {
        if (!registration.provider.models) throw new Error('This ticket runtime does not expose a model catalogue.');
        return { ...base, available: true, issue: null, models: await registration.provider.models() };
      } catch (error) {
        console.error(`Ticket runtime catalogue failed (${registration.id}):`, error);
        return { ...base, available: false, issue: error instanceof Error ? error.message : 'Model catalogue failed.', models: [] };
      }
    })) };
  }

  async run(request: AgentRequest) {
    request.signal?.throwIfAborted();
    const registration = this.runtime(request.context.task.agentProvider ?? this.id);
    if (request.context.workflow?.document.execution && !request.workflowStep) {
      const snapshot = request.context.workflow;
      return runWorkflowGraph(snapshot, request.phase, async (node, inputs) => {
        const definition = workflowNodeAgent(snapshot, node.id);
        const readOnly = node.run?.access === 'read-only';
        const intermediate = node.run?.output !== 'result';
        return registration.provider!.run({
          ...request,
          phase: readOnly && request.phase === 'execute' ? 'plan' : request.phase,
          workflowStep: { nodeId: node.id, inputs, intermediate },
          resolvedModel: request.context.task.agentModel || definition.model || registration.defaultModel || undefined,
          adaptive: !readOnly && request.adaptive,
          requestPlanApproval: readOnly ? undefined : request.requestPlanApproval,
          onContent: intermediate ? undefined : request.onContent,
          recordCheck: readOnly ? undefined : request.recordCheck,
        });
      }, request.signal);
    }
    const model = request.context.task.agentModel || ticketWorkflowAgent(request)?.model || registration.defaultModel || undefined;
    const output = await registration.provider!.run({
      ...request, resolvedModel: model,
    });
    request.signal?.throwIfAborted();
    if (!output.trim()) throw new Error(`Ticket runtime ${registration.id} returned no response.`);
    return output;
  }

  async health() {
    const provider = this.runtime(this.id).provider!;
    if (!provider.health) throw new Error('Default runtime does not expose an authentication diagnostic.');
    return provider.health();
  }
}
