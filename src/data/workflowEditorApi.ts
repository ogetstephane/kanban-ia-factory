import { z } from 'zod';
import { request, validInput } from './apiClient';
import { workflowEditorStateSchema, workflowDocumentSchema, workflowScopeSchema, workflowVersionSchema,
  type WorkflowDocument, type WorkflowScope } from '../../shared/types/workflowEditor';

const path = (scope: WorkflowScope) => `/workflow-editor/${scope}`;
export const workflowEditorApi = {
  get: async (scope: WorkflowScope, signal?: AbortSignal) =>
    workflowEditorStateSchema.parse(await request(path(scope), 'GET', undefined, signal)),
  currentOrchestration: async (scope: WorkflowScope) =>
    workflowDocumentSchema.parse(await request(`${path(scope)}/current-orchestration`)),
  base: async (scope: WorkflowScope) =>
    workflowDocumentSchema.parse(await request(`${path(scope)}/base`)),
  save: async (scope: WorkflowScope, revision: number, document: WorkflowDocument) =>
    workflowEditorStateSchema.parse(await request(path(scope), 'PUT', { revision, document: validInput(workflowDocumentSchema, document) })),
  publish: async (scope: WorkflowScope, revision: number) =>
    workflowEditorStateSchema.parse(await request(`${path(scope)}/publish`, 'POST', { revision })),
  select: async (scope: WorkflowScope, revision: number, versionId: string) =>
    workflowEditorStateSchema.parse(await request(`${path(scope)}/select`, 'POST', { revision, versionId })),
  activate: async (scope: WorkflowScope, revision: number, versionId: string | null) =>
    workflowEditorStateSchema.parse(await request(`${path(scope)}/activate`, 'POST', { revision, versionId })),
  resolve: async (scope: WorkflowScope, versionId?: string) =>
    z.object({ scope: workflowScopeSchema, version: workflowVersionSchema, runtimeConnected: z.boolean() })
      .parse(await request(`${path(scope)}/resolve`, 'POST', { versionId })),
};
