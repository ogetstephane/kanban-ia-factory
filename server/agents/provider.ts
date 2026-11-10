import type { AgentCheckScript, AgentContext, AgentQuestionInput, AgentRuntime } from '../../shared/types/agent';
import type { AgentOptions } from '../../shared/types/agent';

export interface PlanApprovalRequest { plan: string; reason: string }

export interface AgentRequest {
  context: AgentContext;
  /** Runtime-resolved model, without overwriting the snapshotted ticket selection. */
  resolvedModel?: string;
  workflowStep?: { nodeId: string; inputs: Record<string, string>; intermediate: boolean };
  workspace: string;
  phase: 'plan' | 'execute' | 'review';
  plan: string;
  /** Execute directly unless the agent judges the ticket complex enough to request plan approval first. */
  adaptive?: boolean;
  requestPlanApproval?: (proposal: PlanApprovalRequest) => Promise<void>;
  onContent?: (content: string) => Promise<void>;
  onSession: (id: string) => Promise<void>;
  onRuntime?: (runtime: AgentRuntime) => Promise<void>;
  ask: (question: AgentQuestionInput) => Promise<string>;
  answers: { question: string; answer: string }[];
  signal?: AbortSignal;
  feedback?: string;
  reviewDiff?: string;
  recordCheck?: (result: { script: AgentCheckScript; passed: boolean; output: string }) => Promise<void>;
}

export interface AgentProvider {
  readonly id: string;
  run(request: AgentRequest): Promise<string>;
  health?(): Promise<{ authenticated: boolean; issue?: string }>;
  models?(): Promise<Array<{ id: string; name: string }>>;
  options?(): Promise<AgentOptions>;
}
