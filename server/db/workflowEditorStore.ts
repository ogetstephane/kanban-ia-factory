import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import {
  workflowDocumentSchema, workflowEditorStateSchema, type WorkflowScope, type WorkflowDocument,
  workflowRuntimeSnapshotSchema, type WorkflowRuntimeSnapshot,
} from '../../shared/types/workflowEditor';
import { RepositoryError } from '../git/repositoryService';
import { builtInWorkflow, currentWorkflowModel, protectedRuntimeShape } from '../agents/currentWorkflowModels';
import { runtimeWorkflowScopeSchema } from '../../shared/types/workflowEditor';
import { workflowGraphErrors } from '../../shared/utils/workflowGraph';

const conflict = () => new RepositoryError(409, 'Workflow changed elsewhere. Reload explicitly before replacing your draft.');
const json = (document: WorkflowDocument): Prisma.InputJsonObject => document;

export async function resolveActiveWorkflow(
  scope: WorkflowScope,
  db: Pick<Prisma.TransactionClient, 'workflowConfiguration' | 'workflowConfigurationVersion'>,
): Promise<WorkflowRuntimeSnapshot> {
  const config = await db.workflowConfiguration.findUnique({ where: { scope }, select: { activeVersionId: true } });
  if (!config?.activeVersionId) return { scope, versionId: null, document: await builtInWorkflow(scope) };
  const version = await db.workflowConfigurationVersion.findFirst({ where: { scope, id: config.activeVersionId } });
  if (!version) throw new RepositoryError(409, 'The active workflow version is missing. Restore the built-in base or activate another version.');
  return workflowRuntimeSnapshotSchema.parse({ scope, versionId: version.id, document: version.document });
}

export class WorkflowEditorStore {
  constructor(private readonly db: PrismaClient) {}

  async get(scope: WorkflowScope) {
    return this.read(scope, this.db);
  }
  async currentOrchestration(scope: WorkflowScope) {
    const supported = runtimeWorkflowScopeSchema.safeParse(scope);
    if (!supported.success) throw new RepositoryError(422, 'Unsupported workflow scope.');
    return currentWorkflowModel(supported.data);
  }
  async base(scope: WorkflowScope) { return builtInWorkflow(scope); }
  async active(scope: WorkflowScope) { return resolveActiveWorkflow(scope, this.db); }

  private async validateReference(scope: WorkflowScope, document: WorkflowDocument) {
    if (!document.runtimeReference) return;
    if (document.runtimeReference.scope !== scope) throw new RepositoryError(400, 'Runtime reference scope does not match this workflow.');
    const canonical = await this.currentOrchestration(scope);
    if (protectedRuntimeShape(document) !== protectedRuntimeShape(canonical)) {
      throw new RepositoryError(400, 'Host operations, transitions, agent identities, tool permissions and autonomy are locked in current orchestration models. Re-import the current model.');
    }
  }

  private async read(scope: WorkflowScope, db: Pick<Prisma.TransactionClient, 'workflowConfiguration'>) {
    const config = await db.workflowConfiguration.findUnique({
      where: { scope }, include: { versions: { orderBy: { number: 'desc' } } },
    });
    return workflowEditorStateSchema.parse(config ? {
      scope, revision: config.revision, draft: config.draft, selectedVersionId: config.selectedVersionId, activeVersionId: config.activeVersionId,
      versions: config.versions.map((version) => ({ ...version, createdAt: version.createdAt.toISOString() })),
    } : { scope, revision: 0, draft: await builtInWorkflow(scope), selectedVersionId: null, activeVersionId: null, versions: [] });
  }

  async save(scope: WorkflowScope, revision: number, input: WorkflowDocument) {
    const document = workflowDocumentSchema.parse(input);
    await this.validateReference(scope, document);
    if (document.execution && document.execution.scope !== scope) throw new RepositoryError(400, 'Executable workflow scope does not match this configuration.');
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
      await this.validateReference(scope, document);
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

  async activate(scope: WorkflowScope, revision: number, versionId: string | null) {
    const version = versionId ? await this.db.workflowConfigurationVersion.findFirst({ where: { scope, id: versionId } }) : null;
    if (versionId && !version) throw new RepositoryError(404, 'Workflow version does not exist in this scope.');
    if (version) {
      const document = workflowDocumentSchema.parse(version.document);
      if (document.execution) {
        const errors = workflowGraphErrors(document, scope);
        if (errors.length) throw new RepositoryError(422, errors.join(' '));
      } else {
        if (document.runtimeReference?.execution !== 'host-runtime') {
          throw new RepositoryError(422, 'Activate an executable prebuilt workflow or a compatible legacy host workflow. Load the prebuilt workflow to draft first.');
        }
        await this.validateReference(scope, document);
        for (const agent of document.agents) {
          if (scope === 'ticket-processing' ? agent.provider !== 'inherit' : !['inherit', 'copilot'].includes(agent.provider)) {
            throw new RepositoryError(422, 'This host workflow cannot change providers. Ticket processing inherits the pinned ticket provider; assistants use Copilot.');
          }
        }
        if (document.prompts.some((prompt) => prompt.variables.length)) {
          throw new RepositoryError(422, 'Host workflow prompts use host-supplied context, not template variables.');
        }
      }
    }
    const base = await builtInWorkflow(scope);
    try {
      return await this.db.$transaction(async (tx) => {
        if (!revision) {
          await tx.workflowConfiguration.create({ data: { scope, revision: 1, draft: json(base), activeVersionId: versionId } });
        } else {
          const updated = await tx.workflowConfiguration.updateMany({
            where: { scope, revision }, data: { revision: { increment: 1 }, activeVersionId: versionId },
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

  async resolve(scope: WorkflowScope, versionId?: string) {
    const state = await this.get(scope);
    const selected = state.versions.find((version) => version.id === (versionId ?? state.selectedVersionId));
    if (!selected) throw new RepositoryError(404, 'Publish or select a workflow version before resolving a launch snapshot.');
    return { scope, version: selected, runtimeConnected: selected.id === state.activeVersionId };
  }
}
