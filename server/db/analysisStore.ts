import { Prisma, type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import type { AnalysisResult, AnalysisStore, PreparedAnalysis, ExecutionEvent } from '../agents/core/index';
import type { DeepReadonly } from '../agents/core/snapshot';
import { stableJson, snapshotId } from '../agents/core/snapshot';
import { analysisReportSchema } from '../agents/core/analysis';
import { agentExecutionResultSchema, artifactSchema, executionEventSchema } from '../agents/core/executionValidation';

export const analysisResultSchema = z.object({
  status: z.enum(['succeeded', 'failed', 'cancelled', 'interrupted', 'budget_exceeded']),
  report: analysisReportSchema.optional(),
  reason: z.string().min(1).optional(),
  artifacts: z.array(artifactSchema),
  providerResult: agentExecutionResultSchema.optional(),
}).strict().refine((result) => result.status === 'succeeded'
  ? result.report !== undefined : result.reason !== undefined, 'Result needs a verified report or an explicit failure reason.');

function json(value: unknown): Prisma.InputJsonObject {
  const parsed = z.record(z.string(), z.json()).parse(JSON.parse(stableJson(value)));
  return parsed;
}

export class PrismaAnalysisStore implements AnalysisStore {
  constructor(private readonly db: PrismaClient) {}

  async savePrepared(prepared: DeepReadonly<PreparedAnalysis>) {
    if (snapshotId(prepared.workspace) !== prepared.bundle.workspaceSnapshotId) {
      throw new Error('Prepared analysis workspace hash does not match.');
    }
    await this.db.analysisExecution.create({
      data: { id: prepared.request.executionId, prepared: json(prepared) },
    });
  }

  async appendEvent(input: ExecutionEvent) {
    const event = executionEventSchema.parse(input);
    await this.db.$transaction(async (tx) => {
      const updated = await tx.analysisExecution.updateMany({
        where: { id: event.executionId, status: { in: ['prepared', 'running'] }, nextSequence: event.sequence },
        data: { nextSequence: { increment: 1 }, status: 'running' },
      });
      if (updated.count !== 1) throw new Error('Analysis event is out of order, missing its preparation, or already terminal.');
      await tx.analysisExecutionEvent.create({
        data: { executionId: event.executionId, sequence: event.sequence, occurredAt: event.occurredAt, payload: json(event.payload) },
      });
    });
  }

  async saveResult(executionId: string, input: AnalysisResult, phase: 'preparation' | 'execution' = 'execution') {
    const result = analysisResultSchema.parse(input);
    await this.db.$transaction(async (tx) => {
      const existing = await tx.analysisExecution.findUnique({ where: { id: executionId }, select: { status: true } });
      if (phase === 'preparation') {
        if (existing) throw new Error('Preparation failure cannot overwrite an existing analysis.');
        if (result.status === 'succeeded') throw new Error('A successful analysis must have a persisted preparation.');
        await tx.analysisExecution.create({ data: { id: executionId, status: result.status, result: json(result) } });
        return;
      }
      if (!existing) throw new Error('An execution result must have a persisted preparation.');
      const updated = await tx.analysisExecution.updateMany({
        where: { id: executionId, status: { in: ['prepared', 'running'] } },
        data: { status: result.status, result: json(result) },
      });
      if (updated.count !== 1) throw new Error('Analysis already has a terminal result; it cannot be overwritten.');
    });
  }

  async get(executionId: string) {
    return this.db.analysisExecution.findUnique({
      where: { id: executionId }, include: { events: { orderBy: { sequence: 'asc' } } },
    });
  }
}
