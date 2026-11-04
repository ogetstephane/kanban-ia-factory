import {
  docListSchema, docContentSchema, docSaveResultSchema, docStatusSchema, docSyncResultSchema,
  wikiAssistantInputSchema, wikiAssistantResultSchema, type WikiAssistantInput,
} from '../../shared/types/wiki';
import { entityPath, request, validInput } from './apiClient';

const wikiPath = (projectId: string) => `${entityPath('projects', projectId)}/wiki`;

export const wikiApi = {
  async wikiFiles(projectId: string, signal?: AbortSignal) {
    return docListSchema.parse(await request(wikiPath(projectId), 'GET', undefined, signal));
  },
  async wikiFile(projectId: string, path: string, signal?: AbortSignal) {
    const query = new URLSearchParams({ path });
    return docContentSchema.parse(await request(`${wikiPath(projectId)}/file?${query}`, 'GET', undefined, signal));
  },
  async saveWikiFile(projectId: string, path: string, content: string, expectedSha: string | null) {
    return docSaveResultSchema.parse(await request(`${wikiPath(projectId)}/file`, 'PUT', { path, content, expectedSha }));
  },
  async wikiStatus(projectId: string, signal?: AbortSignal) {
    return docStatusSchema.parse(await request(`${wikiPath(projectId)}/status`, 'GET', undefined, signal));
  },
  async syncWiki(projectId: string) {
    return docSyncResultSchema.parse(await request(`${wikiPath(projectId)}/sync`, 'POST', {}));
  },
  async assistWiki(projectId: string, input: WikiAssistantInput, signal?: AbortSignal) {
    const data = validInput(wikiAssistantInputSchema, input);
    return wikiAssistantResultSchema.parse(await request(`${wikiPath(projectId)}/assistant`, 'POST', data, signal));
  },
};
