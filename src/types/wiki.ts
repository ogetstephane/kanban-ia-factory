import { z } from 'zod';

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
