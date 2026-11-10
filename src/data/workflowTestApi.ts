import { z } from 'zod';
import { request, validInput } from './apiClient';
import type { WorkflowScope } from '../../shared/types/workflowEditor';
import { workflowTestLaunchSchema, workflowTestRunSchema, type WorkflowTestLaunch } from '../../shared/types/workflowTestRun';

const root = (scope: WorkflowScope) => `/workflow-editor/${scope}/test-runs`;
const runListSchema = z.array(workflowTestRunSchema.pick({ id: true, status: true, versionNumber: true, createdAt: true }));
export const workflowTestApi = {
  options: async (scope: WorkflowScope, signal?: AbortSignal) =>
    z.object({ realProviders: z.array(z.string()), previewOnly: z.literal(true) }).parse(await request(`${root(scope)}/options`, 'GET', undefined, signal)),
  list: async (scope: WorkflowScope, signal?: AbortSignal) =>
    runListSchema.parse(await request(root(scope), 'GET', undefined, signal)),
  get: async (scope: WorkflowScope, id: string, signal?: AbortSignal) =>
    workflowTestRunSchema.parse(await request(`${root(scope)}/${id}`, 'GET', undefined, signal)),
  launch: async (scope: WorkflowScope, input: WorkflowTestLaunch) =>
    workflowTestRunSchema.parse(await request(root(scope), 'POST', validInput(workflowTestLaunchSchema, input))),
  approve: async (scope: WorkflowScope, id: string, revision: number, nodeId: string) =>
    workflowTestRunSchema.parse(await request(`${root(scope)}/${id}/approve`, 'POST', { revision, nodeId })),
  cancel: async (scope: WorkflowScope, id: string, revision: number) =>
    workflowTestRunSchema.parse(await request(`${root(scope)}/${id}/cancel`, 'POST', { revision })),
};
