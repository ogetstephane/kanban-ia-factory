import { z } from 'zod';
import { assistantModeInputShape, assistantPlanSchema } from './assistantMode';
import { contextFilesSchema } from './contextFile';

export const MAX_WIKI_ASSISTANT_CONTEXT_BYTES = 100_000;
export const WIKI_ASSISTANT_CONTEXT_ERROR =
  'Wiki AI context is too large. Keep the page draft, prompt and attached files within 100,000 bytes combined. Remove large attachments or shorten the draft and retry. No content has been truncated.';

export function wikiAssistantContextBytes(input: { path: string; content: string; prompt: string; files: { size: number }[]; approvedPlan?: string }) {
  const encoder = new TextEncoder();
  return encoder.encode(input.path).length + encoder.encode(input.content).length +
    encoder.encode(input.prompt).length + encoder.encode(input.approvedPlan ?? '').length +
    input.files.reduce((total, file) => total + file.size, 0);
}

export const wikiAssistantInputSchema = z.object({
  path: z.string().min(1).max(300),
  content: z.string().max(1024 * 1024),
  prompt: z.string().trim().min(1).max(10000),
  files: contextFilesSchema.default([]),
  ...assistantModeInputShape,
}).refine((input) => wikiAssistantContextBytes(input) <= MAX_WIKI_ASSISTANT_CONTEXT_BYTES, WIKI_ASSISTANT_CONTEXT_ERROR);
export const wikiAssistantProposalSchema = z.object({
  content: z.string().min(1).max(1024 * 1024),
  summary: z.string().min(1).max(10000),
});
/** The wiki assistant returns either a page proposal or, when a plan is needed or requested, a plan to confirm. */
export const wikiAssistantResultSchema = z.discriminatedUnion('kind', [
  wikiAssistantProposalSchema.extend({ kind: z.literal('proposal') }),
  assistantPlanSchema.extend({ kind: z.literal('plan') }),
]);
export type WikiAssistantInput = z.infer<typeof wikiAssistantInputSchema>;
export type WikiAssistantResult = z.infer<typeof wikiAssistantResultSchema>;

export const docFileSchema = z.object({ path: z.string(), size: z.number().int().nonnegative(), modifiedAt: z.string() });
export const docListSchema = z.object({
  docsPath: z.string(), branch: z.string().nullable(), files: z.array(docFileSchema),
});
export const docContentSchema = z.object({ path: z.string(), content: z.string(), sha: z.string() });
export const docSaveInputSchema = z.object({
  path: z.string().min(1).max(300),
  content: z.string(),
  expectedSha: z.string().nullable(),
});
export const docSaveResultSchema = z.object({ path: z.string(), sha: z.string(), unchanged: z.boolean() });
export const docStatusSchema = z.object({
  pending: z.array(z.object({ path: z.string(), status: z.enum(['added', 'modified', 'deleted']) })),
  ahead: z.number().int().nonnegative().nullable(),
});
export const docSyncResultSchema = z.object({
  branch: z.string(), commit: z.string().nullable(), files: z.number().int().nonnegative(),
  pushed: z.boolean(), pushError: z.string().optional(),
});
export type DocFile = z.infer<typeof docFileSchema>;
export type DocSaveResult = z.infer<typeof docSaveResultSchema>;
export type DocStatus = z.infer<typeof docStatusSchema>;
export type DocSyncResult = z.infer<typeof docSyncResultSchema>;
