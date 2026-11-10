import { z } from 'zod';
import { workflowRuntimeSnapshotSchema } from './workflowEditor';

export const versionSchema = z.string().trim().max(100).regex(
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/,
  'Use a SemVer version without the v prefix, for example 1.2.0 or 1.2.0-rc.1',
);
export const releaseStatusSchema = z.enum(['upcoming', 'in_progress', 'published', 'cancelled']);
export const RELEASE_LABELS: Record<z.infer<typeof releaseStatusSchema>, string> = {
  upcoming: 'Upcoming', in_progress: 'In progress', published: 'Published', cancelled: 'Cancelled',
};
export const releaseSchema = z.object({
  id: z.string(), projectId: z.string(), version: versionSchema, status: releaseStatusSchema,
  revision: z.number().int(), publishing: z.boolean(),
  targetBranch: z.string().nullable(), targetCommit: z.string().nullable(), remoteUrl: z.string().nullable(),
  tagHash: z.string().nullable(), error: z.string(), publishedAt: z.string().nullable(),
  createdAt: z.string(), updatedAt: z.string(), ticketCount: z.number(), deliveredCount: z.number(),
});
export type Release = z.infer<typeof releaseSchema>;
export const releaseRecordSchema = releaseSchema.omit({ ticketCount: true, deliveredCount: true }).extend({
  workflowSnapshot: workflowRuntimeSnapshotSchema.nullable().optional(),
});
export const releaseEditSchema = z.object({
  version: versionSchema, status: z.enum(['upcoming', 'in_progress', 'cancelled']),
});
export const releaseUpdateSchema = releaseEditSchema.extend({ revision: z.number().int().nonnegative() });
export const releaseDetailSchema = releaseSchema.extend({
  tickets: z.array(z.object({
    id: z.string(), title: z.string(), status: z.string(), revision: z.number(),
    delivered: z.boolean(), mergeHash: z.string().nullable(),
  })),
});
export const releasePreviewSchema = z.object({
  releaseId: z.string(), revision: z.number(), tag: z.string(), branch: z.string(), commit: z.string(),
  remoteUrl: z.string(), ticketCount: z.number(), alreadyTagged: z.boolean(),
});
export const releasePublishSchema = z.object({
  revision: z.number().int().nonnegative(), commit: z.string().regex(/^[a-f0-9]{40,64}$/),
  remoteUrl: z.string().min(1), branch: z.string().min(1),
});
