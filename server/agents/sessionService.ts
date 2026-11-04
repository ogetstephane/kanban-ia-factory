import type { PrismaClient, Prisma, AgentSession as DbSession } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { agentContextSchema, agentOptionsSchema, agentOverviewSchema, agentSessionSchema, attemptSnapshotSchema, agentListSchema, deliveryHistorySchema, deliveryHistoryQuerySchema, type AgentListQuery, agentListQuerySchema, type AgentQuestionInput, type AgentRuntime } from '../../shared/types/agent';
import { assignNextRelease, advanceEpicToReviewIfComplete, EntityError, taskData, projectData, featureData } from '../db/entityStore';
import type { RepositoryService } from '../git/repositoryService';
import type { AgentProvider, PlanApprovalRequest } from './provider';
import { agentOverview } from '../../shared/utils/agentTelemetry';
import { enqueueTicket, replanTicket } from './queue';
import { DeliveryService } from './deliveryService';
import { ReviewPublicationService } from './reviewPublicationService';
import { BranchFinishService } from '../git/branchFinishService';
import { recordActivity } from '../db/activityLog';
import { requiredTicketDocumentationPath } from './ticketDocumentation';
import { getAgentWorkflow } from '../../shared/utils/agentWorkflow';
import { agentPhaseSchema, agentWorkflowsSchema } from '../../shared/types/workflow';

export class SessionService {
  private timer?: ReturnType<typeof setInterval>;
  private running = new Set<Promise<void>>();
  private controllers = new Set<AbortController>();
  private jobs = new Map<string, AbortController>();
  private epicJobs = new Set<string>();
  readonly delivery: DeliveryService;
  readonly publication: ReviewPublicationService;
  readonly finish: BranchFinishService;

  constructor(
    private readonly db: PrismaClient,
    private readonly repositories: RepositoryService,
    private readonly provider: AgentProvider,
  ) {
    this.delivery = new DeliveryService(db, repositories, (row, tx) => this.current(row, tx, true));
    this.publication = new ReviewPublicationService(db, repositories, (row, tx) => this.current(row, tx, true, true));
    this.finish = new BranchFinishService(db, repositories);
  }

  private async recordTaskActivity(tx: Prisma.TransactionClient, taskId: string, event: {
    action: string; summary: string; actor?: 'User' | 'Copilot' | 'System';
    changes?: Array<{ field: string; before: string | null; after: string | null }>;
  }) {
    const task = await tx.task.findUnique({ where: { id: taskId }, include: { project: { select: { name: true } } } });
    if (!task) return;
    await recordActivity(tx, {
      projectId: task.projectId, projectName: task.project?.name,
      entityType: 'task', entityId: task.id, entityTitle: task.title, ...event,
    });
  }

  async options() {
    if (!this.provider.models) throw new EntityError(503, 'This agent provider does not expose a model catalogue.');
    return agentOptionsSchema.parse({
      providers: [{
        id: this.provider.id, name: 'GitHub Copilot',
        defaultModel: process.env.COPILOT_MODEL || null,
        models: await this.provider.models(),
      }],
    });
  }

  async start() {
    await this.delivery.recover();
    await this.publication.recover();
    await this.finish.recover();
    await this.db.agentRuntime.updateMany({
      where: { status: 'running' },
      data: { status: 'failed', endedAt: new Date().toISOString(), error: 'Server restarted during the runtime. Telemetry may be incomplete.' },
    });
    await this.db.$transaction(async (tx) => {
      for (const project of await tx.project.findMany({ select: { id: true } })) await assignNextRelease(tx, project.id);
    });
    // A disconnected execution must never be silently replayed after a restart.
    await this.db.$transaction(async (tx) => {
      const interrupted = await tx.agentSession.findMany({
        where: { status: { in: ['planning', 'executing', 'awaiting_input', 'cancelling'] } },
        select: { taskId: true, status: true },
      });
      for (const row of interrupted) {
        const updated = await tx.agentSession.updateMany({
          where: { taskId: row.taskId, status: row.status },
          data: { status: 'failed', error: 'Server restarted during the session. Inspect the worktree before retrying.', updatedAt: new Date().toISOString() },
        });
        if (updated.count) await this.recordTaskActivity(tx, row.taskId, {
          action: 'session_interrupted', summary: `Copilot session interrupted during server restart (${row.status})`, actor: 'System',
        });
      }
    });
    await this.db.$transaction(async (tx) => {
      const features = await tx.feature.findMany({
        where: {
          status: 'In Progress',
          tasks: { some: { agentSession: { is: { autoExecute: true } } } },
        },
        include: { tasks: { include: {
          subtasks: { orderBy: { position: 'asc' } }, project: true, feature: true, agentSession: true,
        } } },
      });
      for (const feature of features) {
        for (const row of feature.tasks) {
          if (row.agentSession) continue;
          await enqueueTicket(tx, {
            task: taskData(row),
            project: row.project ? projectData(row.project) : null,
            feature: row.feature ? featureData(row.feature) : null,
          }, this.provider.id, true);
        }
      }
    });
    this.timer = setInterval(() => { void this.tick(); }, 1000);
    this.timer.unref();
  }

