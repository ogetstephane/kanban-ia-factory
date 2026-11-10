import { z } from 'zod';
import { taskDraftProposalSchema } from '../types/taskDraft';
import { taskBreakdownProposalSchema } from '../types/taskBreakdown';

export interface TicketProposalIssue {
  code: 'invalid-structure' | 'duplicate' | 'open-decision';
  path: string;
  message: string;
}

export interface TicketProposalQuality {
  status: 'ready-for-review' | 'needs-clarification';
  issues: TicketProposalIssue[];
}

function report(issues: TicketProposalIssue[]): TicketProposalQuality {
  return { status: issues.length ? 'needs-clarification' : 'ready-for-review', issues };
}

function structureIssues(error: z.ZodError): TicketProposalIssue[] {
  return error.issues.map((issue) => ({
    code: 'invalid-structure', path: issue.path.join('.'), message: issue.message,
  }));
}

function duplicateIssues(values: string[], path: string, field?: string): TicketProposalIssue[] {
  const seen = new Set<string>();
  return values.flatMap((value, index) => {
    const key = value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
    if (seen.has(key)) return [{
      code: 'duplicate' as const, path: `${path}.${index}${field ? `.${field}` : ''}`,
      message: `Repeated text: "${value}"`,
    }];
    seen.add(key);
    return [];
  });
}

function openDecisions(questions: string[], path: string): TicketProposalIssue[] {
  return questions.map((question, index) => ({
    code: 'open-decision', path: `${path}.${index}`, message: question,
  }));
}

function ticketIssues(ticket: z.infer<typeof taskDraftProposalSchema>, prefix = ''): TicketProposalIssue[] {
  return [
    ...duplicateIssues(ticket.acceptanceCriteria, `${prefix}acceptanceCriteria`),
    ...duplicateIssues(ticket.subtasks, `${prefix}subtasks`),
    ...openDecisions(ticket.openQuestions ?? [], `${prefix}openQuestions`),
  ];
}

export function assessTicketProposal(input: unknown): TicketProposalQuality {
  const parsed = taskDraftProposalSchema.safeParse(input);
  return report(parsed.success ? ticketIssues(parsed.data) : structureIssues(parsed.error));
}

export function assessTicketBreakdown(input: unknown): TicketProposalQuality {
  const parsed = taskBreakdownProposalSchema.safeParse(input);
  if (!parsed.success) return report(structureIssues(parsed.error));
  const proposal = parsed.data;
  return report([
    ...openDecisions(proposal.openQuestions, 'openQuestions'),
    ...duplicateIssues(proposal.tasks.map((task) => task.title), 'tasks', 'title'),
    ...duplicateIssues(proposal.tasks.map((task) => task.description), 'tasks', 'description'),
    ...proposal.tasks.flatMap((ticket, index) => ticketIssues(ticket, `tasks.${index}.`)),
  ]);
}
