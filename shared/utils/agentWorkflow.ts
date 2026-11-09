import type { AgentSession } from '../types/agent';
import type { AgentWorkflow, WorkflowStepState } from '../types/workflow';

type WorkflowSession = Pick<AgentSession, 'status' | 'resumeStatus'> & {
  reviewStatus: string;
  plan?: string;
  output?: string;
  delivery?: (Partial<Omit<NonNullable<AgentSession['delivery']>, 'status'>> & { status: string }) | null;
  publication?: (Partial<NonNullable<AgentSession['publication']>> & { status: string }) | null;
};

export function getAgentWorkflow(session?: WorkflowSession | null): AgentWorkflow {
  const workflow: AgentWorkflow = {
    plan: 'pending', approval: 'pending', execution: 'pending', review: 'pending', delivery: 'pending',
  };
  if (!session) return workflow;
  const { status, resumeStatus, reviewStatus, delivery, publication } = session;
  const reviewing = ['completed', 'delivering'].includes(status) || reviewStatus === 'accepted' || !!delivery || !!publication;
  const executing = reviewing || ['execution_queued', 'executing'].includes(status) || resumeStatus === 'executing' || !!session.output;
  const planned = executing || status === 'awaiting_approval' || resumeStatus === 'awaiting_approval';
  // Adaptive sessions that went straight to execution keep the steps visible but skipped.
  const skipped = executing && session.plan !== undefined && !session.plan.trim();
  workflow.plan = skipped ? 'skipped' : planned ? 'completed' : 'active';
  if (planned) workflow.approval = skipped ? 'skipped' : executing ? 'completed' : 'waiting';
  if (executing) workflow.execution = reviewing ? 'completed' : 'active';
  // Auto mode: a queued ticket runs execution next; Copilot only plans when it judges the ticket complex.
  if (status === 'queued' && resumeStatus !== 'planning') {
    workflow.plan = 'pending';
    workflow.execution = 'active';
  }
  if (reviewing) workflow.review = reviewStatus === 'accepted' ? 'completed' : 'waiting';
  if (reviewStatus === 'accepted') workflow.delivery = 'waiting';
  if (delivery || publication || status === 'delivering') {
    workflow.delivery = delivery?.status === 'delivered' || publication?.status === 'pushed'
      ? 'completed'
      : delivery?.status === 'failed' || publication?.status === 'failed' || !!delivery?.error || !!publication?.error
        ? 'failed' : 'active';
  }
  if (status === 'awaiting_input') workflow[executing ? 'execution' : 'plan'] = 'waiting';
  if (['failed', 'cancelled', 'cancelling'].includes(status)) {
    // Old interrupted runs may lack phase metadata; partial text alone never proves a completed plan.
    const step = executing ? 'execution' : planned ? 'approval' : 'plan';
    const state: WorkflowStepState = status === 'failed' ? 'failed' : 'stopped';
    workflow[step] = state;
  }
  return workflow;
}