  async stop() {
    clearInterval(this.timer);
    for (const controller of this.controllers) controller.abort();
    await Promise.all(this.running);
    await this.delivery.stop();
    await this.publication.stop();
    await this.finish.stop();
  }

  async get(taskId: string) {
    if (!await this.db.task.findUnique({ where: { id: taskId } })) throw new EntityError(404, 'Task not found');
    const row = await this.db.agentSession.findUnique({ where: { taskId }, include: {
      questions: { orderBy: { createdAt: 'asc' } },
      checks: { orderBy: { createdAt: 'asc' } },
      deliveries: true,
      publications: true,
      task: true,
    } });
    if (!row) return null;
    const runtimes = await this.db.agentRuntime.findMany({
      where: { sessionId: row.id, attempt: row.attempt }, orderBy: { startedAt: 'asc' },
    });
    return agentSessionSchema.parse({ ...row, runtimes, projectId: row.task.projectId, releaseId: row.task.releaseId, checks: row.checks.filter((check) => check.attempt === row.attempt), delivery: row.deliveries.find((item) => item.attempt === row.attempt) ?? null, publication: row.publications.find((item) => item.attempt === row.attempt) ?? null });
  }

  async workflows(projectId?: string) {
    if (projectId && !await this.db.project.findUnique({ where: { id: projectId }, select: { id: true } })) {
      throw new EntityError(404, 'Project not found');
    }
    const rows = await this.db.agentSession.findMany({
      where: projectId ? { task: { OR: [{ projectId }, { projectId: null }] } } : {},
      select: {
        taskId: true, attempt: true, status: true, resumeStatus: true, plan: true, output: true, reviewStatus: true,
        deliveries: { select: { attempt: true, status: true, error: true } },
        publications: { select: { attempt: true, status: true, error: true } },
      },
    });
    return agentWorkflowsSchema.parse(Object.fromEntries(rows.map((row) => [row.taskId, getAgentWorkflow({
      status: agentSessionSchema.shape.status.parse(row.status),
      resumeStatus: agentPhaseSchema.parse(row.resumeStatus),
      plan: row.plan, output: row.output,
      reviewStatus: agentSessionSchema.shape.reviewStatus.parse(row.reviewStatus),
      delivery: row.deliveries.find((item) => item.attempt === row.attempt),
      publication: row.publications.find((item) => item.attempt === row.attempt),
    })])));
  }

  async history(taskId: string) {
    const session = await this.db.agentSession.findUnique({ where: { taskId }, select: { id: true } });
    if (!session) throw new EntityError(404, 'Session not found');
    const [attempts, runtimes] = await this.db.$transaction([
      this.db.agentAttempt.findMany({ where: { sessionId: session.id }, orderBy: { number: 'desc' }, select: { number: true, snapshot: true, createdAt: true } }),
      this.db.agentRuntime.findMany({ where: { sessionId: session.id }, orderBy: { startedAt: 'asc' } }),
    ]);
    return attempts.map((attempt) => ({
      ...attempt,
      snapshot: {
        ...attemptSnapshotSchema.parse(attempt.snapshot),
        runtimes: runtimes.filter((runtime) => runtime.attempt === attempt.number),
      },
    }));
  }

  private runtimeRecorder(row: DbSession) {
    return async (runtime: AgentRuntime) => {
      const data = {
        ...runtime,
        metadata: JSON.parse(JSON.stringify(runtime.metadata)),
        events: JSON.parse(JSON.stringify(runtime.events)),
        summary: agentOverview(runtime),
      };
      await this.db.agentRuntime.upsert({
        where: { id: runtime.id },
        create: { ...data, sessionId: row.id, attempt: row.attempt },
        update: data,
      });
    };
  }

  async deliveryHistory(input: unknown) {
    const query = deliveryHistoryQuerySchema.parse(input);
    const where: Prisma.AgentDeliveryWhereInput = {
      status: query.status,
      session: { task: {
        projectId: query.projectId,
        ...(query.search ? { OR: [
          { title: { contains: query.search } },
          { project: { name: { contains: query.search } } },
          { feature: { title: { contains: query.search } } },
          { release: { version: { contains: query.search } } },
        ] } : {}),
      } },
    };
    const pageSize = 25;
    const [rows, total] = await this.db.$transaction([
      this.db.agentDelivery.findMany({
        where, orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * pageSize, take: pageSize,
        select: {
          id: true, sessionId: true, attempt: true, status: true, targetBranch: true,
          commitHash: true, mergeHash: true, error: true, createdAt: true, updatedAt: true,
          session: { select: { task: { select: {
            id: true, title: true, projectId: true,
            project: { select: { name: true } }, feature: { select: { title: true } },
            release: { select: { version: true } },
          } } } },
        },
      }),
      this.db.agentDelivery.count({ where }),
    ]);
    return deliveryHistorySchema.parse({
      items: rows.map((row) => ({
        id: row.id, sessionId: row.sessionId, attempt: row.attempt, status: row.status,
        targetBranch: row.targetBranch, commitHash: row.commitHash, mergeHash: row.mergeHash,
        error: row.error, createdAt: row.createdAt, updatedAt: row.updatedAt,
        taskId: row.session.task.id, taskTitle: row.session.task.title,
        projectId: row.session.task.projectId ?? '', projectName: row.session.task.project?.name ?? 'Unknown project',
        featureTitle: row.session.task.feature?.title ?? null, releaseVersion: row.session.task.release?.version ?? null,
      })),
      total, page: query.page, pageSize,
    });
  }

