import { z } from 'zod';
import type { Project, Feature, Task } from './kanban';
import { releaseRecordSchema } from './release';
import { contextFilesSchema } from './contextFile';
import { agentProviderSchema } from './agentProvider';

const id = z.string().min(1);
const timestamp = z.string().datetime({ offset: true });

export const DEFAULT_DOCS_PATH = 'doc';
export const docsPathSchema = z.string().trim().min(1).max(200)
  .transform((value) => value.replace(/\/+$/, ''))
  .refine((value) => value.length > 0 && !value.startsWith('/') && !value.includes('\\') && !value.includes('\0')
    && value.split('/').every((part) => part !== '' && part !== '.' && part !== '..' && part.toLowerCase() !== '.git'),
  'Use a relative folder inside the repository, such as doc or docs/wiki');

export const projectSchema = z.object({
  id, revision: z.number().int().nonnegative().default(0),
  name: z.string().min(1), description: z.string(), color: z.string(),
  icon: z.string().optional(), category: z.string().optional(),
  repositoryUrl: z.string().optional(), repositoryBranch: z.string().optional(),
  repositoryCommit: z.string().optional(),
  docsPath: docsPathSchema.optional(),
  createdAt: timestamp, updatedAt: timestamp,
});

export const repositoryInputSchema = z.object({
  url: z.string().trim().min(1).max(2048),
  branch: z.string().trim().max(255).optional().transform((value) => value || undefined),
  token: z.string().trim().max(4096).optional().transform((value) => value || undefined),
});
export type RepositoryInput = z.input<typeof repositoryInputSchema>;
export const createProjectSchema = projectSchema.extend({ repository: repositoryInputSchema.optional() });
export const localRepositoriesSchema = z.object({ enabled: z.boolean(), folders: z.array(z.string()) });

export const remoteBranchesSchema = z.object({
  defaultBranch: z.string().optional(), branches: z.array(z.string()),
});

export const featureSchema = z.object({
  id, revision: z.number().int().nonnegative().default(0),
  title: z.string().min(1), description: z.string(), category: z.string(),
  status: z.enum(['Backlog', 'To Do', 'In Progress', 'Review', 'Done']).default('Backlog'),
  projectId: id.optional(), targetDate: z.string().optional(),
  color: z.string(), createdAt: timestamp,
});

export const taskSchema = z.object({
  id, revision: z.number().int().nonnegative().default(0),
  title: z.string().min(1), description: z.string(),
  status: z.enum(['Backlog', 'To Do', 'In Progress', 'Review', 'Done']),
  priority: z.enum(['Critical', 'High', 'Medium', 'Low']),
  projectId: id.optional(), featureId: id.optional(), releaseId: id.optional(),
  storyPoints: z.number().nonnegative(), tags: z.array(z.string()),
  subtasks: z.array(z.object({ id, text: z.string(), completed: z.boolean() })),
  acceptanceCriteria: z.array(z.string()), suggestedWorkflow: z.string().optional(),
  blockedReason: z.string().trim().max(2000).default(''),
  contextFiles: contextFilesSchema.default([]),
  agentProvider: agentProviderSchema.default('copilot'),
  agentModel: z.string().trim().min(1).max(200).optional(),
  order: z.number().int(), createdAt: timestamp, updatedAt: timestamp,
}).refine((task) => new Set(task.subtasks.map((subtask) => subtask.id)).size === task.subtasks.length, {
  message: 'Subtask IDs must be unique within a task',
});

export const projectStatsSchema = z.object({
  totalTasks: z.number(), completedTasks: z.number(), inProgressTasks: z.number(),
  completionRate: z.number(), totalFeatures: z.number(),
});
export type ProjectStats = z.infer<typeof projectStatsSchema>;
export const projectSummarySchema = projectSchema.extend({ stats: projectStatsSchema });
export type ProjectSummary = z.infer<typeof projectSummarySchema>;
export const projectBoardSchema = z.object({
  features: z.array(featureSchema), tasks: z.array(taskSchema),
});
export type ProjectBoard = z.infer<typeof projectBoardSchema>;
export const revisionSchema = z.object({ revision: z.number().int().nonnegative() });
export const switchBranchSchema = revisionSchema.extend({ branch: z.string().trim().min(1) });
export const workspaceBranchesSchema = z.object({ current: z.string(), branches: z.array(z.string()) });
export const moveTaskSchema = revisionSchema.extend({
  status: z.enum(['Backlog', 'To Do', 'In Progress', 'Review', 'Done']),
  index: z.number().int().nonnegative().optional(),
});
export const breakdownSchema = z.object({ feature: featureSchema, tasks: z.array(taskSchema) });

export interface BoardData {
  projects: Project[];
  features: Feature[];
  tasks: Task[];
  releases?: z.infer<typeof releaseRecordSchema>[];
}

export interface BoardSnapshot extends BoardData {
  revision: number;
}

export const boardDataSchema = z.object({
  projects: z.array(projectSchema).min(1),
  features: z.array(featureSchema),
  tasks: z.array(taskSchema),
  releases: z.array(releaseRecordSchema).default([]),
}).superRefine((board, ctx) => {
  const report = (message: string) => ctx.addIssue({ code: 'custom', message });
  for (const entities of [board.projects, board.features, board.tasks, board.releases]) {
    if (new Set(entities.map((entity) => entity.id)).size !== entities.length) {
      report('Entity IDs must be unique within each collection');
    }
  }
  const projects = new Set(board.projects.map((project) => project.id));
  const features = new Map(board.features.map((feature) => [feature.id, feature]));
  const releases = new Map(board.releases.map((release) => [release.id, release]));
  if (new Set(board.releases.map((release) => JSON.stringify([release.projectId, release.version]))).size !== board.releases.length) report('Release versions must be unique within a project');
  for (const entity of [...board.features, ...board.tasks, ...board.releases]) {
    if (entity.projectId && !projects.has(entity.projectId)) report('Unknown project');
  }
  for (const task of board.tasks) {
    if (task.releaseId && releases.get(task.releaseId)?.projectId !== task.projectId) report('Unknown release or task and release belong to different projects');
    if (task.featureId) {
      const feature = features.get(task.featureId);
      if (!feature) report('Unknown feature');
      else if (feature.projectId !== task.projectId) report('Task and feature must belong to the same project');
    }
    if (new Set(task.subtasks.map((subtask) => subtask.id)).size !== task.subtasks.length) {
      report('Subtask IDs must be unique within a task');
    }
  }
});

export const boardSnapshotSchema = boardDataSchema.safeExtend({
  revision: z.number().int().nonnegative(),
});

export const legacyBoardSchema = z.object({
  projects: boardDataSchema.shape.projects.optional(),
  features: boardDataSchema.shape.features.optional(),
  tasks: boardDataSchema.shape.tasks.optional(),
}).strict();

// Keep full imports strict; only browser migration fills missing collections and repairs old links.
export const boardInitializationSchema = z.union([
  boardDataSchema,
  z.object({ legacy: legacyBoardSchema }).strict(),
]);
