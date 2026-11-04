import { codeGraphSnapshotSchema } from '../../shared/types/codeGraph';
import { archifyDiagramListSchema } from '../../shared/types/archify';
import { entityPath, request } from './apiClient';

export const graphApi = {
  async codeGraph(projectId: string, signal?: AbortSignal) {
    return codeGraphSnapshotSchema.parse(await request(`${entityPath('projects', projectId)}/code-graph`, 'GET', undefined, signal));
  },
  async rebuildCodeGraph(projectId: string, signal?: AbortSignal) {
    return codeGraphSnapshotSchema.parse(await request(`${entityPath('projects', projectId)}/code-graph/rebuild`, 'POST', undefined, signal));
  },
  async archifyDiagrams(signal?: AbortSignal) {
    return archifyDiagramListSchema.parse(await request('/archify', 'GET', undefined, signal)).diagrams;
  },
};
