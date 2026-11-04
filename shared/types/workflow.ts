import { z } from 'zod';

export const workflowStepStateSchema = z.enum(['pending', 'active', 'waiting', 'completed', 'failed', 'stopped']);
export type WorkflowStepState = z.infer<typeof workflowStepStateSchema>;

export const agentWorkflowSchema = z.object({
  plan: workflowStepStateSchema,
  approval: workflowStepStateSchema,
  execution: workflowStepStateSchema,
  review: workflowStepStateSchema,
  delivery: workflowStepStateSchema,
});
export type AgentWorkflow = z.infer<typeof agentWorkflowSchema>;
export type WorkflowStepId = keyof AgentWorkflow;
export const agentWorkflowsSchema = z.record(z.string(), agentWorkflowSchema);
export const agentPhaseSchema = z.enum(['planning', 'awaiting_approval', 'executing']).nullable().optional();

export const WORKFLOW_STEPS: { id: WorkflowStepId; label: string }[] = [
  { id: 'plan', label: 'Plan' },
  { id: 'approval', label: 'Approval' },
  { id: 'execution', label: 'Execution' },
  { id: 'review', label: 'Review' },
  { id: 'delivery', label: 'Delivery' },
];
