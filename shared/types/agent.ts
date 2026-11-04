import { z } from 'zod';
import { taskSchema, projectSchema, featureSchema } from './board';

export const agentOptionsSchema = z.object({
  providers: z.array(z.object({
    id: z.literal('copilot'), name: z.string(),
    defaultModel: z.string().nullable(),
    models: z.array(z.object({ id: z.string(), name: z.string() })),
  })),
});
export type AgentOptions = z.infer<typeof agentOptionsSchema>;
import { agentPhaseSchema, agentWorkflowSchema } from './workflow';

export const agentContextSchema = z.object({
  task: taskSchema,
  project: projectSchema.nullable(),
  feature: featureSchema.nullable(),
});
export type AgentContext = z.infer<typeof agentContextSchema>;

export const agentQuestionInputSchema = z.object({
  question: z.string().min(1).max(10_000),
  choices: z.array(z.string().min(1).max(2000)).max(20).default([]),
  allowFreeform: z.boolean().default(true),
});
export type AgentQuestionInput = z.infer<typeof agentQuestionInputSchema>;
export const agentQuestionSchema = agentQuestionInputSchema.extend({
  id: z.string(), answer: z.string().nullable(), createdAt: z.string(), answeredAt: z.string().nullable(),
});
export const agentStatusSchema = z.enum(['queued', 'planning', 'awaiting_input', 'awaiting_approval', 'execution_queued', 'executing', 'completed', 'failed', 'cancelling', 'cancelled', 'delivering']);
export const deliverySchema = z.object({
  id: z.string(), attempt: z.number(), status: z.enum(['committing', 'committed', 'merging', 'delivered', 'failed']),
  targetBranch: z.string(), targetHead: z.string(), ticketHead: z.string(), tree: z.string(),
  reviewToken: z.string(), message: z.string(), acknowledgeChecks: z.boolean(),
  commitHash: z.string().nullable(), mergeHash: z.string().nullable(),
  error: z.string(), createdAt: z.string(), updatedAt: z.string(),
});
export const deliveryPreviewSchema = z.object({
  sessionId: z.string(), updatedAt: z.string(), targetBranch: z.string(), targetHead: z.string(),
  ticketHead: z.string(), tree: z.string(), reviewToken: z.string(),
  projectName: z.string(), clonePath: z.string(), warnings: z.array(z.string()),
  fileCount: z.number(), suggestedMessage: z.string(), delivery: deliverySchema.nullable(),
});
export const deliveryHistoryQuerySchema = z.object({
  projectId: z.string().optional(),
  status: z.enum(['committing', 'committed', 'merging', 'delivered', 'failed']).optional(),
  search: z.string().trim().max(200).default(''),
  page: z.coerce.number().int().min(1).default(1),
});
export const deliveryHistorySchema = z.object({
  items: z.array(z.object({
    id: z.string(), sessionId: z.string(), taskId: z.string(), taskTitle: z.string(),
    projectId: z.string(), projectName: z.string(), featureTitle: z.string().nullable(),
    releaseVersion: z.string().nullable(), attempt: z.number().int(), status: z.enum(['committing', 'committed', 'merging', 'delivered', 'failed']),
    targetBranch: z.string(), commitHash: z.string().nullable(), mergeHash: z.string().nullable(),
    error: z.string(), createdAt: z.string(), updatedAt: z.string(),
  })),
  total: z.number().int().nonnegative(), page: z.number().int().positive(), pageSize: z.number().int().positive(),
});
export const sessionActionFocusSchema = z.enum(['answer', 'approve', 'retry', 'review', 'deliver']);
export type SessionActionFocus = z.infer<typeof sessionActionFocusSchema>;
export const deliveryRequestSchema = z.object({
  sessionId: z.string().uuid(), updatedAt: z.string().datetime(),
  targetHead: z.string().regex(/^[a-f0-9]{40,64}$/),
  ticketHead: z.string().regex(/^[a-f0-9]{40,64}$/),
  tree: z.string().regex(/^[a-f0-9]{40,64}$/),
  reviewToken: z.string().regex(/^[a-f0-9]{64}$/),
  acknowledgeChecks: z.boolean(),
  message: z.string().trim().min(1).max(4000).refine((value) => !value.includes('\0'), 'Invalid commit message'),
});
export type DeliveryRequest = z.infer<typeof deliveryRequestSchema>;
export const publicationSnapshotSchema = z.object({
  taskId: z.string(), sessionId: z.string().uuid(), updatedAt: z.string().datetime(),
  reviewToken: z.string().regex(/^[a-f0-9]{64}$/),
  tree: z.string().regex(/^[a-f0-9]{40,64}$/),
  ticketHead: z.string().regex(/^[a-f0-9]{40,64}$/),
});
export const publicationPreviewSchema = z.object({
  branch: z.string(), origin: z.string(), featureRevision: z.number().int().nullable(),
  tasks: z.array(publicationSnapshotSchema).min(1),
  warnings: z.array(z.string()),
});
export const publicationRequestSchema = publicationPreviewSchema.omit({ warnings: true }).extend({ acknowledgeChecks: z.boolean() });
export type PublicationRequest = z.infer<typeof publicationRequestSchema>;
export const publicationSchema = z.object({
  branch: z.string(), status: z.string(), commitHash: z.string(), error: z.string(),
});
export const checkResultSchema = z.object({
  id: z.string(), attempt: z.number(), script: z.enum(['test', 'lint']),
  passed: z.boolean(), output: z.string(), createdAt: z.string(),
});
export const agentRuntimeEventSchema = z.object({
  id: z.string(), type: z.string(), timestamp: z.string(),
  data: z.record(z.string(), z.json()),
}).catchall(z.json());
export const agentRuntimeSchema = z.object({
  id: z.string(), phase: z.enum(['plan', 'execute', 'review']),
  sessionId: z.string().optional(), attempt: z.number().int().positive().optional(),
  providerSessionId: z.string().nullable(),
  status: z.enum(['running', 'completed', 'failed', 'cancelled']),
  startedAt: z.string(), endedAt: z.string().nullable(), error: z.string(),
  metadata: z.record(z.string(), z.json()),
  events: z.array(agentRuntimeEventSchema),
});
export type AgentRuntime = z.infer<typeof agentRuntimeSchema>;
export const agentOverviewSchema = z.object({
  runtimeId: z.string(), phase: agentRuntimeSchema.shape.phase, status: agentRuntimeSchema.shape.status,
  provider: z.string(), model: z.string().nullable(), subagents: z.array(z.string()),
  context: z.object({ used: z.number(), limit: z.number() }).nullable(),
  quota: z.object({
    type: z.string(), used: z.number().nullable(), entitlement: z.number().nullable(),
    remainingPercentage: z.number().nullable(), unlimited: z.boolean(),
    resetDate: z.string().nullable(), observedAt: z.string().nullable(),
  }).nullable(),
});
export type AgentOverview = z.infer<typeof agentOverviewSchema>;
export const attemptSnapshotSchema = z.object({
  status: agentStatusSchema, plan: z.string(), output: z.string(), error: z.string(),
  resumeStatus: agentPhaseSchema,
  feedback: z.string().default(''), reviewStatus: z.string().default('pending'),
  reviewToken: z.string().default(''), context: agentContextSchema.optional(),
  questions: z.array(agentQuestionSchema), checks: z.array(checkResultSchema),
  delivery: deliverySchema.nullable().optional(),
  publication: publicationSchema.nullable().optional(),
  runtimes: z.array(agentRuntimeSchema).default([]),
  sessionInfo: z.record(z.string(), z.json()).optional(),
});

