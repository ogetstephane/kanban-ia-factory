import { z } from 'zod';
import { request, validInput } from './apiClient';
import { workflowEditorStateSchema, workflowDocumentSchema, workflowScopeSchema, workflowVersionSchema,
  type WorkflowDocument, type WorkflowScope } from '../../shared/types/workflowEditor';

const path = (scope: WorkflowScope) => `/workflow-editor/${scope}`;
export const workflowEditorApi = {
  get: async (scope: WorkflowScope, signal?: AbortSignal) =>
    workflowEditorStateSchema.parse(await request(path(scope), 'GET', undefined, signal)),
  save: async (scope: WorkflowScope, revision: number, document: WorkflowDocument) =>
    workflowEditorStateSchema.parse(await request(path(scope), 'PUT', { revision, document: validInput(workflowDocumentSchema, document) })),
  publish: async (scope: WorkflowScope, revision: number) =>
    workflowEditorStateSchema.parse(await request(`${path(scope)}/publish`, 'POST', { revision })),
  select: async (scope: WorkflowScope, revision: number, versionId: string) =>
    workflowEditorStateSchema.parse(await request(`${path(scope)}/select`, 'POST', { revision, versionId })),
  resolve: async (scope: WorkflowScope, versionId?: string) =>
    z.object({ scope: workflowScopeSchema, version: workflowVersionSchema, runtimeConnected: z.literal(false) })
      .parse(await request(`${path(scope)}/resolve`, 'POST', { versionId })),
};
