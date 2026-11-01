import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import type { z } from 'zod';
import { releaseEditSchema, releaseUpdateSchema, releasePublishSchema, releaseDetailSchema, releaseSchema, releasePreviewSchema } from '../../src/types/release';
import { assignNextRelease, checkReleaseAssignment, ensureNoActiveSessions, EntityError, taskData } from '../db/entityStore';
import type { RepositoryService } from '../git/repositoryService';
import { activityChanges, recordActivity } from '../db/activityLog';

const releaseInclude = {
  tasks: { orderBy: { id: 'asc' as const }, select: {
    id: true, title: true, status: true, revision: true,
    agentSession: { select: { attempt: true, deliveries: { select: { attempt: true, status: true, mergeHash: true } },
      publications: { select: { attempt: true, finish: { select: { status: true, mergeHash: true } } } } } },
  } },
};
type ReleaseRow = Prisma.ReleaseGetPayload<{ include: typeof releaseInclude }>;
const ticketInfo = (task: ReleaseRow['tasks'][number]) => {
  const delivery = task.agentSession?.deliveries.find((row) => row.attempt === task.agentSession!.attempt && row.status === 'delivered');
  const finish = task.agentSession?.publications.find((row) => row.attempt === task.agentSession!.attempt && row.finish?.status === 'finished')?.finish;
  return {
    id: task.id, title: task.title, status: task.status, revision: task.revision,
    delivered: !!(delivery?.mergeHash ?? finish?.mergeHash), mergeHash: delivery?.mergeHash ?? finish?.mergeHash ?? null,
  };
};
const summary = (row: ReleaseRow) => releaseSchema.parse({
  ...row, ticketCount: row.tasks.length, deliveredCount: row.tasks.filter((task) => ticketInfo(task).delivered).length,
});

export class ReleaseService {
  private running = new Set<Promise<unknown>>();
  constructor(private db: PrismaClient, private repositories: RepositoryService) {}

  async recover() {
    await this.db.$transaction(async (tx) => {
      const interrupted = await tx.release.findMany({
        where: { publishing: true }, include: { project: { select: { name: true } } },
      });
      for (const release of interrupted) {
        const updated = await tx.release.updateMany({ where: { id: release.id, publishing: true }, data: {
          publishing: false, error: 'Server restarted during tag publication. Reload and explicitly retry; the saved tag and commit will be reused.',
          revision: { increment: 1 }, updatedAt: new Date().toISOString(),
        } });
        if (updated.count) await recordActivity(tx, {
          projectId: release.projectId, projectName: release.project.name, entityType: 'release',
          entityId: release.id, entityTitle: `v${release.version}`, action: 'publication_interrupted',
          summary: 'Release tag publication was interrupted by a server restart', actor: 'System',
        });
      }
    });
  }
  async stop() { await Promise.allSettled(this.running); }

  private async row(projectId: string, id: string, tx: Prisma.TransactionClient = this.db) {
    const row = await tx.release.findFirst({ where: { id, projectId }, include: releaseInclude });
    if (!row) throw new EntityError(404, 'Release not found');
    return row;
  }

  async list(projectId?: string) {
    if (projectId !== undefined && !await this.db.project.findUnique({ where: { id: projectId } })) throw new EntityError(404, 'Project not found');
    return (await this.db.release.findMany({ where: { projectId }, orderBy: { createdAt: 'desc' }, include: releaseInclude })).map(summary);
  }

  async detail(projectId: string, id: string) {
    const row = await this.row(projectId, id);
    return releaseDetailSchema.parse({ ...summary(row), tickets: row.tasks.map(ticketInfo) });
  }

  async create(projectId: string, input: z.infer<typeof releaseEditSchema>) {
    const data = releaseEditSchema.parse(input);
    if (!await this.db.project.findUnique({ where: { id: projectId } })) throw new EntityError(404, 'Project not found');
    const now = new Date().toISOString();
    await this.db.$transaction(async (tx) => {
      const created = await tx.release.create({ data: { id: randomUUID(), projectId, ...data, createdAt: now, updatedAt: now } });
      await assignNextRelease(tx, projectId);
      await recordActivity(tx, {
        projectId, entityType: 'release', entityId: created.id, entityTitle: `v${created.version}`,
        action: 'created', summary: 'Release created', changes: activityChanges(null, created, [
          { key: 'version', label: 'Version' }, { key: 'status', label: 'Status' },
        ]),
      });
    });
    return this.list(projectId);
  }