  async list(input: AgentListQuery) {
    const query = agentListQuerySchema.parse(input);
    const where: Prisma.AgentSessionWhereInput = {
      status: query.status,
      ...(query.actionable ? { OR: [
        { status: { in: ['awaiting_input', 'awaiting_approval', 'failed'] } },
        { status: 'completed', reviewStatus: 'pending' },
        ...(query.actionable === 'cockpit' ? [{
          status: 'completed', reviewStatus: 'accepted', deliveries: { none: { status: 'delivered' } },
        }] : []),
      ] } : {}),
      task: {
        projectId: query.projectId, featureId: query.featureId, priority: query.priority,
        ...(query.search ? { OR: [
          { title: { contains: query.search } }, { description: { contains: query.search } },
          { project: { name: { contains: query.search } } },
          { feature: { title: { contains: query.search } } },
        ] } : {}),
      },
    };
    const pageSize = 25;
    const [rows, total, projects, features, actionCount] = await this.db.$transaction([
      this.db.agentSession.findMany({
        where, orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
        skip: (query.page - 1) * pageSize, take: pageSize,
        select: {
          id: true, taskId: true, provider: true, status: true, taskRevision: true,
          workspace: true, branch: true, baseCommit: true, providerSessionId: true,
          error: true, createdAt: true, updatedAt: true,
          attempt: true, reviewStatus: true, resumeStatus: true, plan: true, output: true,
          deliveries: { select: { attempt: true, status: true, error: true } },
          publications: { select: { attempt: true, status: true, error: true } },
          runtimes: { select: { attempt: true, summary: true }, orderBy: { startedAt: 'desc' } },
          task: { select: {
            title: true, status: true, priority: true, projectId: true, featureId: true,
            project: { select: { name: true } }, feature: { select: { title: true } },
          } },
        },
      }),
      this.db.agentSession.count({ where }),
      this.db.project.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      this.db.feature.findMany({ select: { id: true, title: true, projectId: true }, orderBy: { title: 'asc' } }),
      this.db.agentSession.count({ where: { task: where.task, OR: [
        { status: { in: ['awaiting_input', 'awaiting_approval', 'failed'] } },
        { status: 'completed', reviewStatus: 'pending' },
        ...(query.actionable === 'cockpit' ? [{
          status: 'completed', reviewStatus: 'accepted', deliveries: { none: { status: 'delivered' } },
        }] : []),
      ] } }),
    ]);
    return agentListSchema.parse({
      items: rows.map((row) => ({
        ...row, deliveryStatus: row.deliveries.find((delivery) => delivery.attempt === row.attempt)?.status ?? null,
        workflow: getAgentWorkflow({
          status: agentSessionSchema.shape.status.parse(row.status), resumeStatus: agentPhaseSchema.parse(row.resumeStatus),
          reviewStatus: row.reviewStatus, plan: row.plan, output: row.output,
          delivery: row.deliveries.find((item) => item.attempt === row.attempt),
          publication: row.publications.find((item) => item.attempt === row.attempt),
        }),
        taskTitle: row.task.title, taskStatus: row.task.status, priority: row.task.priority,
        projectId: row.task.projectId, projectName: row.task.project?.name ?? null,
        featureId: row.task.featureId, featureTitle: row.task.feature?.title ?? null,
        agent: agentOverviewSchema.nullable().catch(null).parse(
          row.runtimes.find((runtime) => runtime.attempt === row.attempt && runtime.summary)?.summary ?? null),
      })),
      total, page: query.page, pageSize, projects, features, actionCount,
    });
  }

  async answer(taskId: string, sessionId: string, questionId: string, answer: string) {
    await this.db.$transaction(async (tx) => {
      const session = await tx.agentSession.findFirst({ where: { id: sessionId, taskId, status: 'awaiting_input' } });
      if (!session) throw new EntityError(409, 'This session is not waiting for an answer');
      const question = await tx.agentQuestion.findFirst({ where: { id: questionId, sessionId, answer: null } });
      if (!question) throw new EntityError(409, 'This question has already been answered or is no longer active');
      if (!question.allowFreeform && !(Array.isArray(question.choices) && question.choices.includes(answer))) {
        throw new EntityError(400, 'Choose one of the proposed answers');
      }
      const updated = await tx.agentQuestion.updateMany({
        where: { id: questionId, answer: null }, data: { answer, answeredAt: new Date().toISOString() },
      });
      if (!updated.count) throw new EntityError(409, 'Question already answered');
      await tx.agentSession.update({ where: { id: sessionId }, data: { updatedAt: new Date().toISOString() } });
      await this.recordTaskActivity(tx, taskId, {
        action: 'question_answered', summary: 'Answered a Copilot question',
        changes: [{ field: 'Question', before: 'Waiting for answer', after: 'Answered' }],
      });
    });
    return this.get(taskId);
  }

