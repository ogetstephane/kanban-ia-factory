import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import { finishPreviewSchema, finishRequestSchema, publishedWorkListSchema, type FinishRequest } from '../../shared/types/git';
import { ensureNoActiveSessions, EntityError } from '../db/entityStore';
import { recordActivity } from '../db/activityLog';
import type { RepositoryService } from './repositoryService';

type Kind = 'tasks' | 'features';

export class BranchFinishService {
  private running = new Set<Promise<unknown>>();
  constructor(private db: PrismaClient, private repositories: RepositoryService) {}

  async recover() {
    await this.db.branchFinish.updateMany({ where: { status: { in: ['merging', 'pushing', 'closing'] } }, data: {
      status: 'failed', error: 'Server restarted during Finish. Reload and explicitly retry to reconcile the saved merge; no Git writes are replayed automatically.',
      updatedAt: new Date().toISOString(),
    } });
  }
  async stop() { await Promise.allSettled(this.running); }

  async list(projectId: string) {
    const tasks = await this.db.task.findMany({ where: { projectId }, include: {
      release: true, feature: true, agentSession: { include: { publications: { include: { finish: true } } } },
    }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
    const groups = new Map<string, typeof tasks>();
    for (const task of tasks) {
      const key = task.featureId ? `feature:${task.featureId}` : `task:${task.id}`;
      const group = groups.get(key) ?? [];
      group.push(task); groups.set(key, group);
    }
    const result = [];
    for (const group of groups.values()) {
      const first = group[0];
      if (first.feature && first.feature.status !== 'Done') continue;
      if (group.some((task) => task.status !== 'Done')) continue;
      const publications = group.map((task) => task.agentSession?.publications.find(
        (item) => item.attempt === task.agentSession!.attempt && item.status === 'pushed'));
      if (publications.some((item) => !item)) continue;
      const publication = publications[0]!;
      result.push({
        id: first.featureId ?? first.id, kind: first.featureId ? 'features' : 'tasks',
        title: first.feature?.title ?? first.title, branch: publication.branch,
        tasks: group.map((task) => ({ id: task.id, title: task.title, revision: task.revision, releaseId: task.releaseId, releaseVersion: task.release?.version ?? null })),
        finishStatus: publication.finish?.status ?? null, finishError: publication.finish?.error ?? '',
      });
    }
    return publishedWorkListSchema.parse(result);
  }

  private async scope(kind: Kind, id: string, tx: Prisma.TransactionClient = this.db) {
    const tasks = await tx.task.findMany({ where: kind === 'features' ? { featureId: id } : { id },
      include: { project: true, feature: true, release: true, agentSession: { include: { publications: true } } },
      orderBy: { id: 'asc' } });
    const first = tasks[0];
    if (!first?.project) throw new EntityError(404, 'Published work not found');
    if (kind === 'tasks' && first.featureId) throw new EntityError(409, 'Finish the entire epic, not an individual child ticket');
    if (tasks.some((task) => task.status !== 'Done' || task.projectId !== first.projectId) ||
        (kind === 'features' && first.feature?.status !== 'Done')) throw new EntityError(409, 'Only Done epics and standalone tickets can be finished');
    const publications = tasks.map((task) => {
      const session = task.agentSession;
      const publication = session?.publications.find((item) => item.attempt === session.attempt && item.status === 'pushed');
      if (!session || !publication || session.status !== 'completed') throw new EntityError(409, `${task.title}: verified publication and a stopped session are required`);
      return publication;
    });
    const scopeId = kind === 'features' ? `feature:${id}` : `task:${id}`;
    if (publications.some((item) => item.branch !== publications[0].branch || item.remoteUrl !== publications[0].remoteUrl || item.scopeId !== scopeId)) {
      throw new EntityError(409, 'The epic tickets do not share the same published feature branch and origin');
    }
    if (tasks.some((task) => !task.release || !['upcoming', 'in_progress'].includes(task.release.status) || task.release.publishing || task.release.targetCommit)) {
      throw new EntityError(409, 'Assign every ticket to an upcoming or in-progress release before Finish. Create the next release if none exists.');
    }
    if (tasks.some((task) => task.releaseId !== first.releaseId)) throw new EntityError(409, 'All tickets in an epic must belong to the same release before Finish');
    return { tasks, publications, project: first.project, scopeId, release: first.release! };
  }

  async preview(kind: Kind, id: string) {
    const scope = await this.scope(kind, id);
    const { project, publications, scopeId, release } = scope;
    const saved = await this.db.branchFinish.findUnique({ where: { projectId_scopeId: { projectId: project.id, scopeId } }, include: { publications: true } });
    if (saved && (saved.publications.length !== publications.length || publications.some((item) => !saved.publications.some((previous) => previous.id === item.id)))) {
      throw new EntityError(409, 'This epic or task has a Finish record for different reviewed attempts. Inspect its history before finishing again.');
    }
    if (saved && saved.releaseId !== release.id) throw new EntityError(409, 'The release changed after Finish started. Restore the original assignment before retrying.');
    if (saved?.status === 'finished') return finishPreviewSchema.parse({ ...saved, releaseVersion: release.version });
    if (!project.repositoryBranch) throw new EntityError(409, 'The project has no configured branch');
    const origin = await this.repositories.publication.publicationOrigin(project.id);
    if (origin !== publications[0].remoteUrl || (saved && (saved.origin !== origin || saved.targetBranch !== project.repositoryBranch))) {
      throw new EntityError(409, 'The project branch or origin changed since publication. Restore the original configuration.');
    }
    const branch = publications[0].branch;
    const state = await this.repositories.publication.finishState(project.id, branch, project.repositoryBranch, origin);
    const featureHead = saved?.featureHead ?? state.featureHead;
    if (!featureHead) throw new EntityError(409, 'The published feature branch is missing on origin');
    if (state.featureHead && state.featureHead !== featureHead) throw new EntityError(409, 'The feature branch changed after Finish started; inspect it locally before retrying');
    for (const publication of publications) {
      if (!await this.repositories.operations.containsDeliveryMerge(project.id, publication.commitHash, featureHead)) throw new EntityError(409, 'The remote feature branch no longer contains all reviewed commits');
    }
    if (saved && state.targetHead !== saved.targetHead &&
        (!saved.mergeHash || !await this.repositories.operations.containsDeliveryMerge(project.id, saved.mergeHash, state.targetHead))) {
      throw new EntityError(409, 'The project branch changed after Finish was prepared. Inspect the saved merge before retrying.');
    }
    return finishPreviewSchema.parse({
      projectId: project.id, scopeId, branch, targetBranch: project.repositoryBranch, origin,
      featureHead, targetHead: saved?.targetHead ?? state.targetHead, releaseId: release.id,
      releaseVersion: release.version, status: saved?.status ?? 'ready',
    });
  }

  execute(kind: Kind, id: string, input: FinishRequest) {
    const operation = this.perform(kind, id, finishRequestSchema.parse(input));
    this.running.add(operation);
    void operation.then(() => this.running.delete(operation), () => this.running.delete(operation));
    return operation;
  }

  private async perform(kind: Kind, id: string, input: FinishRequest) {
    const initial = await this.scope(kind, id);
    return this.repositories.workspaces.withProjectLock(initial.project.id, async () => {
      const preview = await this.preview(kind, id);
      for (const key of ['projectId', 'scopeId', 'branch', 'targetBranch', 'origin', 'featureHead', 'targetHead', 'releaseId'] as const) {
        if (input[key] !== preview[key]) throw new EntityError(409, 'The branch or release changed. Reload Finish before confirming.');
      }
      if (preview.status === 'finished') return preview;
      await this.repositories.operations.deliveryIdentity(preview.projectId);
      const saved = await this.db.$transaction(async (tx) => {
        await ensureNoActiveSessions(tx, { task: { projectId: preview.projectId } });
        const fresh = await this.scope(kind, id, tx);
        if (fresh.tasks.map((task) => task.id).join() !== initial.tasks.map((task) => task.id).join()) throw new EntityError(409, 'Epic membership changed');
        if (fresh.publications.map((item) => item.id).join() !== initial.publications.map((item) => item.id).join() ||
            fresh.project.repositoryBranch !== preview.targetBranch) throw new EntityError(409, 'The reviewed attempt or project branch changed');
        const release = await tx.release.findUniqueOrThrow({ where: { id: preview.releaseId } });
        if (release.publishing || release.targetCommit || !['upcoming', 'in_progress'].includes(release.status)) throw new EntityError(409, 'The release is no longer available for Finish');
        for (const task of fresh.tasks) {
          if (task.releaseId !== preview.releaseId) throw new EntityError(409, 'The release assignment changed');
          await tx.agentSession.update({ where: { id: task.agentSession!.id }, data: { status: 'delivering' } });
        }
        const now = new Date().toISOString();
        const finish = await tx.branchFinish.upsert({
          where: { projectId_scopeId: { projectId: preview.projectId, scopeId: preview.scopeId } },
          create: { id: randomUUID(), ...input, status: 'merging', createdAt: now, updatedAt: now },
          update: { status: 'merging', error: '', updatedAt: now },
        });
        await tx.reviewPublication.updateMany({ where: { id: { in: fresh.publications.map((item) => item.id) } }, data: { finishId: finish.id } });
        return finish;
      });
      try {
        const merge = saved.mergeHash ?? await this.repositories.operations.prepareDeliveryMerge(preview.projectId, saved.targetHead, saved.featureHead, saved.id);
        await this.repositories.operations.pinReviewCommit(preview.projectId, saved.id, merge);
        await this.db.branchFinish.update({ where: { id: saved.id }, data: { mergeHash: merge, status: 'merging' } });
        const head = await this.repositories.operations.applyDeliveryMerge(preview.projectId, saved.targetBranch, saved.targetHead, merge);
        await this.db.branchFinish.update({ where: { id: saved.id }, data: { status: 'pushing' } });
        await this.repositories.publication.pushFinishedProject(preview.projectId, saved.targetBranch, head, saved.origin);
        await this.db.branchFinish.update({ where: { id: saved.id }, data: { status: 'closing' } });
        await this.repositories.publication.closeFinishedBranch(preview.projectId, saved.branch, saved.featureHead, saved.targetBranch, merge, saved.origin);
        await this.db.$transaction(async (tx) => {
          const now = new Date().toISOString();
          await tx.branchFinish.update({ where: { id: saved.id }, data: { status: 'finished', error: '', updatedAt: now } });
          await tx.project.update({ where: { id: preview.projectId }, data: { repositoryCommit: head, revision: { increment: 1 }, updatedAt: now } });
          await recordActivity(tx, { projectId: preview.projectId, entityType: kind === 'features' ? 'feature' : 'task', entityId: id,
            entityTitle: initial.tasks[0].feature?.title ?? initial.tasks[0].title, action: 'branch_finished',
            summary: `Merged ${saved.branch} into ${saved.targetBranch}, pushed origin and closed the feature branch for v${initial.release.version}` });
        });
      } catch (error) {
        console.error('Branch Finish failed:', error);
        await this.db.branchFinish.update({ where: { id: saved.id }, data: {
          status: 'failed', error: error instanceof Error ? error.message : 'Finish failed', updatedAt: new Date().toISOString(),
        } });
        throw error;
      } finally {
        await this.db.agentSession.updateMany({ where: { id: { in: initial.tasks.map((task) => task.agentSession!.id) }, status: 'delivering' },
          data: { status: 'completed', updatedAt: new Date().toISOString() } });
      }
      return this.preview(kind, id);
    });
  }
}
