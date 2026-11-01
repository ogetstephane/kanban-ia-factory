import { randomUUID } from 'node:crypto';
import type { Prisma, AgentSession } from '@prisma/client';
import type { AgentContext } from '../../src/types/agent';
import { recordActivity } from '../db/activityLog';

export async function replanTicket(tx: Prisma.TransactionClient, row: AgentSession, context: AgentContext, feedback: string, autoExecute = false) {
  const now = new Date().toISOString();
  const questions = await tx.agentQuestion.findMany({ where: { sessionId: row.id }, orderBy: { createdAt: 'asc' } });
  const checks = await tx.agentCheck.findMany({ where: { sessionId: row.id, attempt: row.attempt }, orderBy: { createdAt: 'asc' } });
  await tx.agentAttempt.create({ data: {
    id: randomUUID(), sessionId: row.id, number: row.attempt, createdAt: now,
    snapshot: JSON.parse(JSON.stringify({
      status: row.status, plan: row.plan, output: row.output, error: row.error,
      feedback: row.feedback, reviewStatus: row.reviewStatus, reviewToken: row.reviewToken,
      context: row.context, questions, checks,
      delivery: await tx.agentDelivery.findUnique({ where: { sessionId_attempt: { sessionId: row.id, attempt: row.attempt } } }),
      publication: await tx.reviewPublication.findUnique({ where: { sessionId_attempt: { sessionId: row.id, attempt: row.attempt } } }),
    })),
  } });
  await tx.agentSession.update({ where: { id: row.id }, data: {
    status: 'queued', autoExecute, context: JSON.parse(JSON.stringify(context)), taskRevision: context.task.revision ?? 0,
    plan: '', output: '', error: '', resumeStatus: null, providerSessionId: null,
    attempt: { increment: 1 }, feedback, reviewStatus: 'pending', reviewToken: '', updatedAt: now,
  } });
  await recordActivity(tx, {
    projectId: context.task.projectId, projectName: context.project?.name,
    entityType: 'task', entityId: context.task.id, entityTitle: context.task.title,
    action: 'session_replanned', summary: `Copilot started attempt ${row.attempt + 1}`,
    actor: 'Copilot', changes: [{ field: 'Attempt', before: String(row.attempt), after: String(row.attempt + 1) }],
  });
}

export async function enqueueTicket(tx: Prisma.TransactionClient, context: AgentContext, provider: string, autoExecute = false) {
  const existing = await tx.agentSession.findUnique({ where: { taskId: context.task.id } });
  if (existing) {
    await replanTicket(tx, existing, context, 'The ticket was returned to In Progress. Inspect existing changes and prepare a revised plan.', autoExecute);
    return;
  }
  const now = new Date().toISOString();
  const session = await tx.agentSession.create({
    data: {
      id: randomUUID(), taskId: context.task.id, provider, status: 'queued',
      autoExecute,
      taskRevision: context.task.revision ?? 0,
      context: JSON.parse(JSON.stringify(context)),
      createdAt: now, updatedAt: now,
    },
  });
  await recordActivity(tx, {
    projectId: context.task.projectId, projectName: context.project?.name,
    entityType: 'task', entityId: context.task.id, entityTitle: context.task.title,
    action: 'session_started', summary: 'Copilot session queued', actor: 'Copilot',
    changes: [{ field: 'Session status', before: null, after: session.status }],
  });
}