  private async ask(row: DbSession, resumeStatus: string, question: AgentQuestionInput, signal: AbortSignal) {
    if (!question.allowFreeform && question.choices.length === 0) throw new Error('Question has no answer choices');
    const id = randomUUID();
    const now = new Date().toISOString();
    await this.db.$transaction(async (tx) => {
      const claimed = await tx.agentSession.updateMany({
        where: { id: row.id, status: resumeStatus },
        data: { status: 'awaiting_input', resumeStatus, updatedAt: now },
      });
      if (!claimed.count) throw new Error('Another question is already pending, or the session has stopped');
      await tx.agentQuestion.create({ data: { id, sessionId: row.id, ...question, createdAt: now } });
      await this.recordTaskActivity(tx, row.taskId, {
        action: 'question_asked', summary: 'Copilot asked a question', actor: 'Copilot',
      });
    });
    const deadline = Date.now() + 55 * 60_000;
    while (!signal.aborted && Date.now() < deadline) {
      const result = await this.db.agentQuestion.findUniqueOrThrow({ where: { id } });
      if (result.answer !== null) {
        signal.throwIfAborted();
        const resumed = await this.db.agentSession.updateMany({
          where: { id: row.id, status: 'awaiting_input', attempt: row.attempt },
          data: { status: resumeStatus, resumeStatus, updatedAt: new Date().toISOString() },
        });
        if (!resumed.count) throw new Error('Session is no longer waiting for an answer');
        return result.answer;
      }
      await sleep(500, undefined, { signal });
    }
    throw new Error(signal.aborted ? 'Session stopped by the server' : 'No answer received within 55 minutes; regenerate the plan to resume');
  }

  private async current(row: DbSession, tx: Prisma.TransactionClient = this.db, reviewing = false, allowDone = false) {
    const task = await tx.task.findUnique({ where: { id: row.taskId }, include: { subtasks: { orderBy: { position: 'asc' } } } });
    if (!task || !(reviewing ? ['In Progress', 'Review', ...(allowDone ? ['Done'] : [])] : ['In Progress']).includes(task.status)) throw new EntityError(409, 'The ticket must still be In Progress or under review');
    const relevant = (value: ReturnType<typeof taskData>) => {
      const { revision: _revision, updatedAt: _updated, order: _order, blockedReason: _blockedReason, releaseId: _releaseId, ...scope } = value;
      return JSON.stringify(reviewing ? { ...scope, status: undefined } : scope);
    };
    const snapshot = agentContextSchema.parse(row.context);
    const project = task.projectId ? await tx.project.findUnique({ where: { id: task.projectId } }) : null;
    const feature = task.featureId ? await tx.feature.findUnique({ where: { id: task.featureId } }) : null;
    const projectScope = (value: { id: string; name: string; description: string; repositoryUrl?: string | null } | null) =>
      value ? [value.id, value.name, value.description, value.repositoryUrl] : null;
    const featureScope = (value: { id: string; title: string; description: string; category: string } | null) =>
      value ? [value.id, value.title, value.description, value.category] : null;
    if (relevant(taskData(task)) !== relevant(snapshot.task) ||
      JSON.stringify(projectScope(project)) !== JSON.stringify(projectScope(snapshot.project)) ||
      JSON.stringify(featureScope(feature)) !== JSON.stringify(featureScope(snapshot.feature))) {
      throw new EntityError(409, 'The ticket changed since this plan was prepared. Regenerate the plan before approving.');
    }
  }

  async approve(taskId: string, sessionId: string, planUpdatedAt: string) {
    const row = await this.db.agentSession.findUnique({ where: { taskId } });
    if (!row || row.id !== sessionId) throw new EntityError(404, 'Session not found');
    if (row.updatedAt !== planUpdatedAt) throw new EntityError(409, 'This plan changed. Reload and read the latest plan before approving.');
    await this.db.$transaction(async (tx) => {
      await this.current(row, tx);
      const updated = await tx.agentSession.updateMany({
        where: { id: row.id, status: 'awaiting_approval', updatedAt: planUpdatedAt },
        data: { status: 'execution_queued', resumeStatus: 'executing', updatedAt: new Date().toISOString() },
      });
      if (updated.count !== 1) throw new EntityError(409, 'This session is not awaiting approval');
      await this.recordTaskActivity(tx, taskId, {
        action: 'plan_approved', summary: 'Approved Copilot plan; execution queued',
        changes: [{ field: 'Session status', before: 'Awaiting approval', after: 'Execution queued' }],
      });
    });
    return this.get(taskId);
  }

