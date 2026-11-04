import { z } from 'zod';

export const codeGraphSnapshotSchema = z.object({
  generatedAt: z.string(),
  commit: z.string().nullable(),
  report: z.string(),
  visualization: z.boolean(),
});

export type CodeGraphSnapshot = z.infer<typeof codeGraphSnapshotSchema>;

export function codeGraphViewUrl(projectId: string, generatedAt: string) {
  return `/api/board/projects/${encodeURIComponent(projectId)}/code-graph/view?v=${encodeURIComponent(generatedAt)}`;
}
