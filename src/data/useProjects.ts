import { useCallback, useEffect, useState } from 'react';
import type { Project } from '../../shared/types/kanban';
import type { ProjectStats, ProjectSummary, RepositoryInput } from '../../shared/types/board';
import { boardApi, loadProjects } from './boardApi';
import { gitApi } from './gitApi';

const emptyStats: ProjectStats = {
  totalTasks: 0, completedTasks: 0, inProgressTasks: 0, completionRate: 0, totalFeatures: 0,
};

const sameStats = (a: ProjectStats, b: ProjectStats) =>
  (Object.keys(emptyStats) as (keyof ProjectStats)[]).every((key) => a[key] === b[key]);

export function useProjects() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError('');
    loadProjects(controller.signal).then((data) => {
      if (!controller.signal.aborted) { setProjects(data); setReady(true); }
    }).catch((cause: unknown) => {
      if (controller.signal.aborted) return;
      console.error('Unable to load projects:', cause);
      setError(cause instanceof Error ? cause.message : 'Unable to load projects');
    });
    return () => controller.abort();
  }, [attempt]);
  const updateStats = useCallback((id: string, stats: ProjectStats) => {
    setProjects((previous) => {
      const current = previous.find((project) => project.id === id);
      if (!current || sameStats(current.stats, stats)) return previous;
      return previous.map((project) => project.id === id ? { ...project, stats } : project);
    });
  }, []);
  return {
    projects, ready, error, updateStats,
    reload: () => setAttempt((value) => value + 1),
    save: async (project: Project, create: boolean, repository?: RepositoryInput) => {
      const saved = await boardApi.saveProject(project, create, repository);
      setProjects((previous) => create ? [...previous, { ...saved, stats: emptyStats }]
        : previous.map((item) => item.id === saved.id ? { ...saved, stats: item.stats } : item));
      return saved;
    },
    switchBranch: async (project: Project, branch: string) => {
      const saved = await gitApi.switchBranch(project, branch);
      setProjects((previous) => previous.map((item) => item.id === saved.id ? { ...saved, stats: item.stats } : item));
      return saved;
    },
    remove: async (project: Project) => {
      await boardApi.deleteProject(project);
      setProjects((previous) => previous.filter((item) => item.id !== project.id));
    },
  };
}
