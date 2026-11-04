import { z } from 'zod';
import { taskSchema } from '../../shared/types/board';
import {
  releaseSchema, releaseDetailSchema, releasePreviewSchema, releasePublishSchema, releaseEditSchema, releaseUpdateSchema,
} from '../../shared/types/release';
import { ALL_PROJECTS } from '../utils/projectLogic';
import { entityPath, request } from './apiClient';

const releasePath = (projectId: string, id: string) => `${entityPath('projects', projectId)}${entityPath('releases', id)}`;

export const releaseApi = {
  async releases(projectId: string, signal?: AbortSignal) {
    const route = projectId === ALL_PROJECTS ? '/releases' : `${entityPath('projects', projectId)}/releases`;
    return z.array(releaseSchema).parse(await request(route, 'GET', undefined, signal));
  },
  async release(projectId: string, id: string, signal?: AbortSignal) {
    return releaseDetailSchema.parse(await request(releasePath(projectId, id), 'GET', undefined, signal));
  },
  async createRelease(projectId: string, input: z.infer<typeof releaseEditSchema>) {
    return z.array(releaseSchema).parse(await request(`${entityPath('projects', projectId)}/releases`, 'POST', input));
  },
  async updateRelease(projectId: string, id: string, input: z.infer<typeof releaseUpdateSchema>) {
    return releaseDetailSchema.parse(await request(releasePath(projectId, id), 'PUT', input));
  },
  async releasePreview(projectId: string, id: string) {
    return releasePreviewSchema.parse(await request(`${releasePath(projectId, id)}/preview`));
  },
  async publishRelease(projectId: string, id: string, input: z.infer<typeof releasePublishSchema>) {
    return releaseDetailSchema.parse(await request(`${releasePath(projectId, id)}/publish`, 'POST', input));
  },
  async assignRelease(projectId: string, taskId: string, releaseId: string | null, revision: number) {
    return taskSchema.parse(await request(
      `${entityPath('projects', projectId)}${entityPath('tasks', taskId)}/release`, 'PUT', { releaseId, revision },
    ));
  },
};
