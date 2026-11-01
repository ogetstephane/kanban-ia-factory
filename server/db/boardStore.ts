import { Prisma, PrismaClient } from '@prisma/client';
import { boardSnapshotSchema, type BoardData, type BoardSnapshot } from '../../src/types/board';
import { ensureNoActiveSessions } from './entityStore';

async function readBoard(tx: Prisma.TransactionClient): Promise<BoardSnapshot | null> {
  const board = await tx.board.findUnique({ where: { id: 'board' } });
  if (!board) return null;
  const projects = await tx.project.findMany({ orderBy: { position: 'asc' } });
  const features = await tx.feature.findMany({ orderBy: { position: 'asc' } });
  const tasks = await tx.task.findMany({
    orderBy: { position: 'asc' },
    include: { subtasks: { orderBy: { position: 'asc' } } },
  });
  return boardSnapshotSchema.parse({
    revision: board.revision,
    releases: await tx.release.findMany({ orderBy: { createdAt: 'asc' } }),
    projects: projects.map((project) => ({
      ...project, icon: project.icon ?? undefined, category: project.category ?? undefined,
      docsPath: project.docsPath ?? undefined,
    })),
    features: features.map((feature) => ({
      ...feature, projectId: feature.projectId ?? undefined, targetDate: feature.targetDate ?? undefined,
    })),
    tasks: tasks.map((task) => ({
      ...task, projectId: task.projectId ?? undefined, featureId: task.featureId ?? undefined,
      suggestedWorkflow: task.suggestedWorkflow ?? undefined,
      releaseId: task.releaseId ?? undefined,
    })),
  });
}

async function writeBoard(tx: Prisma.TransactionClient, data: BoardData) {
  await tx.task.deleteMany({ where: { id: { notIn: data.tasks.map((task) => task.id) } } });
  await tx.feature.deleteMany({ where: { id: { notIn: data.features.map((feature) => feature.id) } } });
  await tx.project.deleteMany({ where: { id: { notIn: data.projects.map((project) => project.id) } } });
  for (const [position, project] of data.projects.entries()) {
    const values = { ...project, position, icon: project.icon ?? null, category: project.category ?? null };
    await tx.project.upsert({ where: { id: project.id }, create: values, update: values });
  }
  for (const [position, feature] of data.features.entries()) {
    const values = { ...feature, position, projectId: feature.projectId ?? null, targetDate: feature.targetDate ?? null };
    await tx.feature.upsert({ where: { id: feature.id }, create: values, update: values });
  }
  for (const release of data.releases ?? []) {
    await tx.release.upsert({ where: { id: release.id }, create: release, update: release });
  }
  for (const [position, task] of data.tasks.entries()) {
    const { subtasks, ...fields } = task;
    const values = {
      ...fields, position, projectId: task.projectId ?? null, featureId: task.featureId ?? null,
      suggestedWorkflow: task.suggestedWorkflow ?? null,
      contextFiles: task.contextFiles ?? [],
    };
    await tx.task.upsert({ where: { id: task.id }, create: values, update: values });
    await tx.subtask.deleteMany({ where: { taskId: task.id } });
    await tx.subtask.createMany({
      data: subtasks.map((subtask, position) => ({ ...subtask, taskId: task.id, position })),
    });
  }
}

export class BoardStore {
  constructor(private readonly db: PrismaClient) {}

  read() {
    return this.db.$transaction(readBoard);
  }

  initialize(data: BoardData) {
    return this.db.$transaction(async (tx) => {
      const existing = await readBoard(tx);
      if (existing) return existing;
      await tx.board.create({ data: { id: 'board' } });
      await writeBoard(tx, data);
      return { ...data, revision: 0 };
    });
  }

  reset(data: BoardData) {
    return this.db.$transaction(async (tx) => {
      await ensureNoActiveSessions(tx);
      await tx.task.deleteMany();
      await tx.release.deleteMany();
      await tx.feature.deleteMany();
      await tx.project.deleteMany();
      const revision = 1;
      await writeBoard(tx, {
        releases: data.releases,
        projects: data.projects.map((entity) => ({ ...entity, revision })),
        features: data.features.map((entity) => ({ ...entity, revision })),
        tasks: data.tasks.map((entity) => ({ ...entity, revision })),
      });
      await tx.board.upsert({ where: { id: 'board' }, create: { id: 'board' }, update: {} });
    });
  }
}
