import { z } from 'zod';
import { taskSchema } from './board';
import { assistantModeInputShape, assistantPlanSchema } from './assistantMode';
import { contextFilesSchema } from './contextFile';

export const taskDraftInputSchema = z.object({
  title: z.string().trim().min(1).max(1000),
  currentDescription: z.string().max(50_000).default(''),
  featureTitle: z.string().max(1000).optional(),
  priority: taskSchema.shape.priority.default('Medium'),
  agentModel: taskSchema.shape.agentModel,
  acceptanceCriteria: z.array(z.string().max(5000)).max(100).default([]),
  subtasks: z.array(z.string().max(5000)).max(100).default([]),
  suggestedWorkflow: z.string().max(10_000).default(''),
  tags: z.array(z.string().max(200)).max(100).default([]),
  contextFiles: contextFilesSchema.default([]),
  ...assistantModeInputShape,
});

export const taskDraftProposalSchema = z.object({
  title: z.string().trim().min(1).max(1000),
  description: z.string().trim().min(1).max(50_000),
  acceptanceCriteria: z.array(z.string().trim().min(1).max(5000)).min(1).max(100),
  subtasks: z.array(z.string().trim().min(1).max(5000)).min(1).max(100),
  suggestedWorkflow: z.string().trim().min(1).max(10_000),
  estimatedStoryPoints: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(5), z.literal(8)]),
  suggestedTags: z.array(z.string().trim().min(1).max(200)).max(100),
  impactAnalysis: z.string().trim().min(1).max(20_000),
});

/** Auto-Spec returns either the specification or, when a plan is needed or requested, a plan to confirm. */
export const taskDraftResultSchema = z.discriminatedUnion('kind', [
  taskDraftProposalSchema.extend({ kind: z.literal('proposal'), graphAvailable: z.boolean() }),
  assistantPlanSchema.extend({ kind: z.literal('plan'), graphAvailable: z.boolean() }),
]);
export type TaskDraftInput = z.infer<typeof taskDraftInputSchema>;
export type TaskDraftResult = z.infer<typeof taskDraftResultSchema>;
export type TaskDraftSpecification = Extract<TaskDraftResult, { kind: 'proposal' }>;