export const agentSessionSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  projectId: z.string().nullable().default(null),
  releaseId: z.string().nullable().default(null),
  provider: z.string(),
  status: agentStatusSchema,
  resumeStatus: agentPhaseSchema,
  autoExecute: z.boolean().default(false),
  taskRevision: z.number(),
  workspace: z.string().nullable(),
  branch: z.string().nullable(),
  baseCommit: z.string().nullable(),
  providerSessionId: z.string().nullable(),
  plan: z.string(),
  output: z.string(),
  error: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  questions: z.array(agentQuestionSchema).default([]),
  attempt: z.number().default(1),
  feedback: z.string().default(''),
  reviewStatus: z.enum(['pending', 'accepted', 'changes_requested']).default('pending'),
  reviewToken: z.string().default(''),
  checks: z.array(checkResultSchema).default([]),
  attempts: z.array(z.object({ number: z.number(), createdAt: z.string(), snapshot: attemptSnapshotSchema })).default([]),
  delivery: deliverySchema.nullable().default(null),
  publication: publicationSchema.nullable().default(null),
  context: agentContextSchema.optional(),
  runtimes: z.array(agentRuntimeSchema).default([]),
});
export type AgentSession = z.infer<typeof agentSessionSchema>;

export const agentListQuerySchema = z.object({
  projectId: z.string().optional(), featureId: z.string().optional(),
  status: agentStatusSchema.optional(), priority: z.enum(['Critical', 'High', 'Medium', 'Low']).optional(),
  search: z.string().max(200).default(''),
  page: z.coerce.number().int().min(1).default(1),
  actionable: z.enum(['true', 'cockpit']).optional(),
});
export type AgentListQuery = z.input<typeof agentListQuerySchema>;
export const agentSummarySchema = agentSessionSchema.omit({ plan: true, output: true, questions: true, attempts: true, checks: true, feedback: true, reviewToken: true, delivery: true, context: true, runtimes: true }).extend({
  taskTitle: z.string(), taskStatus: z.string(), priority: z.string(),
  projectId: z.string().nullable(), projectName: z.string().nullable(),
  featureId: z.string().nullable(), featureTitle: z.string().nullable(),
  deliveryStatus: z.string().nullable().default(null),
  workflow: agentWorkflowSchema.optional(),
  agent: agentOverviewSchema.nullable().default(null),
});

export const reviewSchema = z.object({
  token: z.string(), baseCommit: z.string(), criteria: z.array(z.string()),
  documentation: z.object({ path: z.string(), ready: z.boolean() }).optional(),
  files: z.array(z.object({
    path: z.string(), status: z.string(), patch: z.string(),
    binary: z.boolean(), truncated: z.boolean(),
  })),
});
export const aiReviewResultSchema = z.object({ token: z.string().regex(/^[a-f0-9]{64}$/), report: z.string().min(1).max(30_000) });
export const projectHealthSchema = z.object({
  projectName: z.string(), branch: z.string().nullable(), commit: z.string().nullable(),
  scripts: z.array(z.string()), provider: z.string(), authenticated: z.boolean().nullable(),
  issues: z.array(z.string()),
  worktrees: z.array(z.object({ path: z.string(), branch: z.string(), status: z.string(), taskId: z.string(), sessionId: z.string(), updatedAt: z.string() })),
});
export const agentListSchema = z.object({
  items: z.array(agentSummarySchema), total: z.number(), page: z.number(), pageSize: z.number(),
  actionCount: z.number().default(0),
  projects: z.array(z.object({ id: z.string(), name: z.string() })),
  features: z.array(z.object({ id: z.string(), title: z.string(), projectId: z.string().nullable() })),
});
