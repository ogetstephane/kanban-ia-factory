import { Project, Feature, Task } from '../types/kanban';

export const ALL_PROJECTS = 'All';

export const DEFAULT_PROJECT_COLORS = [
  '#6366f1', // Indigo
  '#8b5cf6', // Violet
  '#ec4899', // Pink
  '#f59e0b', // Amber
  '#10b981', // Emerald
  '#06b6d4', // Cyan
  '#3b82f6', // Blue
  '#f43f5e', // Rose
];

/**
 * Creates and appends a new project
 */
export function createProject(
  projects: Project[],
  name: string,
  description: string,
  color = '#6366f1',
  icon?: string
): { projects: Project[]; newProject: Project } {
  const trimmedName = name.trim();
  const newProject: Project = {
    id: `proj-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    name: trimmedName || 'Untitled Project',
    description: description.trim(),
    color: color || '#6366f1',
    icon: icon || '💼',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  return {
    projects: [...projects, newProject],
    newProject,
  };
}

/**
 * Deletes a project and safely resolves the next active project ID
 */
export function deleteProject(
  projects: Project[],
  projectIdToDelete: string,
  currentActiveId: string
): { projects: Project[]; nextActiveId: string } {
  if (projects.length <= 1) {
    // Keep at least one default project
    return { projects, nextActiveId: currentActiveId };
  }

  const remaining = projects.filter((p) => p.id !== projectIdToDelete);
  let nextActiveId = currentActiveId;

  if (currentActiveId === projectIdToDelete) {
    nextActiveId = remaining[0]?.id || '';
  }

  return {
    projects: remaining,
    nextActiveId,
  };
}

/**
 * Computes high-level completion and feature count metrics for a project
 */
export function calculateProjectStats(projectId: string, tasks: Task[], features: Feature[]) {
  const projectTasks = tasks.filter((t) => t.projectId === projectId || (!t.projectId && projectId === 'proj-cloud-saas'));
  const projectFeatures = features.filter((f) => f.projectId === projectId || (!f.projectId && projectId === 'proj-cloud-saas'));

  const totalTasks = projectTasks.length;
  const doneTasks = projectTasks.filter((t) => t.status === 'Done').length;
  const inProgressTasks = projectTasks.filter((t) => t.status === 'In Progress' || t.status === 'Review').length;
  const completionRate = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;

  return {
    totalTasks,
    doneTasks,
    inProgressTasks,
    completionRate,
    totalFeatures: projectFeatures.length,
  };
}

/**
 * Filters any entity with projectId by the currently active project
 */
export function filterByProject<T extends { projectId?: string }>(items: T[], activeProjectId: string): T[] {
  if (!activeProjectId || activeProjectId === ALL_PROJECTS) return items;
  return items.filter((item) => !item.projectId || item.projectId === activeProjectId);
}
