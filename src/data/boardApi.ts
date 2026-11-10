import { z } from 'zod';
import {
  legacyBoardSchema, projectSchema, projectSummarySchema, projectBoardSchema,
  featureSchema, taskSchema, breakdownSchema, type RepositoryInput,
} from '../../shared/types/board';
import type { Project, Feature, Task, KanbanStatus } from '../../shared/types/kanban';
import { taskDraftInputSchema, taskDraftResultSchema, type TaskDraftInput } from '../../shared/types/taskDraft';
import { taskBreakdownResultSchema } from '../../shared/types/taskBreakdown';
import { ALL_PROJECTS } from '../utils/projectLogic';
import { entityPath, request, validInput } from './apiClient';

function readLegacyBoard() {
  const read = (key: string): unknown => {
    const value = localStorage.getItem(key);
    return value === null ? undefined : JSON.parse(value);
  };
  return legacyBoardSchema.parse({
    projects: read('kanban_flow_projects_v1'),
    features: read('kanban_flow_features_v1'),
    tasks: read('kanban_flow_tasks_v1'),
  });
}

export async function loadProjects(signal?: AbortSignal) {
  let stored = await request('/projects', 'GET', undefined, signal);
  if (stored === null) {
    await request('/initialize', 'POST', { legacy: readLegacyBoard() }, signal);
    stored = await request('/projects', 'GET', undefined, signal);
  }
  return z.array(projectSummarySchema).parse(stored);
}

export const boardApi = {
  async load(projectId: string, signal?: AbortSignal) {
    const route = projectId === ALL_PROJECTS ? '/board' : `${entityPath('projects', projectId)}/board`;
    return projectBoardSchema.parse(await request(route, 'GET', undefined, signal));
  },
  async saveProject(project: Project, create: boolean, repository?: RepositoryInput) {
    const body = create && repository ? { ...project, repository } : project;
    return projectSchema.parse(await request(create ? '/projects' : entityPath('projects', project.id), create ? 'POST' : 'PUT', body));
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
  async assistTask(projectId: string, input: TaskDraftInput, signal?: AbortSignal) {
    const data = validInput(taskDraftInputSchema, input);
    return taskDraftResultSchema.parse(await request(
      `${entityPath('projects', projectId)}/tasks/assistant`, 'POST', data, signal,
    ));
  },
  async assistBreakdown(projectId: string, input: TaskDraftInput, signal?: AbortSignal) {
    const data = validInput(taskDraftInputSchema, input);
    return taskBreakdownResultSchema.parse(await request(
      `${entityPath('projects', projectId)}/tasks/breakdown`, 'POST', data, signal,
    ));
  },
  async reset() { await request('/reset', 'POST'); },
};
