import { z } from 'zod';

export const activityEntityTypeSchema = z.enum(['project', 'feature', 'task', 'release']);
export const activityChangesSchema = z.array(z.object({
  field: z.string(),
  before: z.string().nullable(),
  after: z.string().nullable(),
}));
export const activityEventSchema = z.object({
  id: z.string(), projectId: z.string().nullable(), projectName: z.string(),
  entityType: activityEntityTypeSchema, entityId: z.string(), entityTitle: z.string(),
  action: z.string(), summary: z.string(), actor: z.string(),
  changes: activityChangesSchema, createdAt: z.string(),
});
export const activityQuerySchema = z.object({
  projectId: z.string().optional(),
  entityType: activityEntityTypeSchema.optional(),
  search: z.string().trim().max(200).default(''),
  page: z.coerce.number().int().min(1).default(1),
});
export const activityListSchema = z.object({
  items: z.array(activityEventSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
});
export type ActivityEvent = z.infer<typeof activityEventSchema>;
export type ActivityQuery = z.input<typeof activityQuerySchema>;
