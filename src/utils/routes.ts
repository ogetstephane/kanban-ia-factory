import type { KanbanStatus } from '../types/kanban';
import type { SessionActionFocus } from '../types/agent';

export const VIEW_MODES = ['cockpit', 'board', 'analytics', 'sessions', 'delivery-history', 'activity', 'wiki', 'releases', 'git'] as const;
export type ViewMode = typeof VIEW_MODES[number];

export function isViewMode(value: string | undefined): value is ViewMode {
  return VIEW_MODES.some((mode) => mode === value);
}

export function viewPath(projectId: string, view: ViewMode) {
  return `/projects/${encodeURIComponent(projectId)}/${view}`;
}

export function taskEditorPath(projectId: string, options: {
  taskId?: string; status?: KanbanStatus; featureId?: string; action?: SessionActionFocus;
}) {
  const path = `/projects/${encodeURIComponent(projectId)}/tasks/${options.taskId ? `${encodeURIComponent(options.taskId)}/edit` : 'new'}`;
  const query = new URLSearchParams();
  if (options.status) query.set('status', options.status);
  if (options.featureId) query.set('featureId', options.featureId);
  if (options.action) query.set('action', options.action);
  return `${path}${query.size ? `?${query}` : ''}`;
}

export function taskReturnPath(projectId: string, state: unknown) {
  if (state && typeof state === 'object' && 'returnProjectId' in state && 'returnView' in state
    && typeof state.returnProjectId === 'string' && state.returnProjectId
    && typeof state.returnView === 'string' && isViewMode(state.returnView)) {
    return viewPath(state.returnProjectId, state.returnView);
  }
  return viewPath(projectId, 'board');
}
