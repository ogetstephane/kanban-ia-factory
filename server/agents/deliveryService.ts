import { randomUUID } from 'node:crypto';
import type { AgentSession, Prisma, PrismaClient } from '@prisma/client';
import { agentContextSchema, deliveryPreviewSchema, type DeliveryRequest } from '../../shared/types/agent';
import { advanceEpicToReviewIfComplete, EntityError } from '../db/entityStore';
import type { RepositoryService } from '../git/repositoryService';
import { recordActivity } from '../db/activityLog';
import { requiredTicketDocumentationPath } from './ticketDocumentation';

type ValidateContext = (row: AgentSession, tx: Prisma.TransactionClient) => Promise<unknown>;

export class DeliveryService {
  private running = new Set<Promise<unknown>>();

  constructor(private db: PrismaClient, private repositories: RepositoryService, private validateContext: ValidateContext) {}

  private async recordTaskActivity(tx: Prisma.TransactionClient, taskId: string, event: {
    action: string; summary: string; actor?: 'User' | 'Copilot' | 'System';
  }) {
    const task = await tx.task.findUnique({ where: { id: taskId }, include: { project: { select: { name: true } } } });
    if (!task) return;
    await recordActivity(tx, {
      projectId: task.projectId, projectName: task.project?.name,
      entityType: 'task', entityId: task.id, entityTitle: task.title, ...event,
    });
  }

  async recover() {
    const now = new Date().toISOString();
    await this.db.$transaction(async (tx) => {
      const interrupted = await tx.agentDelivery.findMany({
        where: { status: { in: ['committing', 'merging'] } },
        select: { id: true, status: true, session: { select: { taskId: true } } },
      });
      for (const delivery of interrupted) {
        const updated = await tx.agentDelivery.updateMany({
          where: { id: delivery.id, status: delivery.status },
          data: { status: 'failed', error: 'Server restarted during delivery. Reload and retry to reconcile the saved Git commit; no Git writes are replayed automatically.', updatedAt: now },
        });
        if (updated.count) await this.recordTaskActivity(tx, delivery.session.taskId, {
          action: 'delivery_interrupted', summary: `Ticket delivery was interrupted during server restart (${delivery.status})`, actor: 'System',
        });
      }
      await tx.agentSession.updateMany({ where: { status: 'delivering' }, data: { status: 'completed', updatedAt: now } });
    });
  }

  async stop() { await Promise.allSettled(this.running); }

  private async load(taskId: string) {
    const row = await this.db.agentSession.findUnique({ where: { taskId }, include: {
      task: { include: { project: true, feature: true } },
      checks: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
      deliveries: true,
    } });
    if (!row?.task.project || !row.workspace || !row.baseCommit) throw new EntityError(409, 'No ticket worktree is available for delivery');
    const delivery = row.deliveries.find((item) => item.attempt === row.attempt) ?? null;
    return { row, delivery, project: row.task.project };
  }

  async preview(taskId: string) {
    const { row, delivery, project } = await this.load(taskId);
    if (!['completed', 'delivering'].includes(row.status)) throw new EntityError(409, 'Only completed, reviewed executions can be delivered');
    if (delivery?.status !== 'delivered') await this.validateContext(row, this.db);
    if (delivery?.status !== 'delivered') {
      const release = row.task.releaseId ? await this.db.release.findUnique({ where: { id: row.task.releaseId } }) : null;
      if (!release || release.projectId !== project.id || !['upcoming', 'in_progress'].includes(release.status) || release.publishing || release.targetCommit) {
        throw new EntityError(409, 'Assign the ticket to an upcoming or in-progress project release before local delivery');
      }
    }
    if (row.reviewStatus !== 'accepted') throw new EntityError(409, 'Accept the human code review before delivering');
    const targetBranch = agentContextSchema.parse(row.context).project?.repositoryBranch;
    if (!targetBranch) throw new EntityError(409, 'This ticket has no target branch');
    const state = await this.repositories.operations.deliveryState(project.id, row.id, targetBranch);
    const documentationPath = requiredTicketDocumentationPath({
      docsPath: project.docsPath,
      taskId: row.task.id,
      taskTitle: row.task.title,
      featureTitle: row.task.feature?.title,
    });
    const review = await this.repositories.operations.ticketReview(project.id, row.id, row.baseCommit!, undefined, documentationPath);
    if (!review.documentation?.ready) {
      throw new EntityError(409, `Ticket documentation is missing or empty: ${documentationPath}`);
    }
    if (review.token !== row.reviewToken) throw new EntityError(409, 'Files changed after human review. Review and accept the current diff before delivering.');
    if (delivery && state.tree !== delivery.tree) throw new EntityError(409, 'Files changed after the delivery snapshot. Request corrections and review a new attempt.');
    const warnings: string[] = [];
    for (const script of ['test', 'lint']) {
      const latest = row.checks.filter((check) => check.attempt === row.attempt && check.script === script).at(-1);
      if (!latest || !latest.passed) warnings.push(`npm run ${script}: ${latest ? 'failed' : 'not run'} for this attempt`);
    }
    return deliveryPreviewSchema.parse({
      sessionId: row.id, updatedAt: row.updatedAt, targetBranch, ...state, reviewToken: review.token,
      fileCount: review.files.length, projectName: project.name, warnings, delivery,
      suggestedMessage: `Implement: ${row.task.title}`,
    });
  }