  async retry(taskId: string, sessionId: string, feedback?: string, expectedUpdatedAt?: string) {
    await this.db.$transaction(async (tx) => {
      const row = await tx.agentSession.findFirst({ where: { id: sessionId, taskId } });
      if (row && expectedUpdatedAt && row.updatedAt !== expectedUpdatedAt) throw new EntityError(409, 'This session changed. Reload before requesting a new plan.');
      if (!row || !(feedback ? ['completed', 'failed', 'cancelled', 'awaiting_approval'] : ['failed', 'cancelled', 'awaiting_approval']).includes(row.status)) {
        throw new EntityError(409, 'Only stopped sessions or unapproved plans can be regenerated; completed sessions need correction feedback');
      }
      if (this.jobs.has(sessionId)) throw new EntityError(409, 'The previous worker is still stopping; try again shortly');
      let task = await tx.task.findUnique({ where: { id: taskId }, include: { subtasks: { orderBy: { position: 'asc' } } } });
      if (!task || !['In Progress', ...(feedback ? ['Review'] : [])].includes(task.status)) throw new EntityError(409, 'The ticket must be In Progress (or Review when requesting corrections)');
      if (task.status === 'Review') {
        task = await tx.task.update({ where: { id: task.id }, data: { status: 'In Progress', revision: { increment: 1 }, updatedAt: new Date().toISOString() }, include: { subtasks: { orderBy: { position: 'asc' } } } });
      }
      const project = task.projectId ? await tx.project.findUnique({ where: { id: task.projectId } }) : null;
      let feature = task.featureId ? await tx.feature.findUnique({ where: { id: task.featureId } }) : null;
      if (feature?.status === 'Review' && feedback) {
        feature = await tx.feature.update({ where: { id: feature.id }, data: { status: 'In Progress', revision: { increment: 1 } } });
        await recordActivity(tx, {
          projectId: feature.projectId, entityType: 'feature', entityId: feature.id, entityTitle: feature.title,
          action: 'status_changed', summary: 'Epic reopened for ticket corrections',
          changes: [{ field: 'Status', before: 'Review', after: 'In Progress' }],
        });
      }
      const context = agentContextSchema.parse({
        task: taskData(task), project: project ? projectData(project) : null, feature: feature ? featureData(feature) : null,
      });
      await replanTicket(tx, { ...row, reviewStatus: feedback ? 'changes_requested' : row.reviewStatus }, context, feedback ?? row.feedback, false, row.status === 'awaiting_approval');
    });
    return this.get(taskId);
  }

  async cancel(taskId: string, sessionId: string) {
    const stopped = await this.db.$transaction(async (tx) => {
      const result = await tx.agentSession.updateMany({
        where: { id: sessionId, taskId, status: { in: ['queued', 'planning', 'awaiting_input', 'awaiting_approval', 'execution_queued', 'executing'] } },
        data: { status: 'cancelling', updatedAt: new Date().toISOString() },
      });
      if (result.count) await this.recordTaskActivity(tx, taskId, {
        action: 'session_cancellation_requested', summary: 'Requested cancellation of the Copilot session',
      });
      return result;
    });
    if (!stopped.count) throw new EntityError(409, 'This session is already stopped or stopping');
    const controller = this.jobs.get(sessionId);
    if (controller) controller.abort();
    else await this.db.agentSession.updateMany({
      where: { id: sessionId, status: 'cancelling' },
      data: { status: 'cancelled', error: 'Session cancelled by user. Inspect any partial changes.' },
    });
    return this.get(taskId);
  }

  async review(taskId: string, previewPath?: string, includePatches = false) {
    const row = await this.db.agentSession.findUnique({ where: { taskId }, include: {
      task: { include: { feature: true, project: true } },
    } });
    if (!row?.workspace || !row.baseCommit || !row.task.projectId) throw new EntityError(409, 'No ticket worktree is available yet');
    if (['queued', 'planning', 'awaiting_input', 'execution_queued', 'executing', 'cancelling', 'delivering'].includes(row.status)) throw new EntityError(409, 'Wait for the session to stop before reviewing its changes');
    const documentationPath = requiredTicketDocumentationPath({
      docsPath: row.task.project?.docsPath,
      taskId: row.task.id,
      taskTitle: row.task.title,
      featureTitle: row.task.feature?.title,
    });
    return {
      ...await this.repositories.operations.ticketReview(row.task.projectId, row.id, row.baseCommit, previewPath, documentationPath, includePatches),
      criteria: row.task.acceptanceCriteria,
    };
  }

