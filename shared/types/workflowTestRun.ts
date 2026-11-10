import { z } from 'zod';
import { workflowDocumentSchema, workflowScopeSchema } from './workflowEditor';

export const workflowJsonObjectSchema = z.record(z.string(), z.json()).superRefine((value, ctx) => {
  if (JSON.stringify(value).length > 64_000) ctx.addIssue({ code: 'custom', message: 'JSON exceeds 64,000 characters.' });
});
export const workflowTestAgentSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('real') }).strict(),
  z.object({
    mode: z.literal('mock'), delayMs: z.number().int().min(0).max(30_000),
    response: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('output'), output: workflowJsonObjectSchema }).strict(),
      z.object({ kind: z.literal('error'), error: z.string().trim().min(1).max(2000) }).strict(),
    ]),
  }).strict(),
]);
export const workflowTestLaunchSchema = z.object({
  versionId: z.string().uuid(),
  input: workflowJsonObjectSchema,
  agents: z.record(z.string(), workflowTestAgentSchema),
  authorizeRealAgents: z.boolean(),
}).strict().superRefine((value, ctx) => {
  if (Object.keys(value.agents).length > 100 || JSON.stringify(value).length > 256_000) {
    ctx.addIssue({ code: 'custom', message: 'Test configuration exceeds 100 agent steps or 256,000 characters.' });
  }
});
export type WorkflowTestLaunch = z.infer<typeof workflowTestLaunchSchema>;
export type WorkflowJsonObject = z.infer<typeof workflowJsonObjectSchema>;
export type WorkflowTestAgent = z.infer<typeof workflowTestAgentSchema>;
export const workflowTestStepSchema = z.object({
  nodeId: z.string(), status: z.enum(['pending', 'running', 'waiting', 'completed', 'failed', 'skipped', 'cancelled']),
  mode: z.enum(['real', 'mock', 'control']),
  input: workflowJsonObjectSchema.optional(), output: workflowJsonObjectSchema.optional(),
  error: z.string().optional(), note: z.string().optional(),
  startedAt: z.string().optional(), finishedAt: z.string().optional(),
});
export const workflowTestRunSchema = z.object({
  id: z.string().uuid(), scope: workflowScopeSchema, revision: z.number().int().nonnegative(),
  versionId: z.string().uuid(), versionNumber: z.number().int().positive(),
  document: workflowDocumentSchema, configuration: workflowTestLaunchSchema,
  status: z.enum(['running', 'waiting', 'completed', 'failed', 'cancelled']),
  steps: z.array(workflowTestStepSchema), error: z.string().optional(),
  createdAt: z.string(), updatedAt: z.string(), previewOnly: z.literal(true),
});
export type WorkflowTestRun = z.infer<typeof workflowTestRunSchema>;
export type WorkflowTestStep = z.infer<typeof workflowTestStepSchema>;
