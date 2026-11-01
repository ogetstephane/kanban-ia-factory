import { z } from 'zod';
import {
  boardDataSchema, projectSchema, projectSummarySchema, projectBoardSchema,
  featureSchema, taskSchema, breakdownSchema, remoteBranchesSchema, localRepositoriesSchema, workspaceBranchesSchema, type BoardData, type RepositoryInput,
} from '../types/board';
import type { Project, Feature, Task, KanbanStatus } from '../types/kanban';
import { INITIAL_PROJECTS, INITIAL_FEATURES, INITIAL_TASKS } from './initialData';
import { agentSessionSchema, agentListSchema, reviewSchema, aiReviewResultSchema, projectHealthSchema, deliveryPreviewSchema, deliveryHistorySchema, publicationPreviewSchema, type PublicationRequest, type DeliveryRequest, type AgentListQuery } from '../types/agent';
import { releaseSchema, releaseDetailSchema, releasePreviewSchema, releasePublishSchema, releaseEditSchema, releaseUpdateSchema } from '../types/release';
import { gitInventorySchema, publishedWorkListSchema, finishPreviewSchema, type FinishRequest } from '../types/git';
import { activityListSchema, type ActivityQuery } from '../types/activity';
import { docListSchema, docContentSchema, docSaveResultSchema, docStatusSchema, docSyncResultSchema, wikiAssistantInputSchema, wikiAssistantResultSchema, type WikiAssistantInput } from '../types/wiki';
import { ALL_PROJECTS } from '../utils/projectLogic';