  execute(taskId: string, action: 'commit' | 'merge', input: DeliveryRequest) {
    const operation = this.perform(taskId, action, input);
    this.running.add(operation);
    void operation.then(() => this.running.delete(operation), () => this.running.delete(operation));
    return operation;
  }

  private async perform(taskId: string, action: 'commit' | 'merge', input: DeliveryRequest) {
    const initial = await this.load(taskId);
    return this.repositories.workspaces.withProjectLock(initial.project.id, async () => {
      const preview = await this.preview(taskId);
      if (preview.delivery?.status === 'delivered') {
        if (preview.sessionId !== input.sessionId || preview.reviewToken !== input.reviewToken || preview.tree !== input.tree) {
          throw new EntityError(409, 'This request does not match the delivered snapshot');
        }
        return preview;
      }
      if (preview.sessionId !== input.sessionId || preview.updatedAt !== input.updatedAt ||
          preview.targetHead !== input.targetHead || preview.ticketHead !== input.ticketHead ||
          preview.tree !== input.tree || preview.reviewToken !== input.reviewToken) {
        throw new EntityError(409, 'The session, files or target branch changed. Reload delivery before continuing.');
      }
      if (preview.warnings.length && !input.acknowledgeChecks) throw new EntityError(409, 'Explicitly acknowledge missing or failing test/lint checks before delivery');
      if (!preview.fileCount) throw new EntityError(409, 'There are no reviewed changes to deliver');
      if (action === 'merge' && !preview.delivery?.commitHash) throw new EntityError(409, 'Commit the reviewed snapshot before merging');
      if (action === 'commit' && preview.delivery?.commitHash && preview.ticketHead === preview.delivery.commitHash) {
        throw new EntityError(409, 'The ticket is already committed. Continue with merge.');
      }
      await this.repositories.operations.deliveryIdentity(initial.project.id);
      const alreadyMerged = preview.delivery?.mergeHash
        ? await this.repositories.operations.containsDeliveryMerge(initial.project.id, preview.delivery.mergeHash, preview.targetHead)
        : false;
      const now = new Date().toISOString();
      const delivery = await this.db.$transaction(async (tx) => {
        const row = await tx.agentSession.findFirst({ where: {
          id: input.sessionId, taskId, status: 'completed', updatedAt: input.updatedAt, reviewStatus: 'accepted', reviewToken: input.reviewToken,
        } });
        if (!row) throw new EntityError(409, 'Delivery is already running or the session changed');
        await this.validateContext(row, tx);
        const task = await tx.task.findUniqueOrThrow({ where: { id: taskId } });
        const release = task.releaseId ? await tx.release.findUnique({ where: { id: task.releaseId } }) : null;
        if (!release || release.projectId !== task.projectId || !['upcoming', 'in_progress'].includes(release.status) || release.publishing || release.targetCommit) {
          throw new EntityError(409, 'Assign the ticket to an upcoming or in-progress project release before local delivery');
        }
        const claimed = await tx.agentSession.updateMany({
          where: { id: row.id, updatedAt: row.updatedAt, status: 'completed' },
          data: { status: 'delivering', updatedAt: now },
        });
        if (!claimed.count) throw new EntityError(409, 'Delivery is already running');
        await this.recordTaskActivity(tx, taskId, {
          action: action === 'commit' ? 'delivery_commit_started' : 'delivery_merge_started',
          summary: action === 'commit' ? 'Started committing the reviewed ticket changes' : 'Started merging the ticket into the target branch',
        });
        const existing = await tx.agentDelivery.findUnique({ where: { sessionId_attempt: { sessionId: row.id, attempt: row.attempt } } });
        if (existing) return tx.agentDelivery.update({ where: { id: existing.id }, data: {
          status: action === 'commit' ? 'committing' : 'merging', error: '', acknowledgeChecks: input.acknowledgeChecks,
          // Keep the prepared hash if Git already applied it before an interruption.
          ...(existing.targetHead !== preview.targetHead && !alreadyMerged
            ? { targetHead: preview.targetHead, mergeHash: null } : {}),
          updatedAt: now,
        } });
        return tx.agentDelivery.create({ data: {
          id: randomUUID(), sessionId: row.id, attempt: row.attempt, status: 'committing',
          targetBranch: preview.targetBranch, targetHead: preview.targetHead, ticketHead: preview.ticketHead,
          tree: preview.tree, reviewToken: preview.reviewToken, message: input.message,
          acknowledgeChecks: input.acknowledgeChecks, createdAt: now, updatedAt: now,
        } });
      });
      try {
        const projectId = initial.project.id;
        if (action === 'commit') {
          if (preview.ticketHead !== delivery.ticketHead && preview.ticketHead !== delivery.commitHash) {
            throw new EntityError(409, 'The ticket branch changed since delivery started. Inspect it locally before retrying.');
          }
          const commit = delivery.commitHash ?? await this.repositories.operations.createTicketCommit(
            projectId, delivery.sessionId, delivery.tree, delivery.ticketHead, delivery.message, delivery.id,
          );
          // Persist the immutable object before moving a ref, so interrupted operations can be reconciled.
          await this.db.agentDelivery.update({ where: { id: delivery.id }, data: { commitHash: commit } });
          const state = await this.repositories.operations.deliveryState(projectId, delivery.sessionId, delivery.targetBranch);
          if (state.tree !== delivery.tree) throw new EntityError(409, 'Files changed while committing. No branch was updated; inspect the worktree.');
          await this.repositories.operations.applyTicketCommit(projectId, delivery.sessionId, commit, delivery.ticketHead);
          await this.db.$transaction(async (tx) => {
            await tx.agentDelivery.update({ where: { id: delivery.id }, data: { status: 'committed', updatedAt: new Date().toISOString() } });
            await this.recordTaskActivity(tx, taskId, {
              action: 'delivery_committed', summary: 'Committed the reviewed ticket changes',
            });
          });
        } else {
          if (preview.ticketHead !== delivery.commitHash) throw new EntityError(409, 'The ticket branch no longer points to the reviewed delivery commit');
          await this.repositories.operations.applyTicketCommit(projectId, delivery.sessionId, delivery.commitHash!, delivery.ticketHead);
          const merge = delivery.mergeHash ?? await this.repositories.operations.prepareDeliveryMerge(projectId, delivery.targetHead, delivery.commitHash!, delivery.id);
          await this.db.agentDelivery.update({ where: { id: delivery.id }, data: { mergeHash: merge } });
          const state = await this.repositories.operations.deliveryState(projectId, delivery.sessionId, delivery.targetBranch);
          if (state.ticketHead !== delivery.commitHash || state.tree !== delivery.tree) throw new EntityError(409, 'The ticket changed while merging. No merge was applied.');
          const head = await this.repositories.operations.applyDeliveryMerge(projectId, delivery.targetBranch, delivery.targetHead, merge);
          await this.db.$transaction(async (tx) => {
            const row = await tx.agentSession.findUniqueOrThrow({ where: { id: delivery.sessionId } });
            if (row.status !== 'delivering' || row.attempt !== delivery.attempt) throw new EntityError(409, 'The session changed during delivery');
            await this.validateContext(row, tx);
            const completedAt = new Date().toISOString();
            const last = await tx.task.aggregate({ where: { projectId, status: 'Done' }, _max: { order: true } });
            const task = await tx.task.findUniqueOrThrow({ where: { id: taskId } });
            await tx.task.update({ where: { id: taskId }, data: {
              status: 'Done', order: (last._max.order ?? -1) + 1, revision: { increment: 1 }, updatedAt: completedAt,
            } });
            if (task.featureId) await advanceEpicToReviewIfComplete(tx, task.featureId);
            await tx.project.update({ where: { id: projectId }, data: { repositoryCommit: head, revision: { increment: 1 }, updatedAt: completedAt } });
            await tx.agentDelivery.update({ where: { id: delivery.id }, data: { status: 'delivered', error: '', updatedAt: completedAt } });
            await tx.agentSession.update({ where: { id: row.id }, data: { status: 'completed', updatedAt: completedAt } });
            await this.recordTaskActivity(tx, taskId, {
              action: 'delivery_completed', summary: `Merged the ticket into ${delivery.targetBranch} and marked it Done`,
              actor: 'System',
            });
          });
        }
      } catch (error) {
        console.error('Local ticket delivery failed:', error);
        await this.db.$transaction(async (tx) => {
          await tx.agentDelivery.update({ where: { id: delivery.id }, data: {
            status: 'failed', error: error instanceof Error ? error.message : 'Local delivery failed', updatedAt: new Date().toISOString(),
          } });
          await this.recordTaskActivity(tx, taskId, {
            action: 'delivery_failed', summary: 'Ticket delivery failed; inspect the delivery state before retrying', actor: 'System',
          });
        });
        throw error;
      } finally {
        await this.db.agentSession.updateMany({ where: { id: delivery.sessionId, status: 'delivering' }, data: { status: 'completed', updatedAt: new Date().toISOString() } });
      }
      return this.preview(taskId);
    });
  }
}