  async update(projectId: string, id: string, input: z.infer<typeof releaseUpdateSchema>) {
    const data = releaseUpdateSchema.parse(input);
    await this.db.$transaction(async (tx) => {
      const row = await this.row(projectId, id, tx);
      if (await tx.agentSession.count({ where: { status: 'delivering', task: { releaseId: id } } })) {
        throw new EntityError(409, 'Wait for ticket delivery to finish before changing its release');
      }
      const cancellingFailure = !!row.targetCommit && !!row.error && data.status === 'cancelled' && data.version === row.version;
      if (row.revision !== data.revision || row.publishing || (row.targetCommit && !cancellingFailure) || ['published', 'cancelled'].includes(row.status)) {
        throw new EntityError(409, 'This release changed, is final, or has a pinned publication. Reload it; a prepared version cannot change. Retry publication or cancel the failed publication while keeping its tags.');
      }
      if (row.status === 'in_progress' && data.status === 'upcoming') throw new EntityError(409, 'An in-progress release cannot return to Upcoming');
      const saved = await tx.release.update({ where: { id, revision: data.revision }, data: {
        ...data, revision: { increment: 1 }, updatedAt: new Date().toISOString(),
      } });
      const changes = activityChanges(row, saved, [
        { key: 'version', label: 'Version' }, { key: 'status', label: 'Status' },
      ]);
      if (changes.length) await recordActivity(tx, {
        projectId, entityType: 'release', entityId: id, entityTitle: `v${saved.version}`,
        action: 'updated', summary: 'Release updated', changes,
      });
    });
    return this.detail(projectId, id);
  }

  async assign(projectId: string, taskId: string, releaseId: string | null, revision: number) {
    return this.db.$transaction(async (tx) => {
      await ensureNoActiveSessions(tx, { taskId });
      const task = await tx.task.findUnique({ where: { id: taskId } });
      if (!task || task.projectId !== projectId) throw new EntityError(404, 'Project ticket not found');
      if (task.revision !== revision) throw new EntityError(409, 'This ticket changed. Reload before assigning a version.');
      if (task.releaseId !== releaseId && await tx.reviewPublication.count({ where: { session: { taskId }, finishId: { not: null } } })) {
        throw new EntityError(409, 'The release assignment is pinned by Finish. Keep it with the recorded merge.');
      }
      await checkReleaseAssignment(tx, projectId, releaseId ?? undefined, task.releaseId);
      const previousRelease = task.releaseId ? await tx.release.findUnique({ where: { id: task.releaseId }, select: { version: true } }) : null;
      const nextRelease = releaseId ? await tx.release.findUnique({ where: { id: releaseId }, select: { version: true } }) : null;
      const saved = await tx.task.update({ where: { id: task.id, revision }, data: {
        releaseId, revision: { increment: 1 }, updatedAt: new Date().toISOString(),
      }, include: { subtasks: { orderBy: { position: 'asc' } } } });
      if (task.releaseId !== releaseId) await recordActivity(tx, {
        projectId, entityType: 'task', entityId: task.id, entityTitle: task.title,
        action: 'release_assigned', summary: releaseId
          ? `Ticket assigned to v${nextRelease?.version}`
          : `Ticket removed from v${previousRelease?.version}`,
        changes: [{ field: 'Release', before: previousRelease ? `v${previousRelease.version}` : null, after: nextRelease ? `v${nextRelease.version}` : null }],
      });
      return taskData(saved);
    });
  }

  private eligible(row: ReleaseRow) {
    if (row.publishing) throw new EntityError(409, 'Tag publication is already running');
    if (row.status !== 'in_progress') throw new EntityError(409, 'Only an in-progress release can be published');
    const missing = row.tasks.filter((task) => !ticketInfo(task).delivered);
    if (missing.length) throw new EntityError(409, `${missing.length} ticket(s) are not delivered locally. Done alone is not proof of delivery.`);
  }

