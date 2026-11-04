import type { AgentContext, AgentQuestionInput, AgentRuntime } from '../../shared/types/agent';

export interface AgentRequest {
  context: AgentContext;
  workspace: string;
  phase: 'plan' | 'execute' | 'review';
  plan: string;
  onContent?: (content: string) => Promise<void>;
  onSession: (id: string) => Promise<void>;
  onRuntime?: (runtime: AgentRuntime) => Promise<void>;
  ask: (question: AgentQuestionInput) => Promise<string>;
  answers: { question: string; answer: string }[];
  signal?: AbortSignal;
  feedback?: string;
  reviewDiff?: string;
  recordCheck?: (result: { script: 'test' | 'lint'; passed: boolean; output: string }) => Promise<void>;
}

export interface AgentProvider {
  readonly id: string;
  run(request: AgentRequest): Promise<string>;
  health?(): Promise<{ authenticated: boolean; issue?: string }>;
  models?(): Promise<Array<{ id: string; name: string }>>;
}
