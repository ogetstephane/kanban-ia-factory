import { z } from 'zod';
import { projectSchema, remoteBranchesSchema, localRepositoriesSchema, workspaceBranchesSchema } from '../../shared/types/board';
import type { Project } from '../../shared/types/kanban';
import { publicationPreviewSchema, type PublicationRequest } from '../../shared/types/agent';
import { gitInventorySchema, publishedWorkListSchema, finishPreviewSchema, type FinishRequest } from '../../shared/types/git';
import { ALL_PROJECTS } from '../utils/projectLogic';
import { entityPath, request } from './apiClient';

export const gitApi = {
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
  async reviewPublication(kind: 'tasks' | 'features', id: string, signal?: AbortSignal) {
    return publicationPreviewSchema.parse(await request(`${entityPath(kind, id)}/review-publication`, 'GET', undefined, signal));
  },
  async publishReview(kind: 'tasks' | 'features', id: string, input: PublicationRequest) {
    return z.object({ branch: z.string() }).parse(await request(`${entityPath(kind, id)}/review-publication`, 'POST', input));
  },
};