  async aiReview(taskId: string, token: string) {
    const row = await this.db.agentSession.findUnique({ where: { taskId } });
    if (!row?.workspace) throw new EntityError(409, 'No ticket worktree is available yet');
    const review = await this.review(taskId, undefined, true);
    if (review.token !== token) throw new EntityError(409, 'Files changed since this review was opened. Reload the diff and run the AI review again.');
    const report = await this.provider.run({
      context: agentContextSchema.parse(row.context),
      workspace: row.workspace,
      phase: 'review',
      plan: row.plan,
      reviewDiff: JSON.stringify({
        baseCommit: review.baseCommit,
        documentation: review.documentation,
        criteria: review.criteria,
        files: review.files.map(({ path, status, patch, binary, truncated }) => ({ path, status, patch, binary, truncated })),
      }),
      onSession: async () => undefined,
      onRuntime: this.runtimeRecorder(row),
      ask: async () => { throw new Error('Automated review cannot ask questions'); },
      answers: [],
    });
    if (!report.trim()) throw new Error('AI provider returned an empty review');
    if ((await this.review(taskId)).token !== token) {
      throw new EntityError(409, 'Files changed while the AI review was running. Reload the diff and run it again.');
    }
    return { token, report: report.slice(0, 30_000) };
  }

  async acceptReview(taskId: string, sessionId: string, updatedAt: string, token: string) {
    const review = await this.review(taskId);
    if (!review.documentation) throw new EntityError(500, 'Ticket review did not return documentation status');
    if (!review.documentation.ready) {
      throw new EntityError(409, `Add non-empty task documentation at ${review.documentation.path} before accepting this review`);
    }
    if (review.token !== token) throw new EntityError(409, 'Files changed since you opened the review. Reload the diff before accepting.');
    await this.db.$transaction(async (tx) => {
      const row = await tx.agentSession.findFirst({ where: { id: sessionId, taskId, updatedAt, status: 'completed', reviewStatus: { in: ['pending', 'accepted'] } } });
      if (!row) throw new EntityError(409, 'This execution changed or is not awaiting review');
      const task = await tx.task.findUniqueOrThrow({ where: { id: taskId }, include: { feature: true } });
      const publication = await tx.reviewPublication.findUnique({ where: { sessionId_attempt: { sessionId: row.id, attempt: row.attempt } } });
      if (publication?.status === 'pushed') throw new EntityError(409, 'This review was already validated and pushed');
      await this.current(row, tx, true, task.status === 'Done' && task.feature?.status === 'Review');
      await tx.agentSession.update({ where: { id: row.id }, data: { reviewStatus: 'accepted', reviewToken: token, updatedAt: new Date().toISOString() } });
      if (row.reviewStatus !== 'accepted') await this.recordTaskActivity(tx, taskId, {
        action: 'review_accepted', summary: 'Accepted the human code review',
        changes: [{ field: 'Review', before: row.reviewStatus, after: 'accepted' }],
      });
    });
    return this.get(taskId);
  }

  async health(projectId: string) {
    const project = await this.db.project.findUnique({ where: { id: projectId } });
    if (!project) throw new EntityError(404, 'Project not found');
    const issues: string[] = [];
    let repository: { branch: string; commit: string; scripts: string[] } | null = null;
    if (!project.repositoryUrl) issues.push('No repository is associated with this project');
    else {
      try { repository = await this.repositories.workspaces.health(projectId); }
      catch (error) {
        console.error('Project repository diagnostic failed:', error);
        issues.push(error instanceof Error ? error.message : 'Repository diagnostic failed');
      }
    }
    let authenticated: boolean | null = null;
    if (this.provider.health) {
      try {
        const health = await this.provider.health();
        authenticated = health.authenticated;
        if (!authenticated) issues.push(health.issue ?? 'AI provider is not authenticated');
      } catch (error) {
        console.error('Provider diagnostic failed:', error);
        issues.push(error instanceof Error ? error.message : 'AI provider diagnostic failed');
      }
    } else issues.push('This provider does not expose an authentication diagnostic');
    for (const script of ['test', 'lint']) {
      if (!repository?.scripts.includes(script)) issues.push(`No npm ${script} script is available`);
    }
    const sessions = await this.db.agentSession.findMany({
      where: { task: { projectId }, workspace: { not: null } }, select: { workspace: true, branch: true, status: true, taskId: true, id: true, updatedAt: true },
    });
    return {
      projectName: project.name, branch: repository?.branch ?? null, commit: repository?.commit ?? null,
      scripts: repository?.scripts ?? [], provider: this.provider.id, authenticated, issues,
      worktrees: sessions.map((session) => ({ path: session.workspace!, branch: session.branch ?? '', status: session.status, taskId: session.taskId, sessionId: session.id, updatedAt: session.updatedAt })),
    };
  }

  async cleanup(taskId: string, sessionId: string, updatedAt: string) {
    await this.db.$transaction(async (tx) => {
      const row = await tx.agentSession.findFirst({ where: { id: sessionId, taskId, updatedAt }, include: { task: true } });
      if (!row?.task.projectId || !row.baseCommit || !row.workspace) throw new EntityError(409, 'Worktree changed or is unavailable');
      if (!['completed', 'failed', 'cancelled'].includes(row.status) || this.jobs.has(row.id)) throw new EntityError(409, 'Only stopped sessions can be cleaned up');
      await this.repositories.operations.cleanupTicket(row.task.projectId, row.id, row.baseCommit);
      await tx.agentSession.update({ where: { id: row.id }, data: { workspace: null, updatedAt: new Date().toISOString() } });
      await this.recordTaskActivity(tx, taskId, {
        action: 'worktree_cleaned', summary: 'Removed the stopped session worktree',
      });
    });
    return this.get(taskId);
  }

