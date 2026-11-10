import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import {
  workflowDocumentSchema, workflowEditorStateSchema, type WorkflowScope, type WorkflowDocument,
} from '../../shared/types/workflowEditor';
import { workflowEditorDefault } from '../agents/workflowEditorDefaults';
import { RepositoryError } from '../git/repositoryService';

const conflict = () => new RepositoryError(409, 'Workflow changed elsewhere. Reload explicitly before replacing your draft.');
const json = (document: WorkflowDocument): Prisma.InputJsonObject => document;

export class WorkflowEditorStore {
  constructor(private readonly db: PrismaClient) {}

  async get(scope: WorkflowScope) {
    return this.read(scope, this.db);
  }

  private async read(scope: WorkflowScope, db: Pick<Prisma.TransactionClient, 'workflowConfiguration'>) {
    const config = await db.workflowConfiguration.findUnique({
      where: { scope }, include: { versions: { orderBy: { number: 'desc' } } },
    });
    return workflowEditorStateSchema.parse(config ? {
      scope, revision: config.revision, draft: config.draft, selectedVersionId: config.selectedVersionId,
      versions: config.versions.map((version) => ({ ...version, createdAt: version.createdAt.toISOString() })),
    } : { scope, revision: 0, draft: await workflowEditorDefault(scope), selectedVersionId: null, versions: [] });
  }

  async save(scope: WorkflowScope, revision: number, input: WorkflowDocument) {
    const document = workflowDocumentSchema.parse(input);
    try {
      return await this.db.$transaction(async (tx) => {
        if (revision === 0) {
          await tx.workflowConfiguration.create({ data: { scope, revision: 1, draft: json(document) } });
        } else {
          const updated = await tx.workflowConfiguration.updateMany({
            where: { scope, revision }, data: { revision: { increment: 1 }, draft: json(document) },
          });
          if (updated.count !== 1) throw conflict();
        }
        return this.read(scope, tx);
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw conflict();
      throw error;
    }
  }

  async publish(scope: WorkflowScope, revision: number) {
    return this.db.$transaction(async (tx) => {
      const current = await tx.workflowConfiguration.findUnique({ where: { scope } });
      if (!current || current.revision !== revision) throw conflict();
      const document = workflowDocumentSchema.parse(current.draft);
      const last = await tx.workflowConfigurationVersion.aggregate({ where: { scope }, _max: { number: true } });
      const id = randomUUID();
      const updated = await tx.workflowConfiguration.updateMany({
        where: { scope, revision }, data: { revision: { increment: 1 }, selectedVersionId: id },
      });
      if (updated.count !== 1) throw conflict();
      await tx.workflowConfigurationVersion.create({
        data: { id, scope, number: (last._max.number ?? 0) + 1, document: json(document) },
      });
      return this.read(scope, tx);
    });
  }

  async select(scope: WorkflowScope, revision: number, versionId: string) {
    return this.db.$transaction(async (tx) => {
      const version = await tx.workflowConfigurationVersion.findFirst({ where: { scope, id: versionId } });
      if (!version) throw new RepositoryError(404, 'Workflow version does not exist in this scope.');
      const updated = await tx.workflowConfiguration.updateMany({
        where: { scope, revision }, data: { revision: { increment: 1 }, selectedVersionId: versionId },
      });
      if (updated.count !== 1) throw conflict();
      return this.read(scope, tx);
    });
  }

  async resolve(scope: WorkflowScope, versionId?: string) {
    const state = await this.get(scope);
    const selected = state.versions.find((version) => version.id === (versionId ?? state.selectedVersionId));
    if (!selected) throw new RepositoryError(404, 'Publish or select a workflow version before resolving a launch snapshot.');
    return { scope, version: selected, runtimeConnected: false as const };
  }
}
