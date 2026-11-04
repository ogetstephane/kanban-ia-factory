import { randomUUID } from 'node:crypto';
import type { AgentSession, Prisma, PrismaClient } from '@prisma/client';
import { agentContextSchema, type PublicationRequest } from '../../shared/types/agent';
import { advanceEpicToReviewIfComplete, EntityError } from '../db/entityStore';
import { recordActivity } from '../db/activityLog';
import type { RepositoryService } from '../git/repositoryService';
import { requiredTicketDocumentationPath } from './ticketDocumentation';

type Scope = 'tasks' | 'features';

export class ReviewPublicationService {
  private running = new Set<Promise<unknown>>();

  constructor(
    private db: PrismaClient,
    private repositories: RepositoryService,
    private validateContext: (row: AgentSession, tx: Prisma.TransactionClient) => Promise<unknown>,
  ) {}

  async recover() {
    await this.db.reviewPublication.updateMany({ where: { status: 'pushing' }, data: {
      status: 'failed', error: 'Server restarted during publication. Retry to verify the saved commit on origin; no push is replayed automatically.',
      updatedAt: new Date().toISOString(),
    } });
  }

  async stop() { await Promise.allSettled(this.running); }

  private async cleanupCompleted(projectId: string, featureId: string | null, taskId: string) {
    if (featureId && (await this.db.feature.findUniqueOrThrow({ where: { id: featureId } })).status !== 'Done') return;
    const tasks = await this.db.task.findMany({
      where: featureId ? { featureId } : { id: taskId },
      include: { agentSession: { include: { publications: true } } },
    });
    for (const task of tasks) {
      const session = task.agentSession;
      const publication = session?.publications.find((item) => item.attempt === session.attempt && item.status === 'pushed');
      if (task.status !== 'Done' || !session?.workspace || !session.baseCommit || !publication) continue;
      try {
        await this.repositories.operations.cleanupPublishedTicket(projectId, session.id, session.baseCommit,
          publication.reviewToken, publication.commitHash, publication.ticketHead);
        await this.db.$transaction(async (tx) => {
          await tx.agentSession.update({ where: { id: session.id }, data: { workspace: null, updatedAt: new Date().toISOString() } });
          await tx.reviewPublication.update({ where: { id: publication.id }, data: { error: '' } });
          await recordActivity(tx, { projectId, entityType: 'task', entityId: task.id, entityTitle: task.title,
            action: 'worktree_cleaned', summary: 'Removed the published worktree; feature branch and session history preserved' });
        });
      } catch (error) {
        console.error('Published worktree cleanup failed:', error);
        const message = `Published and marked Done, but worktree cleanup failed: ${error instanceof Error ? error.message : 'Unknown cleanup error'}`;
        await this.db.reviewPublication.update({ where: { id: publication.id }, data: { error: message } });
        throw new EntityError(409, `${message} Reload validation and retry after resolving local changes.`);
      }
    }
  }

