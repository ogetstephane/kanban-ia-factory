import { Prisma, PrismaClient, type Project as DbProject, type Feature as DbFeature } from '@prisma/client';
import { z } from 'zod';
import {
  DEFAULT_DOCS_PATH, projectSchema, featureSchema, taskSchema, type ProjectSummary, type ProjectStats,
  moveTaskSchema, breakdownSchema,
} from '../../src/types/board';
import { canCreateTaskIn, canMoveTask, CREATION_STATUSES, moveTask, transitionError } from '../../src/utils/kanbanLogic';
import { enqueueTicket } from '../agents/queue';
import { activityChanges, recordActivity } from './activityLog';
import { contextFilesSchema } from '../../src/types/contextFile';

function contextFileChanges(before: unknown, after: unknown) {
  if (JSON.stringify(before ?? []) === JSON.stringify(after ?? [])) return [];
  const names = (value: unknown) => contextFilesSchema.parse(value ?? []).map((file) => file.name).join(', ') || null;
  return [{ field: 'Context files', before: names(before), after: names(after) }];
}

type Project = z.infer<typeof projectSchema>;
type Feature = z.infer<typeof featureSchema>;
type Task = z.infer<typeof taskSchema>;
const taskInclude = { subtasks: { orderBy: { position: 'asc' as const } } };
type DbTask = Prisma.TaskGetPayload<{ include: typeof taskInclude }>;
export const projectData = (value: DbProject) => projectSchema.parse({
  ...value, icon: value.icon ?? undefined, category: value.category ?? undefined,
  repositoryUrl: value.repositoryUrl ?? undefined, repositoryBranch: value.repositoryBranch ?? undefined,
  repositoryCommit: value.repositoryCommit ?? undefined,
  docsPath: value.docsPath ?? (value.repositoryUrl ? DEFAULT_DOCS_PATH : undefined),
});
export const featureData = (value: DbFeature) => featureSchema.parse({
  ...value, projectId: value.projectId ?? undefined, targetDate: value.targetDate ?? undefined,
});
export const taskData = (value: DbTask) => taskSchema.parse({
  ...value, projectId: value.projectId ?? undefined, featureId: value.featureId ?? undefined,
  releaseId: value.releaseId ?? undefined,
  suggestedWorkflow: value.suggestedWorkflow ?? undefined,
});

export class EntityError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export async function ensureNoActiveSessions(tx: Prisma.TransactionClient, where: Prisma.AgentSessionWhereInput = {}) {
  if (await tx.release.count({ where: { publishing: true } })) {
    throw new EntityError(409, 'A release tag is being published. Wait for publication to finish before changing context.');
  }
  if (await tx.agentSession.count({
    where: { ...where, status: { in: ['queued', 'planning', 'awaiting_input', 'execution_queued', 'executing', 'cancelling', 'delivering'] } },
  })) throw new EntityError(409, 'An AI session is queued or running. Wait for it to finish before changing or deleting its context.');
}

export async function checkReleaseAssignment(tx: Prisma.TransactionClient, projectId: string | undefined, releaseId: string | undefined, previous?: string | null) {
  if ((previous ?? undefined) === releaseId) return;
  for (const id of new Set([previous, releaseId].filter((value): value is string => !!value))) {
    const release = await tx.release.findUnique({ where: { id } });
    if (!release || release.projectId !== projectId) throw new EntityError(400, 'Task and release must belong to the same project');
    if (release.publishing || release.status === 'published' ||
        (id === releaseId && (release.status === 'cancelled' || !!release.targetCommit)) ||
        (id !== releaseId && !!release.targetCommit && release.status !== 'cancelled')) {
      throw new EntityError(409, 'Tickets cannot be added to or removed from a published, cancelled or publication-pinned release');
    }
    await tx.release.update({ where: { id }, data: { revision: { increment: 1 }, updatedAt: new Date().toISOString() } });
  }
}

