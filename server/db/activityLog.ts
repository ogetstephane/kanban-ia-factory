import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import type { z } from 'zod';
import { activityChangesSchema } from '../../shared/types/activity';

type ActivityChange = z.infer<typeof activityChangesSchema>[number];
type ActivityEntity = 'project' | 'feature' | 'task' | 'release';

export function activityChanges(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
  fields: Array<{ key: string; label: string }>,
): ActivityChange[] {
  return fields.flatMap(({ key, label }) => {
    const previous = before?.[key];
    const next = after?.[key];
    if (JSON.stringify(previous) === JSON.stringify(next)) return [];
    return [{
      field: label,
      before: previous === undefined || previous === null ? null : String(previous),
      after: next === undefined || next === null ? null : String(next),
    }];
  });
}

export async function recordActivity(tx: Prisma.TransactionClient, input: {
  projectId?: string | null;
  projectName?: string;
  entityType: ActivityEntity;
  entityId: string;
  entityTitle: string;
  action: string;
  summary: string;
  actor?: 'User' | 'Copilot' | 'System';
  changes?: ActivityChange[];
}) {
  let projectId = input.projectId ?? null;
  let projectName = input.projectName;
  if (projectId && !projectName) {
    projectName = (await tx.project.findUnique({ where: { id: projectId }, select: { name: true } }))?.name ?? 'Deleted project';
  }
  await tx.activityEvent.create({ data: {
    id: randomUUID(), projectId, projectName: projectName ?? 'Unassigned',
    entityType: input.entityType, entityId: input.entityId, entityTitle: input.entityTitle,
    action: input.action, summary: input.summary, actor: input.actor ?? 'User',
    changes: JSON.parse(JSON.stringify(input.changes ?? [])), createdAt: new Date().toISOString(),
  } });
}