export class BoardApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function request(route: string, method = 'GET', data?: unknown, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(`/api/board${route}`, {
    method, cache: 'no-store', signal,
    headers: { 'Content-Type': 'application/json' },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  if (response.status !== 204 && !response.headers.get('content-type')?.includes('application/json')) {
    throw new BoardApiError(
      `API ${method} /api/board${route} returned a non-JSON response (${response.status}). Stop and restart the application server (make dev), then reload the page.`,
      response.status,
    );
  }
  if (!response.ok) {
    const payload: unknown = response.headers.get('content-type')?.includes('application/json')
      ? await response.json() : undefined;
    const error = z.object({ error: z.string() }).safeParse(payload);
    throw new BoardApiError(error.success ? error.data.error : `Database request failed (${response.status})`, response.status);
  }
  if (response.status === 204) return undefined;
  return response.json();
}

function readLegacyBoard(): BoardData {
  const read = (key: string, defaults: unknown): unknown => {
    const value = localStorage.getItem(key);
    return value === null ? defaults : JSON.parse(value);
  };
  const projects = read('kanban_flow_projects_v1', INITIAL_PROJECTS);
  const features = read('kanban_flow_features_v1', INITIAL_FEATURES);
  const tasks = read('kanban_flow_tasks_v1', INITIAL_TASKS);
  // Validate before normalizing the two links supported by the old browser store.
  const parsedProjects = boardDataSchema.shape.projects.parse(projects);
  const parsedFeatures = boardDataSchema.shape.features.parse(features);
  const parsedTasks = boardDataSchema.shape.tasks.parse(tasks);
  const projectId = parsedProjects.some((project) => project.id === 'proj-cloud-saas')
    ? 'proj-cloud-saas' : parsedProjects[0].id;
  const featureIds = new Set(parsedFeatures.map((feature) => feature.id));
  return boardDataSchema.parse({
    projects: parsedProjects,
    features: parsedFeatures.map((feature) => ({ ...feature, projectId: feature.projectId || projectId })),
    tasks: parsedTasks.map((task) => ({
      ...task, projectId: task.projectId || projectId,
      featureId: task.featureId && featureIds.has(task.featureId) ? task.featureId : undefined,
    })),
  });
}

export async function loadProjects(signal?: AbortSignal) {
  let stored = await request('/projects', 'GET', undefined, signal);
  if (stored === null) {
    await request('/initialize', 'POST', readLegacyBoard(), signal);
    stored = await request('/projects', 'GET', undefined, signal);
  }
  return z.array(projectSummarySchema).parse(stored);
}

const entityPath = (kind: string, id: string) => `/${kind}/${encodeURIComponent(id)}`;
export const boardApi = {
  async assistWiki(projectId: string, input: WikiAssistantInput, signal?: AbortSignal) {
    const parsed = wikiAssistantInputSchema.safeParse(input);
    if (!parsed.success) throw new BoardApiError(parsed.error.issues.map((issue) => issue.message).join(' '), 400);
    return wikiAssistantResultSchema.parse(await request(
      `/projects/${encodeURIComponent(projectId)}/wiki/assistant`, 'POST', parsed.data, signal,
    ));
  },
  async activityEvents(filters: ActivityQuery, signal?: AbortSignal) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) {
      if (value !== undefined && value !== '') query.set(key, String(value));
    }
    return activityListSchema.parse(await request(`/activity-events?${query}`, 'GET', undefined, signal));
  },
  async wikiFiles(projectId: string, signal?: AbortSignal) {
    return docListSchema.parse(await request(`/projects/${encodeURIComponent(projectId)}/wiki`, 'GET', undefined, signal));
  },
  async wikiFile(projectId: string, path: string, signal?: AbortSignal) {
    const query = new URLSearchParams({ path });
    return docContentSchema.parse(await request(`/projects/${encodeURIComponent(projectId)}/wiki/file?${query}`, 'GET', undefined, signal));
  },
  async saveWikiFile(projectId: string, path: string, content: string, expectedSha: string | null) {
    return docSaveResultSchema.parse(await request(
      `/projects/${encodeURIComponent(projectId)}/wiki/file`, 'PUT', { path, content, expectedSha },
    ));
  },
  async wikiStatus(projectId: string, signal?: AbortSignal) {
    return docStatusSchema.parse(await request(`/projects/${encodeURIComponent(projectId)}/wiki/status`, 'GET', undefined, signal));
  },
  async syncWiki(projectId: string) {
    return docSyncResultSchema.parse(await request(`/projects/${encodeURIComponent(projectId)}/wiki/sync`, 'POST', {}));
  },
  async activityHistory(entityType: string, entityId: string, page = 1, signal?: AbortSignal) {
    const query = new URLSearchParams({ page: String(page) });
    return activityListSchema.parse(await request(
      `/activity-events/${encodeURIComponent(entityType)}/${encodeURIComponent(entityId)}?${query}`,
      'GET', undefined, signal,
    ));
  },
  async gitInventory(projectId: string, signal?: AbortSignal) {
    const query = projectId === ALL_PROJECTS ? '' : `?projectId=${encodeURIComponent(projectId)}`;
    return gitInventorySchema.parse(await request(`/repositories/inventory${query}`, 'GET', undefined, signal));
  },
  async publishedWork(projectId: string, signal?: AbortSignal) {
    return publishedWorkListSchema.parse(await request(`${entityPath('projects', projectId)}/published-work`, 'GET', undefined, signal));
  },
  async finishPreview(kind: 'tasks' | 'features', id: string, signal?: AbortSignal) {
    return finishPreviewSchema.parse(await request(`${entityPath(kind, id)}/finish`, 'GET', undefined, signal));
  },
  async finishBranch(kind: 'tasks' | 'features', id: string, input: FinishRequest) {
    return finishPreviewSchema.parse(await request(`${entityPath(kind, id)}/finish`, 'POST', input));
  },
  async releases(projectId: string, signal?: AbortSignal) {
    const route = projectId === ALL_PROJECTS ? '/releases' : `${entityPath('projects', projectId)}/releases`;
    return z.array(releaseSchema).parse(await request(route, 'GET', undefined, signal));
  },
  async release(projectId: string, id: string, signal?: AbortSignal) {
    return releaseDetailSchema.parse(await request(`${entityPath('projects', projectId)}${entityPath('releases', id)}`, 'GET', undefined, signal));
  },
  async createRelease(projectId: string, input: z.infer<typeof releaseEditSchema>) {
    return z.array(releaseSchema).parse(await request(`${entityPath('projects', projectId)}/releases`, 'POST', input));
  },
  async updateRelease(projectId: string, id: string, input: z.infer<typeof releaseUpdateSchema>) {
    return releaseDetailSchema.parse(await request(`${entityPath('projects', projectId)}${entityPath('releases', id)}`, 'PUT', input));
  },
  async releasePreview(projectId: string, id: string) {
    return releasePreviewSchema.parse(await request(`${entityPath('projects', projectId)}${entityPath('releases', id)}/preview`));
  },
  async publishRelease(projectId: string, id: string, input: z.infer<typeof releasePublishSchema>) {
    return releaseDetailSchema.parse(await request(`${entityPath('projects', projectId)}${entityPath('releases', id)}/publish`, 'POST', input));
  },
  async assignRelease(projectId: string, taskId: string, releaseId: string | null, revision: number) {
    return taskSchema.parse(await request(`${entityPath('projects', projectId)}${entityPath('tasks', taskId)}/release`, 'PUT', { releaseId, revision }));
  },
  async delivery(taskId: string, signal?: AbortSignal) {
    return deliveryPreviewSchema.parse(await request(`${entityPath('tasks', taskId)}/session/delivery`, 'GET', undefined, signal));
  },
  async deliver(taskId: string, action: 'commit' | 'merge', input: DeliveryRequest) {
    return deliveryPreviewSchema.parse(await request(`${entityPath('tasks', taskId)}/session/delivery/${action}`, 'POST', input));
  },
  async agentHistory(taskId: string, signal?: AbortSignal) {
    return agentSessionSchema.shape.attempts.parse(await request(`${entityPath('tasks', taskId)}/session/history`, 'GET', undefined, signal));
  },
  async projectHealth(projectId: string, signal?: AbortSignal) {
    return projectHealthSchema.parse(await request(`${entityPath('projects', projectId)}/health`, 'GET', undefined, signal));
  },
  async reviewAgent(taskId: string, signal?: AbortSignal, path?: string) {
    const query = path ? `?${new URLSearchParams({ path })}` : '';
    return reviewSchema.parse(await request(`${entityPath('tasks', taskId)}/session/review${query}`, 'GET', undefined, signal));
  },
  async aiReviewAgent(taskId: string, token: string) {
    return aiReviewResultSchema.parse(await request(`${entityPath('tasks', taskId)}/session/ai-review`, 'POST', { token }));
  },
  async acceptReview(taskId: string, sessionId: string, updatedAt: string, token: string) {
    return agentSessionSchema.nullable().parse(await request(`${entityPath('tasks', taskId)}/session/accept-review`, 'POST', { sessionId, updatedAt, token }));
  },
  async reviewPublication(kind: 'tasks' | 'features', id: string, signal?: AbortSignal) {
    return publicationPreviewSchema.parse(await request(`${entityPath(kind, id)}/review-publication`, 'GET', undefined, signal));
  },
  async publishReview(kind: 'tasks' | 'features', id: string, input: PublicationRequest) {
    return z.object({ branch: z.string() }).parse(await request(`${entityPath(kind, id)}/review-publication`, 'POST', input));
  },
  async feedbackAgent(taskId: string, sessionId: string, feedback: string, updatedAt: string) {
    return agentSessionSchema.nullable().parse(await request(`${entityPath('tasks', taskId)}/session/feedback`, 'POST', { sessionId, feedback, updatedAt }));
  },
  async cleanupAgent(taskId: string, sessionId: string, updatedAt: string) {
    return agentSessionSchema.nullable().parse(await request(`${entityPath('tasks', taskId)}/session/cleanup`, 'POST', { sessionId, updatedAt }));
  },
  async agentSessions(filters: AgentListQuery, signal?: AbortSignal) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) {
      if (value !== undefined && value !== '') query.set(key, String(value));
    }
    return agentListSchema.parse(await request(`/agent-sessions?${query}`, 'GET', undefined, signal));
  },
  async deliveryHistory(filters: { projectId?: string; status?: string; search?: string; page?: number }, signal?: AbortSignal) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) {
      if (value !== undefined && value !== '') query.set(key, String(value));
    }
    return deliveryHistorySchema.parse(await request(`/delivery-history?${query}`, 'GET', undefined, signal));
  },
  async answerAgent(taskId: string, sessionId: string, questionId: string, answer: string) {
    return agentSessionSchema.nullable().parse(await request(`${entityPath('tasks', taskId)}/session/answer`, 'POST', { sessionId, questionId, answer }));
  },
  async agentSession(taskId: string) {
    return agentSessionSchema.nullable().parse(await request(`${entityPath('tasks', taskId)}/session`));
  },
  async agentAction(taskId: string, sessionId: string, action: 'approve' | 'retry' | 'cancel', updatedAt: string) {
    return agentSessionSchema.nullable().parse(await request(`${entityPath('tasks', taskId)}/session/${action}`, 'POST', { sessionId, updatedAt }));
  },
  async load(projectId: string, signal?: AbortSignal) {
    const route = projectId === ALL_PROJECTS ? '/board' : `${entityPath('projects', projectId)}/board`;
    return projectBoardSchema.parse(await request(route, 'GET', undefined, signal));
  },
  async saveProject(project: Project, create: boolean, repository?: RepositoryInput) {
    const body = create && repository ? { ...project, repository } : project;
    return projectSchema.parse(await request(create ? '/projects' : entityPath('projects', project.id), create ? 'POST' : 'PUT', body));
  },
  async listBranches(url: string, token?: string) {
    return remoteBranchesSchema.parse(await request('/repositories/branches', 'POST', { url, token: token || undefined }));
  },
  async listLocalRepositories() {
    return localRepositoriesSchema.parse(await request('/repositories/local'));
  },
  async projectBranches(projectId: string) {
    return workspaceBranchesSchema.parse(await request(`${entityPath('projects', projectId)}/branches`));
  },
  async switchBranch(project: Project, branch: string) {
    return projectSchema.parse(await request(`${entityPath('projects', project.id)}/branch`, 'PUT', {
      branch, revision: project.revision ?? 0,
    }));
  },
  async deleteProject(project: Project) {
    await request(entityPath('projects', project.id), 'DELETE', { revision: project.revision ?? 0 });
  },
  async saveFeature(feature: Feature, create: boolean) {
    return featureSchema.parse(await request(create ? '/features' : entityPath('features', feature.id), create ? 'POST' : 'PUT', feature));
  },
  async deleteFeature(feature: Feature) {
    await request(entityPath('features', feature.id), 'DELETE', { revision: feature.revision ?? 0 });
  },
  async saveTask(task: Task, create: boolean) {
    return taskSchema.parse(await request(create ? '/tasks' : entityPath('tasks', task.id), create ? 'POST' : 'PUT', task));
  },
  async deleteTask(task: Task) {
    await request(entityPath('tasks', task.id), 'DELETE', { revision: task.revision ?? 0 });
  },
  async moveTask(task: Task, status: KanbanStatus, index?: number) {
    return z.array(taskSchema).parse(await request(`${entityPath('tasks', task.id)}/move`, 'POST', {
      revision: task.revision ?? 0, status, index,
    }));
  },
  async breakdown(feature: Feature, tasks: Task[]) {
    return breakdownSchema.parse(await request('/breakdown', 'POST', { feature, tasks }));
  },
  async reset() { await request('/reset', 'POST'); },
};