  async tick() {
    if (this.running.size >= 3) return;
    const controller = new AbortController();
    this.controllers.add(controller);
    const running = this.processNext(controller).catch((error: unknown) => {
      console.error('Agent queue failed:', error);
    }).finally(() => { this.running.delete(running); this.controllers.delete(controller); });
    this.running.add(running);
    return running;
  }

  private async processNext(controller: AbortController) {
    const signal = controller.signal;
    const candidates = await this.db.agentSession.findMany({
      where: { status: { in: ['queued', 'execution_queued'] } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 100,
    });
    let row: DbSession | undefined;
    let epicFeatureId: string | undefined;
    for (const candidate of candidates) {
      if (candidate.autoExecute) {
        const featureId = (await this.db.task.findUnique({
          where: { id: candidate.taskId }, select: { featureId: true },
        }))?.featureId ?? undefined;
        if (featureId && this.epicJobs.has(featureId)) continue;
        if (featureId) {
          const activeSibling = await this.db.agentSession.count({
            where: {
              id: { not: candidate.id }, task: { featureId },
              status: { in: ['planning', 'awaiting_input', 'awaiting_approval', 'execution_queued', 'executing', 'cancelling', 'delivering'] },
            },
          });
          if (activeSibling) continue;
          epicFeatureId = featureId;
        }
      }
      row = candidate;
      break;
    }
    if (!row) return;
    if (epicFeatureId) this.epicJobs.add(epicFeatureId);
    // Queued tickets execute adaptively: the agent decides whether a plan approval is needed.
    const phase = row.status === 'queued' && row.resumeStatus === 'planning' ? 'plan' : 'execute';
    const adaptive = row.status === 'queued' && phase === 'execute';
    const activeStatus = phase === 'plan' ? 'planning' : 'executing';
    let planRequest: PlanApprovalRequest | undefined;
    try {
      const claimed = await this.db.$transaction(async (tx) => {
        if (epicFeatureId && await tx.agentSession.count({
          where: {
            id: { not: row!.id }, task: { featureId: epicFeatureId },
            status: { in: ['planning', 'awaiting_input', 'awaiting_approval', 'execution_queued', 'executing', 'cancelling', 'delivering'] },
          },
        })) return { count: 0 };
        const result = await tx.agentSession.updateMany({
          where: { id: row!.id, status: row!.status },
          data: { status: activeStatus, resumeStatus: activeStatus, error: '', updatedAt: new Date().toISOString() },
        });
        if (result.count) await this.recordTaskActivity(tx, row!.taskId, {
          action: 'session_running',
          summary: phase === 'plan' ? 'Copilot started preparing a plan' : adaptive ? 'Copilot started adaptive execution' : 'Copilot started approved execution',
          actor: 'Copilot', changes: [{ field: 'Session status', before: row!.status, after: activeStatus }],
        });
        return result;
      });
      if (!claimed.count) return;
      this.jobs.set(row.id, controller);
      const latest = await this.db.agentSession.findUniqueOrThrow({ where: { id: row.id } });
      if (latest.status !== activeStatus) { controller.abort(); signal.throwIfAborted(); }
      await this.current(row);
      if (row.provider !== this.provider.id) throw new Error(`Agent provider is unavailable: ${row.provider}`);
      const context = agentContextSchema.parse(row.context);
      if (!context.project?.repositoryUrl || !context.project.repositoryBranch) {
        throw new Error('Associate a git repository with commits to the project before executing a ticket');
      }
      const prepared = await this.repositories.workspaces.ticketWorkspace(context.project.id, row.id, context.project.repositoryBranch, context.task.title);
      const workspace = prepared.workspace;
      await this.db.agentSession.update({
        where: { id: row.id }, data: { ...prepared, baseCommit: row.baseCommit ?? prepared.baseCommit, updatedAt: new Date().toISOString() },
      });
      let questions = Promise.resolve();
      let questionFailure: unknown;
      const output = await this.provider.run({
        context, workspace, phase, plan: row.plan,
        signal, feedback: row.feedback, adaptive,
        requestPlanApproval: async (proposal) => {
          signal.throwIfAborted();
          planRequest = proposal;
        },
        onRuntime: this.runtimeRecorder(row),
        onContent: async (content) => {
          signal.throwIfAborted();
          await this.db.agentSession.updateMany({
            where: { id: row.id, status: activeStatus, attempt: row.attempt },
            data: { [phase === 'plan' ? 'plan' : 'output']: content, updatedAt: new Date().toISOString() },
          });
        },
        recordCheck: async (result) => {
          signal.throwIfAborted();
          await this.db.agentCheck.create({ data: {
            id: randomUUID(), sessionId: row.id, attempt: row.attempt,
            ...result, output: result.output.length > 256_000 ? `${result.output.slice(0, 256_000)}\n[Check output truncated at 256,000 characters]` : result.output,
            createdAt: new Date().toISOString(),
          } });
        },
        ask: (question) => {
          // A provider may invoke tools concurrently; present only one question at a time.
          const answer = questions.then(() => this.ask(row, activeStatus, question, signal));
          questions = answer.then(() => undefined, (error: unknown) => { questionFailure = error; });
          return answer;
        },
        answers: (await this.db.agentQuestion.findMany({
          where: { sessionId: row.id, answer: { not: null } }, orderBy: { createdAt: 'asc' },
        })).map((question) => ({ question: question.question, answer: question.answer! })),
        onSession: async (id) => {
          await this.db.agentSession.updateMany({ where: { id: row.id, status: activeStatus }, data: { providerSessionId: id } });
        },
      });
      await questions;
      signal.throwIfAborted();
      if (questionFailure) throw questionFailure;
      if (!output.trim()) throw new Error('The agent returned no result');
      const escalation = planRequest;
      await this.db.$transaction(async (tx) => {
        if (escalation) {
          const plan = `${escalation.plan.trim()}\n\n> **Why approval is needed:** ${escalation.reason.trim()}`;
          const escalated = await tx.agentSession.updateMany({
            where: { id: row.id, status: activeStatus, attempt: row.attempt },
            data: { status: 'awaiting_approval', resumeStatus: 'awaiting_approval', plan, output: '', updatedAt: new Date().toISOString() },
          });
          if (escalated.count) await this.recordTaskActivity(tx, row.taskId, {
            action: 'plan_ready', summary: 'Copilot judged the ticket complex; plan is ready for approval', actor: 'Copilot',
            changes: [{ field: 'Session status', before: activeStatus, after: 'Awaiting approval' }],
          });
          return;
        }
        if (phase === 'execute') await this.current(row, tx);
        const completed = await tx.agentSession.updateMany({
          where: { id: row.id, status: activeStatus, attempt: row.attempt },
          data: {
            status: phase === 'plan' ? (row.autoExecute ? 'execution_queued' : 'awaiting_approval') : 'completed',
            resumeStatus: phase === 'plan' && !row.autoExecute ? 'awaiting_approval' : 'executing',
            ...(phase === 'plan' ? { plan: output } : { output }),
            updatedAt: new Date().toISOString(),
          },
        });
        if (completed.count && phase === 'execute') {
          const task = await tx.task.findUniqueOrThrow({ where: { id: row.taskId } });
          const last = await tx.task.aggregate({ where: { projectId: task.projectId, status: 'Review' }, _max: { order: true } });
          await tx.task.update({ where: { id: task.id }, data: {
            status: 'Review', order: (last._max.order ?? -1) + 1,
            revision: { increment: 1 }, updatedAt: new Date().toISOString(),
          } });
          await this.recordTaskActivity(tx, task.id, {
            action: 'status_changed', summary: 'Agent execution completed; ticket moved to Review', actor: 'Copilot',
            changes: [{ field: 'Status', before: task.status, after: 'Review' }],
          });
          if (task.featureId) await advanceEpicToReviewIfComplete(tx, task.featureId);
        }
        if (completed.count) await this.recordTaskActivity(tx, row.taskId, {
          action: phase === 'plan' ? 'plan_ready' : 'execution_completed',
          summary: phase === 'plan'
            ? row.autoExecute ? 'Copilot prepared a plan; automatic epic execution is queued' : 'Copilot plan is ready for approval'
            : 'Copilot execution completed; review is ready',
          actor: 'Copilot',
          changes: [{ field: 'Session status', before: activeStatus, after: phase === 'plan'
            ? row.autoExecute ? 'Execution queued' : 'Awaiting approval' : 'Completed' }],
        });
      });
    } catch (error) {
      const latest = await this.db.agentSession.findUnique({ where: { id: row.id } });
      const cancelled = latest?.status === 'cancelling' || latest?.status === 'cancelled';
      if (!cancelled) console.error(`Agent session ${row.id} failed:`, error);
      await this.db.$transaction(async (tx) => {
        const stopped = await tx.agentSession.updateMany({
          where: { id: row.id, attempt: row.attempt, status: { in: [activeStatus, 'awaiting_input', 'cancelling'] } },
          data: {
            status: cancelled ? 'cancelled' : 'failed',
            error: cancelled ? 'Session cancelled by user. Inspect any partial changes.' : error instanceof Error ? error.message : 'Agent session failed',
            updatedAt: new Date().toISOString(),
          },
        });
        if (stopped.count) await this.recordTaskActivity(tx, row.taskId, {
          action: cancelled ? 'session_cancelled' : 'session_failed',
          summary: cancelled ? 'Copilot session cancelled' : 'Copilot session failed; attention required',
          actor: 'Copilot', changes: [{ field: 'Session status', before: latest?.status ?? activeStatus, after: cancelled ? 'Cancelled' : 'Failed' }],
        });
      });
    } finally {
      this.jobs.delete(row.id);
      if (epicFeatureId) this.epicJobs.delete(epicFeatureId);
    }
  }
}
