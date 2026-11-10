import { z } from 'zod';

const questionSchema = z.string().trim().min(1).max(2000);

export const ticketClarificationSchema = z.object({
  kind: z.literal('clarification'),
  reason: z.string().trim().min(1).max(2000),
  questions: z.array(questionSchema).min(1).max(5).refine(
    (questions) => new Set(questions.map((question) => question.toLowerCase())).size === questions.length,
    'Clarification questions must be unique',
  ),
});

export const ticketClarificationAnswersSchema = z.array(z.object({
  question: questionSchema,
  answer: z.string().trim().min(1).max(4000),
})).min(1).max(5);

export type TicketClarification = z.infer<typeof ticketClarificationSchema>;
export type TicketClarificationAnswer = z.infer<typeof ticketClarificationAnswersSchema>[number];

export function clarificationContext(answers: TicketClarificationAnswer[] = []) {
  return answers.length
    ? `## Clarifications\n\n${answers.map(({ question, answer }) => `### ${question}\n\n${answer}`).join('\n\n')}`
    : '';
}