export async function assignNextRelease(tx: Prisma.TransactionClient, projectId: string) {
  const release = await tx.release.findFirst({ where: {
    projectId, status: 'upcoming', publishing: false, targetCommit: null,
  }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  if (!release) return;
  const assigned = await tx.task.updateMany({ where: { projectId, releaseId: null }, data: {
    releaseId: release.id, revision: { increment: 1 }, updatedAt: new Date().toISOString(),
  } });
  if (assigned.count) {
    await tx.release.update({ where: { id: release.id }, data: { revision: { increment: 1 }, updatedAt: new Date().toISOString() } });
    await recordActivity(tx, { projectId, entityType: 'release', entityId: release.id, entityTitle: `v${release.version}`,
      action: 'tickets_assigned', summary: `Assigned ${assigned.count} unassigned ticket(s) to the next upcoming release` });
  }
}

function checkRevision(current: { revision: number } | null, revision: number) {
  if (!current) throw new EntityError(404, 'Entity not found. It may have been deleted.');
  if (current.revision !== revision) {
    throw new EntityError(409, 'This entity changed in another client. Reopen it to load the latest version; your draft has been kept.');
  }
}

async function checkProject(tx: Prisma.TransactionClient, id: string | undefined) {
  if (id && !await tx.project.findUnique({ where: { id }, select: { id: true } })) {
    throw new EntityError(400, 'Unknown project');
  }
}

async function checkFeature(tx: Prisma.TransactionClient, task: Task): Promise<Feature | null> {
  await checkProject(tx, task.projectId);
  if (!task.featureId) return null;
  const feature = await tx.feature.findUnique({ where: { id: task.featureId } });
  if (!feature || (feature.projectId ?? undefined) !== task.projectId) {
    throw new EntityError(400, 'Task and feature must belong to the same project');
  }
  return featureData(feature);
}

async function createFeature(tx: Prisma.TransactionClient, feature: Feature) {
  await checkProject(tx, feature.projectId);
  const first = await tx.feature.aggregate({ _min: { position: true } });
  const created = featureData(await tx.feature.create({ data: {
    ...feature, revision: 0, position: (first._min.position ?? 0) - 1,
  } }));
  await recordActivity(tx, {
    projectId: created.projectId, entityType: 'feature', entityId: created.id, entityTitle: created.title,
    action: 'created', summary: 'Feature created', changes: activityChanges(null, created, [
      { key: 'title', label: 'Title' }, { key: 'category', label: 'Category' },
    ]),
  });
  return created;
}

function checkTransition(from: Task['status'], to: Task['status'], entity = 'task') {
  if (!canMoveTask(from, to)) throw new EntityError(422, transitionError(from, to, entity));
}

async function queueExecution(tx: Prisma.TransactionClient, previous: string, task: Task, provider: string, autoExecute = false) {
  if (task.status !== 'In Progress' || (previous === task.status && !autoExecute)) return;
  const project = task.projectId ? await tx.project.findUnique({ where: { id: task.projectId } }) : null;
  const feature = task.featureId ? await tx.feature.findUnique({ where: { id: task.featureId } }) : null;
  await enqueueTicket(tx, {
    task, project: project ? projectData(project) : null, feature: feature ? featureData(feature) : null,
  }, provider, autoExecute);
}

export async function advanceEpicToReviewIfComplete(tx: Prisma.TransactionClient, featureId: string) {
  const feature = await tx.feature.findUnique({ where: { id: featureId } });
  if (!feature || feature.status !== 'In Progress') return;
  const [total, remaining, reviewing] = await Promise.all([
    tx.task.count({ where: { featureId } }),
    tx.task.count({ where: { featureId, status: { not: 'Done' } } }),
    tx.task.count({ where: { featureId, status: 'Review' } }),
  ]);
  const singleTicketReview = total === 1 && reviewing === 1;
  if (total === 0 || (remaining !== 0 && !singleTicketReview)) return;
  const updated = await tx.feature.updateMany({
    where: { id: featureId, status: 'In Progress', revision: feature.revision },
    data: { status: 'Review', revision: { increment: 1 } },
  });
  if (!updated.count) return;
  const saved = featureData(await tx.feature.findUniqueOrThrow({ where: { id: featureId } }));
  await recordActivity(tx, {
    projectId: saved.projectId, entityType: 'feature', entityId: saved.id, entityTitle: saved.title,
    action: 'status_changed', summary: singleTicketReview
      ? 'The only epic ticket is ready for review; epic moved to Review'
      : 'All epic tickets are Done; epic moved to Review',
    changes: [{ field: 'Status', before: 'In Progress', after: 'Review' }],
  });
}

async function createTask(tx: Prisma.TransactionClient, task: Task, provider: string) {
  if (!task.releaseId && task.projectId) {
    const next = await tx.release.findFirst({ where: { projectId: task.projectId, status: 'upcoming', publishing: false, targetCommit: null },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
    if (next) task = { ...task, releaseId: next.id };
  }
  const feature = await checkFeature(tx, task);
  if (feature) {
    if (['Review', 'Done'].includes(feature.status)) {
      throw new EntityError(409, 'Tickets cannot be added to an epic that is in Review or Done.');
    }
    if (task.status !== feature.status) {
      throw new EntityError(409, `A new ticket in this epic must start in ${feature.status}.`);
    }
  } else if (!canCreateTaskIn(task.status)) {
    throw new EntityError(422, `New tasks must start in ${CREATION_STATUSES.join(' or ')}`);
  }
  await checkReleaseAssignment(tx, task.projectId, task.releaseId);
  const { subtasks, ...fields } = task;
  const first = await tx.task.aggregate({ _min: { position: true } });
  const created = taskData(await tx.task.create({
    data: {
      ...fields, revision: 0, position: (first._min.position ?? 0) - 1,
      subtasks: { create: subtasks.map((subtask, position) => ({ ...subtask, position })) },
    },
    include: taskInclude,
  }));
  await recordActivity(tx, {
    projectId: created.projectId, entityType: 'task', entityId: created.id, entityTitle: created.title,
    action: 'created', summary: 'Ticket created', changes: activityChanges(null, created, [
      { key: 'title', label: 'Title' }, { key: 'status', label: 'Status' },
      { key: 'priority', label: 'Priority' }, { key: 'storyPoints', label: 'Story points' },
    ]).concat(contextFileChanges([], created.contextFiles)),
  });
  if (feature?.status === 'In Progress') await queueExecution(tx, '', created, provider, true);
  return created;
}

export class EntityStore {
  constructor(private readonly db: PrismaClient, private readonly agentProvider = 'copilot') {}

  gitProjects(projectId?: string) {
    return this.db.project.findMany({
      where: { id: projectId, repositoryUrl: { not: null } }, orderBy: [{ position: 'asc' }, { id: 'asc' }],
      select: {
        id: true, name: true, repositoryUrl: true, repositoryBranch: true,
        tasks: { where: { agentSession: { isNot: null } }, select: {
          id: true, title: true, status: true,
          agentSession: { select: { workspace: true, branch: true, status: true } },
        } },
      },
    });
  }

  async projects(): Promise<ProjectSummary[] | null> {
    return this.db.$transaction(async (tx) => {
      if (!await tx.board.findUnique({ where: { id: 'board' } })) return null;
      const projects = await tx.project.findMany({ orderBy: { position: 'asc' } });
      const counts = await tx.task.groupBy({ by: ['projectId', 'status'], _count: true });
      const features = await tx.feature.groupBy({ by: ['projectId'], _count: true });
      return projects.map((project) => {
        const stats: ProjectStats = {
          totalTasks: 0, completedTasks: 0, inProgressTasks: 0,
          completionRate: 0, totalFeatures: features.find((row) => row.projectId === project.id)?._count ?? 0,
        };
        for (const count of counts) {
          if (count.projectId !== project.id && count.projectId !== null) continue;
          stats.totalTasks += count._count;
          if (count.status === 'Done') stats.completedTasks += count._count;
          if (['In Progress', 'Review'].includes(count.status)) stats.inProgressTasks += count._count;
        }
        stats.totalFeatures += features.find((row) => row.projectId === null)?._count ?? 0;
        stats.completionRate = stats.totalTasks ? Math.round(stats.completedTasks / stats.totalTasks * 100) : 0;
        return { ...projectData(project), stats };
      });
    });
  }

  board(projectId?: string) {
    return this.db.$transaction(async (tx) => {
      if (projectId !== undefined && !await tx.project.findUnique({ where: { id: projectId } })) throw new EntityError(404, 'Project not found');
      const where = projectId === undefined ? {} : { OR: [{ projectId }, { projectId: null }] };
      return {
        features: (await tx.feature.findMany({ where, orderBy: { position: 'asc' } })).map(featureData),
        tasks: (await tx.task.findMany({ where, orderBy: { position: 'asc' }, include: taskInclude })).map(taskData),
      };
    });
  }

  createProject(project: Project) {
    return this.db.$transaction(async (tx) => {
      const last = await tx.project.aggregate({ _max: { position: true } });
      const created = projectData(await tx.project.create({ data: {
        ...project, revision: 0, position: (last._max.position ?? -1) + 1,
      } }));
      await recordActivity(tx, {
        projectId: created.id, projectName: created.name, entityType: 'project', entityId: created.id,
        entityTitle: created.name, action: 'created', summary: 'Project created',
        changes: activityChanges(null, created, [{ key: 'name', label: 'Name' }, { key: 'category', label: 'Category' }]),
      });
      return created;
    });
  }

  updateProject(project: Project) {
    // Repository fields are set only by a server-side clone, never by clients.
    const { repositoryUrl: _url, repositoryBranch: _branch, repositoryCommit: _commit, docsPath, ...fields } = project;
    return this.db.$transaction(async (tx) => {
      await ensureNoActiveSessions(tx, { task: { projectId: project.id } });
      const previous = await tx.project.findUnique({ where: { id: project.id } });
      checkRevision(previous, project.revision);
      const saved = projectData(await tx.project.update({ where: { id: project.id, revision: project.revision }, data: {
        ...fields, icon: project.icon ?? null, category: project.category ?? null,
        docsPath: previous?.repositoryUrl ? docsPath ?? DEFAULT_DOCS_PATH : null,
        revision: { increment: 1 },
      } }));
      const changes = activityChanges(previous ? projectData(previous) : null, saved, [
        { key: 'name', label: 'Name' }, { key: 'category', label: 'Category' }, { key: 'docsPath', label: 'Docs folder' },
      ]);
      if (changes.length) await recordActivity(tx, {
        projectId: saved.id, projectName: saved.name, entityType: 'project', entityId: saved.id,
        entityTitle: saved.name, action: 'updated', summary: 'Project updated', changes,
      });
      return saved;
    });
  }

  async project(id: string) {
    const project = await this.db.project.findUnique({ where: { id } });
    if (!project) throw new EntityError(404, 'Project not found');
    return projectData(project);
  }

  async checkedProject(id: string, revision: number) {
    const project = await this.db.project.findUnique({ where: { id } });
    checkRevision(project, revision);
    return projectData(project!);
  }

  /** Records the branch checked out in the project's clone (server-side only). */
  setProjectBranch(id: string, revision: number, branch: string, commit?: string) {
    return this.db.$transaction(async (tx) => {
      const previous = await tx.project.findUnique({ where: { id } });
      checkRevision(previous, revision);
      const saved = projectData(await tx.project.update({ where: { id, revision }, data: {
        repositoryBranch: branch, repositoryCommit: commit ?? null, revision: { increment: 1 },
      } }));
      if (previous?.repositoryBranch !== saved.repositoryBranch) await recordActivity(tx, {
        projectId: saved.id, projectName: saved.name, entityType: 'project', entityId: saved.id,
        entityTitle: saved.name, action: 'branch_changed', summary: 'Project branch changed',
        changes: activityChanges(previous, saved, [{ key: 'repositoryBranch', label: 'Branch' }]),
      });
      return saved;
    });
  }

  deleteProject(id: string, revision: number) {
    return this.db.$transaction(async (tx) => {
      await ensureNoActiveSessions(tx, { task: { projectId: id } });
      const project = await tx.project.findUnique({ where: { id } });
      checkRevision(project, revision);
      if (await tx.project.count() <= 1) throw new EntityError(400, 'Keep at least one project');
      const [tasks, features, releases] = await Promise.all([
        tx.task.findMany({ where: { projectId: id }, select: { id: true, title: true } }),
        tx.feature.findMany({ where: { projectId: id }, select: { id: true, title: true } }),
        tx.release.findMany({ where: { projectId: id }, select: { id: true, version: true } }),
      ]);
      for (const task of tasks) await recordActivity(tx, {
        projectId: id, projectName: project!.name, entityType: 'task', entityId: task.id, entityTitle: task.title,
        action: 'deleted', summary: 'Ticket deleted with its project',
      });
      for (const feature of features) await recordActivity(tx, {
        projectId: id, projectName: project!.name, entityType: 'feature', entityId: feature.id, entityTitle: feature.title,
        action: 'deleted', summary: 'Feature deleted with its project',
      });
      for (const release of releases) await recordActivity(tx, {
        projectId: id, projectName: project!.name, entityType: 'release', entityId: release.id,
        entityTitle: `v${release.version}`, action: 'deleted', summary: 'Release deleted with its project',
      });
      await recordActivity(tx, {
        projectId: id, projectName: project!.name, entityType: 'project', entityId: id,
        entityTitle: project!.name, action: 'deleted', summary: 'Project deleted',
      });
      await tx.task.deleteMany({ where: { projectId: id } });
      await tx.project.delete({ where: { id, revision } });
    });
  }

  createFeature(feature: Feature) {
    return this.db.$transaction((tx) => createFeature(tx, feature));
  }

  updateFeature(feature: Feature) {
    return this.db.$transaction(async (tx) => {
      const existing = await tx.feature.findUnique({ where: { id: feature.id } });
      checkRevision(existing, feature.revision);
      if (existing?.projectId !== (feature.projectId ?? null)) {
        throw new EntityError(400, 'Move a feature by creating it in the target project');
      }
      if (existing) {
        const previous = featureData(existing);
        if (previous.status !== feature.status) {
          checkTransition(previous.status, feature.status, 'epic');
          await ensureNoActiveSessions(tx, { task: { featureId: feature.id } });
          if (feature.status === 'Review') {
            const tasks = await tx.task.findMany({ where: { featureId: feature.id }, select: { status: true } });
            if (tasks.some((task) => task.status !== 'Done') && !(tasks.length === 1 && tasks[0].status === 'Review')) {
              throw new EntityError(409, 'All tickets in the epic must be Done before it can enter Review, unless its only ticket is already in Review.');
            }
          }
        }
        if (previous.title !== feature.title || previous.description !== feature.description ||
            previous.category !== feature.category || previous.color !== feature.color ||
            previous.targetDate !== feature.targetDate) {
          await ensureNoActiveSessions(tx, { task: { featureId: feature.id } });
        }
      }
      const saved = featureData(await tx.feature.update({ where: { id: feature.id, revision: feature.revision }, data: {
        ...feature, targetDate: feature.targetDate ?? null, revision: { increment: 1 },
      } }));
      const changes = activityChanges(existing, saved, [
        { key: 'title', label: 'Title' }, { key: 'category', label: 'Category' },
        { key: 'status', label: 'Status' }, { key: 'targetDate', label: 'Target date' },
      ]);
      if (changes.length) await recordActivity(tx, {
        projectId: saved.projectId, entityType: 'feature', entityId: saved.id, entityTitle: saved.title,
        action: 'updated', summary: 'Feature updated', changes,
      });
      if (existing && existing.status !== saved.status &&
          ['Backlog', 'To Do', 'In Progress'].includes(saved.status)) {
        const linkedTasks = await tx.task.findMany({
          where: { featureId: saved.id }, orderBy: [{ order: 'asc' }, { position: 'asc' }], include: taskInclude,
        });
        for (const row of linkedTasks) {
          const previous = taskData(row);
          const updated = taskData(await tx.task.update({
            where: { id: row.id },
            data: { status: saved.status, revision: { increment: 1 }, updatedAt: new Date().toISOString() },
            include: taskInclude,
          }));
          if (previous.status !== updated.status) {
            await recordActivity(tx, {
              projectId: updated.projectId, entityType: 'task', entityId: updated.id, entityTitle: updated.title,
              action: 'status_changed', summary: `Ticket status followed epic "${saved.title}" to ${saved.status}`,
              changes: [{ field: 'Status', before: previous.status, after: updated.status }],
            });
          }
          if (saved.status === 'In Progress') await queueExecution(tx, previous.status, updated, this.agentProvider, true);
        }
      }
      return saved;
    });
  }

  deleteFeature(id: string, revision: number) {
    return this.db.$transaction(async (tx) => {
      await ensureNoActiveSessions(tx, { task: { featureId: id } });
      const feature = await tx.feature.findUnique({ where: { id } });
      checkRevision(feature, revision);
      const linkedTasks = await tx.task.findMany({ where: { featureId: id }, select: { id: true, title: true, projectId: true } });
      await tx.task.updateMany({
        where: { featureId: id }, data: { featureId: null, revision: { increment: 1 } },
      });
      await tx.feature.delete({ where: { id, revision } });
      for (const task of linkedTasks) await recordActivity(tx, {
        projectId: task.projectId, entityType: 'task', entityId: task.id, entityTitle: task.title,
        action: 'updated', summary: `Parent feature "${feature!.title}" removed`,
        changes: [{ field: 'Feature', before: feature!.title, after: null }],
      });
      await recordActivity(tx, {
        projectId: feature?.projectId, entityType: 'feature', entityId: id, entityTitle: feature!.title,
        action: 'deleted', summary: 'Feature deleted',
      });
    });
  }

  createTask(task: Task) {
    return this.db.$transaction((tx) => createTask(tx, task, this.agentProvider));
  }

  updateTask(task: Task) {
    return this.db.$transaction(async (tx) => {
      await ensureNoActiveSessions(tx, { taskId: task.id });
      const existing = await tx.task.findUnique({ where: { id: task.id } });
      checkRevision(existing, task.revision);
      if (existing?.projectId !== (task.projectId ?? null)) throw new EntityError(400, 'Task project cannot be changed');
      const feature = await checkFeature(tx, task);
      if (existing!.featureId !== task.featureId && feature) {
        if (['Review', 'Done'].includes(feature.status)) {
          throw new EntityError(409, 'Tickets cannot be added to an epic that is in Review or Done.');
        }
        if (task.status !== feature.status) {
          throw new EntityError(409, `A ticket moved into this epic must use its current status: ${feature.status}.`);
        }
      } else {
        checkTransition(existing!.status as Task['status'], task.status);
      }
      if (feature && existing!.featureId !== feature.id && ['Review', 'Done'].includes(feature.status)) {
        throw new EntityError(409, 'Tickets cannot be added to an epic that is in Review or Done.');
      }
      if ((task.releaseId ?? null) !== existing!.releaseId &&
          await tx.reviewPublication.count({ where: { session: { taskId: task.id }, finishId: { not: null } } })) {
        throw new EntityError(409, 'The release assignment is pinned by Finish. Keep it with the recorded merge.');
      }
      await checkReleaseAssignment(tx, task.projectId, task.releaseId, existing!.releaseId);
      const { subtasks, ...fields } = task;
      // Only this task's checklist is replaced, in the same transaction as its fields.
      const saved = taskData(await tx.task.update({
        where: { id: task.id, revision: task.revision },
        data: {
          ...fields, featureId: task.featureId ?? null,
          releaseId: task.releaseId ?? null,
          suggestedWorkflow: task.suggestedWorkflow ?? null, revision: { increment: 1 },
          subtasks: {
            deleteMany: {},
            create: subtasks.map((subtask, position) => ({ ...subtask, position })),
          },
        },
        include: taskInclude,
      }));
      const enteringActiveEpic = feature?.status === 'In Progress' && saved.status === 'In Progress' &&
        (existing!.status !== 'In Progress' || existing!.featureId !== feature.id);
      await queueExecution(tx, existing!.status, saved, this.agentProvider, enteringActiveEpic);
      if (['Review', 'Done'].includes(saved.status) && existing!.status !== saved.status && saved.featureId) {
        await advanceEpicToReviewIfComplete(tx, saved.featureId);
      }
      const changes = activityChanges(existing, saved, [
        { key: 'title', label: 'Title' }, { key: 'status', label: 'Status' },
        { key: 'priority', label: 'Priority' }, { key: 'featureId', label: 'Feature' },
        { key: 'releaseId', label: 'Release' }, { key: 'storyPoints', label: 'Story points' },
      ]).concat(contextFileChanges(existing!.contextFiles, saved.contextFiles));
      if (changes.length) await recordActivity(tx, {
        projectId: saved.projectId, entityType: 'task', entityId: saved.id, entityTitle: saved.title,
        action: existing!.status !== saved.status ? 'status_changed' : 'updated',
        summary: existing!.status !== saved.status ? `Ticket moved from ${existing!.status} to ${saved.status}` : 'Ticket updated',
        changes,
      });
      return saved;
    });
  }

  deleteTask(id: string, revision: number) {
    return this.db.$transaction(async (tx) => {
      await ensureNoActiveSessions(tx, { taskId: id });
      const task = await tx.task.findUnique({ where: { id } });
      checkRevision(task, revision);
      if (task?.releaseId) await checkReleaseAssignment(tx, task.projectId ?? undefined, undefined, task.releaseId);
      await recordActivity(tx, {
        projectId: task?.projectId, entityType: 'task', entityId: id, entityTitle: task!.title,
        action: 'deleted', summary: 'Ticket deleted',
      });
      await tx.task.delete({ where: { id, revision } });
    });
  }

  moveTask(id: string, input: z.infer<typeof moveTaskSchema>) {
    return this.db.$transaction(async (tx) => {
      await ensureNoActiveSessions(tx, { taskId: id });
      const existing = await tx.task.findUnique({ where: { id }, include: taskInclude });
      checkRevision(existing, input.revision);
      if (!existing) throw new EntityError(404, 'Task not found');
      const feature = existing.featureId
        ? await tx.feature.findUnique({ where: { id: existing.featureId } })
        : null;
      checkTransition(existing.status as Task['status'], input.status);
      if (existing.featureId) {
        const feature = await tx.feature.findUnique({ where: { id: existing.featureId } });
        if (feature && ['Review', 'Done'].includes(feature.status) && input.status !== existing.status &&
            !(feature.status === 'Review' && existing.status === 'Review' && input.status === 'Done')) {
          throw new EntityError(409, 'Reopen the epic before changing a ticket in Review or Done.');
        }
      }
      const rows = await tx.task.findMany({
        where: { projectId: existing.projectId, OR: [{ id }, { status: input.status }] },
        orderBy: [{ order: 'asc' }, { position: 'asc' }], include: taskInclude,
      });
      const changed = moveTask(rows.map(taskData), id, input.status, input.index)
        .filter((task) => {
          const before = rows.find((row) => row.id === task.id);
          return task.id === id || before?.order !== task.order || before.status !== task.status;
        });
      const result: Task[] = [];
      for (const task of changed) {
        result.push(taskData(await tx.task.update({
          where: { id: task.id }, data: {
            status: task.status, order: task.order, updatedAt: task.updatedAt, revision: { increment: 1 },
          }, include: taskInclude,
        })));
      }
      const moved = result.find((task) => task.id === id);
      if (moved) {
        const enteringActiveEpic = feature?.status === 'In Progress' &&
          existing.status !== 'In Progress' && moved.status === 'In Progress';
        await queueExecution(tx, existing.status, moved, this.agentProvider, enteringActiveEpic);
        if (['Review', 'Done'].includes(moved.status) && existing.status !== moved.status && moved.featureId) {
          await advanceEpicToReviewIfComplete(tx, moved.featureId);
        }
        for (const saved of result) {
          const previous = rows.find((row) => row.id === saved.id);
          const changes = activityChanges(previous ?? null, saved, [
            { key: 'status', label: 'Status' }, { key: 'order', label: 'Position' },
          ]);
          const statusChanged = saved.id === id && !!previous && previous.status !== saved.status;
          if (changes.length) await recordActivity(tx, {
            projectId: saved.projectId, entityType: 'task', entityId: saved.id, entityTitle: saved.title,
            action: statusChanged ? 'status_changed' : 'reordered',
            summary: statusChanged
              ? `Ticket moved from ${previous?.status ?? saved.status} to ${saved.status}` : 'Ticket order changed',
            changes,
          });
        }
      }
      return result;
    });
  }

  breakdown(input: z.infer<typeof breakdownSchema>) {
    return this.db.$transaction(async (tx) => {
      const existing = await tx.feature.findUnique({ where: { id: input.feature.id } });
      if (existing) checkRevision(existing, input.feature.revision);
      const feature = existing ? featureData(existing) : await createFeature(tx, input.feature);
      const tasks: Task[] = [];
      for (const task of input.tasks) {
        if (task.featureId !== feature.id || task.projectId !== feature.projectId) {
          throw new EntityError(400, 'Breakdown tasks must belong to the selected feature');
        }
        tasks.push(await createTask(tx, task, this.agentProvider));
      }
      return { feature, tasks };
    });
  }
}