  private async scope(kind: Scope, id: string) {
    const feature = kind === 'features' ? await this.db.feature.findUnique({ where: { id } }) : null;
    if (kind === 'features' && !feature) throw new EntityError(404, 'Epic not found');
    if (feature && !['Review', 'Done'].includes(feature.status)) throw new EntityError(409, 'The epic must be in Review before validation');
    const tasks = await this.db.task.findMany({
      where: kind === 'features' ? { featureId: id } : { id },
      include: { project: true, feature: true, agentSession: { include: {
        checks: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }, publications: { include: { finish: true } },
      } } },
      orderBy: [{ order: 'asc' }, { id: 'asc' }],
    });
    if (!tasks.length) throw new EntityError(409, 'No tickets are available for validation');
    const project = tasks[0].project;
    if (!project || tasks.some((task) => task.projectId !== project.id)) throw new EntityError(409, 'Review validation requires tickets from one repository');
    return { feature, tasks, project };
  }

  async preview(kind: Scope, id: string) {
    const { feature, tasks, project } = await this.scope(kind, id);
    const scopeId = tasks[0].featureId ? `feature:${tasks[0].featureId}` : `task:${tasks[0].id}`;
    const previous = await this.db.reviewPublication.findFirst({ where: { projectId: project.id, scopeId } });
    const branch = previous?.branch ?? this.repositories.publication.featureBranch(tasks[0].feature?.title ?? tasks[0].title);
    if (branch === project.repositoryBranch) throw new EntityError(409, 'The feature branch cannot be the project branch');
    if (await this.db.reviewPublication.findFirst({ where: { projectId: project.id, branch, scopeId: { not: scopeId } } })) {
      throw new EntityError(409, 'Another ticket or epic already uses this feature branch. Use a distinct epic title.');
    }
    const origin = await this.repositories.publication.publicationOrigin(project.id);
    if (previous && previous.remoteUrl !== origin) throw new EntityError(409, 'Origin changed since this epic or ticket started publication');
    const warnings: string[] = [];
    const snapshots = [];
    for (const task of tasks) {
      const row = task.agentSession;
      if (!row || row.status !== 'completed' || !['Review', 'Done'].includes(task.status)) {
        throw new EntityError(409, `${task.title}: finish execution and move the ticket to Review before validation`);
      }
      const saved = row.publications.find((item) => item.attempt === row.attempt);
      if (saved?.finish) throw new EntityError(409, 'Finish has already started for this branch. Continue Finish in the Git view instead of publishing again.');
      if (saved?.remoteUrl !== undefined && saved.remoteUrl !== origin) throw new EntityError(409, 'Origin changed since publication started');
      if (saved && (saved.branch !== branch || saved.scopeId !== scopeId)) throw new EntityError(409, 'This attempt was published under a different ticket or epic scope. Request and review a new attempt.');
      if (saved?.status === 'pushed' && task.status === 'Done') {
        snapshots.push({ taskId: task.id, sessionId: row.id, updatedAt: row.updatedAt,
          reviewToken: saved.reviewToken, tree: saved.tree, ticketHead: saved.ticketHead });
        continue;
      }
      await this.validateContext(row, this.db);
      if (!row.baseCommit || row.reviewStatus !== 'accepted') throw new EntityError(409, `${task.title}: accept the human review first`);
      const docs = requiredTicketDocumentationPath({ docsPath: project.docsPath, taskId: task.id,
        taskTitle: task.title, featureTitle: task.feature?.title });
      const review = await this.repositories.operations.ticketReview(project.id, row.id, row.baseCommit, undefined, docs);
      if (!review.documentation?.ready) throw new EntityError(409, `${task.title}: required documentation is missing or empty (${docs})`);
      if (review.token !== row.reviewToken) throw new EntityError(409, `${task.title}: files changed after acceptance; reload and accept the current diff`);
      const target = agentContextSchema.parse(row.context).project?.repositoryBranch;
      if (!target) throw new EntityError(409, 'The ticket has no original project branch');
      const state = await this.repositories.operations.deliveryState(project.id, row.id, target);
      // Check the fingerprint again after staging the private-index snapshot.
      if ((await this.repositories.operations.ticketReview(project.id, row.id, row.baseCommit, undefined, docs)).token !== review.token) {
        throw new EntityError(409, 'Files changed while preparing publication; reload the review');
      }
      if (saved && (saved.tree !== state.tree || saved.reviewToken !== review.token || saved.ticketHead !== state.ticketHead)) {
        throw new EntityError(409, 'The saved publication differs from this snapshot. Request corrections and review a new attempt.');
      }
      for (const script of ['test', 'lint']) {
        const check = row.checks.filter((item) => item.attempt === row.attempt && item.script === script).at(-1);
        if (!check?.passed) warnings.push(`${task.title}: ${script} ${check ? 'failed' : 'not run'}`);
      }
      snapshots.push({ taskId: task.id, sessionId: row.id, updatedAt: row.updatedAt, reviewToken: review.token,
        tree: state.tree, ticketHead: state.ticketHead });
    }
    return { branch, origin, featureRevision: feature?.revision ?? null, tasks: snapshots, warnings };
  }

  execute(kind: Scope, id: string, input: PublicationRequest) {
    const operation = this.perform(kind, id, input);
    this.running.add(operation);
    void operation.then(() => this.running.delete(operation), () => this.running.delete(operation));
    return operation;
  }

  private async perform(kind: Scope, id: string, input: PublicationRequest) {
    const initial = await this.scope(kind, id);
    return this.repositories.workspaces.withProjectLock(initial.project.id, async () => {
      const preview = await this.preview(kind, id);
      if (preview.branch !== input.branch || preview.origin !== input.origin || preview.featureRevision !== input.featureRevision ||
          JSON.stringify(preview.tasks) !== JSON.stringify(input.tasks)) {
        throw new EntityError(409, 'The review or epic changed. Reload validation before continuing.');
      }
      if (preview.warnings.length && !input.acknowledgeChecks) throw new EntityError(409, 'Acknowledge failing or missing checks before pushing');
      await this.repositories.operations.deliveryIdentity(initial.project.id);
      // Claim all sessions together, protecting the epic and ticket context during network operations.
      await this.db.$transaction(async (tx) => {
        if (kind === 'features') {
          const feature = await tx.feature.findUnique({ where: { id }, include: { tasks: { select: { id: true } } } });
          if (!feature || feature.revision !== input.featureRevision ||
              feature.tasks.length !== preview.tasks.length || feature.tasks.some((task) => !preview.tasks.some((item) => item.taskId === task.id))) {
            throw new EntityError(409, 'The epic changed before publication. Reload validation.');
          }
        }
        for (const snapshot of preview.tasks) {
          const claimed = await tx.agentSession.updateMany({ where: {
            id: snapshot.sessionId, taskId: snapshot.taskId, status: 'completed', updatedAt: snapshot.updatedAt,
          }, data: { status: 'delivering' } });
          if (claimed.count !== 1) throw new EntityError(409, 'A ticket changed before publication');
          await this.validateContext(await tx.agentSession.findUniqueOrThrow({ where: { id: snapshot.sessionId } }), tx);
        }
      });
      try {
        for (const snapshot of preview.tasks) {
          const row = await this.db.agentSession.findUniqueOrThrow({ where: { id: snapshot.sessionId }, include: { task: true } });
          let publication = await this.db.reviewPublication.findUnique({ where: { sessionId_attempt: { sessionId: row.id, attempt: row.attempt } } });
          if (!publication) {
            const publicationId = randomUUID();
            const commitHash = await this.repositories.operations.createTicketCommit(initial.project.id, row.id,
              snapshot.tree, snapshot.ticketHead, `Implement: ${row.task.title}`, publicationId);
            await this.repositories.operations.pinReviewCommit(initial.project.id, publicationId, commitHash);
            publication = await this.db.reviewPublication.create({ data: {
              id: publicationId, sessionId: row.id, attempt: row.attempt, projectId: initial.project.id,
              scopeId: row.task.featureId ? `feature:${row.task.featureId}` : `task:${row.task.id}`,
              branch: preview.branch, remoteUrl: preview.origin, reviewToken: snapshot.reviewToken,
              tree: snapshot.tree, ticketHead: snapshot.ticketHead, commitHash, status: 'pushing',
              createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
            } });
          }
          await this.db.reviewPublication.update({ where: { id: publication.id }, data: { status: 'pushing', error: '' } });
          // Only the saved immutable commit is pushed, never an unreviewed working tree or main.
          await this.repositories.publication.pushReviewCommit(initial.project.id, preview.branch, publication.commitHash, preview.origin);
          await this.db.$transaction(async (tx) => {
            const current = await tx.agentSession.findUniqueOrThrow({ where: { id: row.id } });
            if (current.status !== 'delivering' || current.attempt !== row.attempt) throw new EntityError(409, 'The session changed during publication');
            await this.validateContext(current, tx);
            const now = new Date().toISOString();
            if (row.task.status !== 'Done') {
              const last = await tx.task.aggregate({ where: { projectId: initial.project.id, status: 'Done' }, _max: { order: true } });
              await tx.task.update({ where: { id: row.task.id }, data: {
                status: 'Done', order: (last._max.order ?? -1) + 1, revision: { increment: 1 }, updatedAt: now,
              } });
              await recordActivity(tx, { projectId: initial.project.id, entityType: 'task', entityId: row.task.id,
                entityTitle: row.task.title, action: 'review_validated', summary: `Review validated and pushed to origin/${preview.branch}; marked Done` });
            }
            await tx.reviewPublication.update({ where: { id: publication.id }, data: { status: 'pushed', error: '', updatedAt: now } });
          });
        }
        await this.db.$transaction(async (tx) => {
          const featureId = initial.feature?.id ?? initial.tasks[0].featureId;
          if (!featureId) return;
          await advanceEpicToReviewIfComplete(tx, featureId);
          const feature = await tx.feature.findUniqueOrThrow({ where: { id: featureId } });
          const tasks = await tx.task.findMany({ where: { featureId }, include: { agentSession: { include: { publications: true } } } });
          const published = tasks.every((task) => {
            const session = task.agentSession;
            return task.status === 'Done' && session?.publications.some((item) => item.attempt === session.attempt &&
              item.status === 'pushed' && item.branch === preview.branch && item.remoteUrl === preview.origin && item.scopeId === `feature:${featureId}`);
          });
          if (kind === 'features' && !published) throw new EntityError(409, 'Epic membership changed during publication. Published tickets are Done; reload validation for the remaining tickets.');
          if (feature.status === 'Review' && published) {
            await tx.feature.update({ where: { id: featureId }, data: { status: 'Done', revision: { increment: 1 } } });
            await recordActivity(tx, { projectId: initial.project.id, entityType: 'feature', entityId: featureId,
              entityTitle: feature.title, action: 'review_validated', summary: `All ticket reviews pushed to origin/${preview.branch}; epic marked Done` });
          }
        });
        await this.cleanupCompleted(initial.project.id, initial.tasks[0].featureId, initial.tasks[0].id);
      } catch (error) {
        console.error('Review publication failed:', error);
        await this.db.reviewPublication.updateMany({ where: {
          sessionId: { in: preview.tasks.map((item) => item.sessionId) }, status: 'pushing',
        }, data: { status: 'failed', error: error instanceof Error ? error.message : 'Review publication failed', updatedAt: new Date().toISOString() } });
        throw error;
      } finally {
        await this.db.agentSession.updateMany({ where: { id: { in: preview.tasks.map((item) => item.sessionId) }, status: 'delivering' },
          data: { status: 'completed', updatedAt: new Date().toISOString() } });
      }
      return { branch: preview.branch };
    });
  }
}
