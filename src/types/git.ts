import { z } from 'zod';

export const publishedWorkSchema = z.object({
  id: z.string(), kind: z.enum(['tasks', 'features']), title: z.string(), branch: z.string(),
  tasks: z.array(z.object({ id: z.string(), title: z.string(), revision: z.number(), releaseId: z.string().nullable(), releaseVersion: z.string().nullable() })),
  finishStatus: z.string().nullable(), finishError: z.string(),
});
export const finishPreviewSchema = z.object({
  projectId: z.string(), scopeId: z.string(), branch: z.string(), targetBranch: z.string(),
  origin: z.string(), featureHead: z.string(), targetHead: z.string(),
  releaseId: z.string(), releaseVersion: z.string(), status: z.string(),
});
export const finishRequestSchema = finishPreviewSchema.omit({ releaseVersion: true, status: true });
export type FinishRequest = z.infer<typeof finishRequestSchema>;
export const publishedWorkListSchema = z.array(publishedWorkSchema);
export const gitWorktreeSchema = z.object({
  path: z.string(), head: z.string().nullable(), branch: z.string().nullable(),
  main: z.boolean(), bare: z.boolean(), detached: z.boolean(),
  locked: z.string().nullable(), prunable: z.string().nullable(),
  task: z.object({ id: z.string(), title: z.string(), status: z.string(), sessionStatus: z.string() }).nullable(),
});
export const gitInventorySchema = z.object({
  projects: z.array(z.object({
    id: z.string(), name: z.string(), url: z.string(), configuredBranch: z.string().nullable(),
    clonePath: z.string(), branch: z.string().nullable(), head: z.string().nullable(),
    worktrees: z.array(gitWorktreeSchema), error: z.string().nullable(),
  })),
});
export type GitInventory = z.infer<typeof gitInventorySchema>;
