import { z } from 'zod';
import { assistantPlanSchema } from './assistantMode';
import { taskDraftProposalSchema } from './taskDraft';
import { taskSchema } from './board';
import { ticketClarificationSchema } from './ticketClarification';

export const taskBreakdownTicketSchema = taskDraftProposalSchema.extend({
  id: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
  priority: taskSchema.shape.priority,
  dependsOn: z.array(z.string().min(1).max(64)).max(20),
});

export const taskBreakdownProposalSchema = z.object({
  summary: z.string().trim().min(1).max(10_000),
  impactAnalysis: z.string().trim().min(1).max(20_000),
  openQuestions: z.array(z.string().trim().min(1).max(2000)).max(30),
  tasks: z.array(taskBreakdownTicketSchema).min(1).max(20),
}).superRefine((proposal, context) => {
  const earlier = new Set<string>();
  for (const [index, task] of proposal.tasks.entries()) {
    if (earlier.has(task.id)) context.addIssue({ code: 'custom', path: ['tasks', index, 'id'], message: 'Duplicate proposal ticket ID' });
    if (new Set(task.dependsOn).size !== task.dependsOn.length || task.dependsOn.some((id) => !earlier.has(id))) {
      context.addIssue({ code: 'custom', path: ['tasks', index, 'dependsOn'], message: 'Dependencies must name unique earlier tickets in this proposal' });
    }
    earlier.add(task.id);
  }
  if (JSON.stringify(proposal).length > 150_000) {
    context.addIssue({ code: 'custom', message: 'Breakdown proposal exceeds 150,000 characters' });
  }
});

export const taskBreakdownResultSchema = z.discriminatedUnion('kind', [
  taskBreakdownProposalSchema.safeExtend({ kind: z.literal('proposal'), graphAvailable: z.boolean() }),
  assistantPlanSchema.extend({ kind: z.literal('plan'), graphAvailable: z.boolean() }),
  ticketClarificationSchema.extend({ graphAvailable: z.boolean() }),
]);
export type TaskBreakdownResult = z.infer<typeof taskBreakdownResultSchema>;
export type TaskBreakdownProposal = Extract<TaskBreakdownResult, { kind: 'proposal' }>;
export type TaskBreakdownTicket = z.infer<typeof taskBreakdownTicketSchema>;