  async preview(projectId: string, id: string) {
    const row = await this.row(projectId, id);
    this.eligible(row);
    const project = await this.db.project.findUniqueOrThrow({ where: { id: projectId } });
    const branch = row.targetBranch ?? project.repositoryBranch;
    if (!branch) throw new EntityError(409, 'The project has no target branch');
    const target = await this.repositories.releaseTarget(projectId, branch);
    if (row.remoteUrl && row.remoteUrl !== target.remoteUrl) throw new EntityError(409, 'Origin changed since publication was prepared. Restore the original remote before retrying.');
    const commit = row.targetCommit ?? target.commit;
    for (const task of row.tasks) {
      if (!await this.repositories.containsDeliveryMerge(projectId, ticketInfo(task).mergeHash!, commit)) {
        throw new EntityError(409, `The release target does not contain the delivery of ticket "${task.title}"`);
      }
    }
    const tag = `v${row.version}`;
    const existing = await this.repositories.releaseTag(projectId, tag);
    if (existing && existing !== commit) throw new EntityError(409, `Tag ${tag} already exists on a different object; choose another version`);
    return releasePreviewSchema.parse({
      releaseId: id, revision: row.revision, ...target, commit, tag, ticketCount: row.tasks.length, alreadyTagged: !!existing,
    });
  }

  publish(projectId: string, id: string, input: z.infer<typeof releasePublishSchema>) {
    const run = this.performPublish(projectId, id, releasePublishSchema.parse(input));
    this.running.add(run);
    void run.then(() => this.running.delete(run), () => this.running.delete(run));
    return run;
  }

  private async performPublish(projectId: string, id: string, input: z.infer<typeof releasePublishSchema>) {
    return this.repositories.withProjectLock(projectId, async () => {
      const previous = await this.row(projectId, id);
      if (previous.status === 'published') {
        if (previous.targetCommit !== input.commit || previous.remoteUrl !== input.remoteUrl || previous.targetBranch !== input.branch) {
          throw new EntityError(409, 'This request does not match the published release');
        }
        return this.detail(projectId, id);
      }
      const preview = await this.preview(projectId, id);
      if (preview.revision !== input.revision || preview.commit !== input.commit || preview.remoteUrl !== input.remoteUrl || preview.branch !== input.branch) {
        throw new EntityError(409, 'The release or Git target changed. Reload the publication preview.');
      }
      await this.db.$transaction(async (tx) => {
        const row = await this.row(projectId, id, tx);
        this.eligible(row);
        const claimed = await tx.release.updateMany({ where: { id, projectId, revision: input.revision, publishing: false }, data: {
          publishing: true, targetBranch: preview.branch, targetCommit: preview.commit, remoteUrl: preview.remoteUrl,
          error: '', revision: { increment: 1 }, updatedAt: new Date().toISOString(),
        } });
        if (!claimed.count) throw new EntityError(409, 'This release changed or is already being published');
        await recordActivity(tx, {
          projectId, entityType: 'release', entityId: id, entityTitle: `v${row.version}`,
          action: 'publication_started', summary: `Started publishing tag ${preview.tag}`, actor: 'User',
          changes: [{ field: 'Tag target', before: null, after: preview.commit.slice(0, 12) }],
        });
      });
      try {
        const tagHash = await this.repositories.createReleaseTag(projectId, preview.tag, preview.commit);
        await this.db.release.update({ where: { id }, data: { tagHash } });
        await this.repositories.pushReleaseTag(projectId, preview.tag, preview.commit, preview.remoteUrl);
        const now = new Date().toISOString();
        await this.db.$transaction(async (tx) => {
          await tx.release.update({ where: { id }, data: {
            status: 'published', publishing: false, error: '', publishedAt: now, updatedAt: now, revision: { increment: 1 },
          } });
          await recordActivity(tx, {
            projectId, entityType: 'release', entityId: id, entityTitle: `v${previous.version}`,
            action: 'published', summary: `Published tag ${preview.tag}`, actor: 'System',
            changes: [{ field: 'Status', before: 'In progress', after: 'Published' }, { field: 'Tag', before: null, after: preview.tag }],
          });
        });
      } catch (error) {
        console.error('Release tag publication failed:', error);
        await this.db.$transaction(async (tx) => {
          await tx.release.update({ where: { id }, data: {
            publishing: false, error: error instanceof Error ? error.message : 'Tag publication failed',
            revision: { increment: 1 }, updatedAt: new Date().toISOString(),
          } });
          await recordActivity(tx, {
            projectId, entityType: 'release', entityId: id, entityTitle: `v${previous.version}`,
            action: 'publication_failed', summary: 'Release tag publication failed', actor: 'System',
          });
        });
        throw error;
      }
      return this.detail(projectId, id);
    });
  }
}
