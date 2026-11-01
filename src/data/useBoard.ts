import { useEffect, useRef, useState } from 'react';
import type { Feature, Task, KanbanStatus } from '../types/kanban';
import type { ProjectBoard } from '../types/board';
import { boardApi } from './boardApi';

const emptyBoard: ProjectBoard = { features: [], tasks: [] };
const mergeTasks = (tasks: ProjectBoard['tasks'], changed: ProjectBoard['tasks']) => {
  const byId = new Map(changed.map((task) => [task.id, task]));
  return tasks.map((task) => byId.get(task.id) ?? task);
};
const mergeFeatures = (features: ProjectBoard['features'], changed: ProjectBoard['features']) => {
  const byId = new Map(changed.map((feature) => [feature.id, feature]));
  return features.map((feature) => byId.get(feature.id) ?? feature);
};

export function useBoard(projectId: string) {
  const [state, setState] = useState({ projectId: '', data: emptyBoard, loading: true, error: '' });
  const [attempt, setAttempt] = useState(0);
  const active = useRef(projectId);
  active.current = projectId;
  const generation = useRef(0);

  useEffect(() => {
    if (!projectId) return;
    const controller = new AbortController();
    const current = ++generation.current;
    setState({ projectId, data: emptyBoard, loading: true, error: '' });
    boardApi.load(projectId, controller.signal).then((data) => {
      if (!controller.signal.aborted && current === generation.current) {
        setState({ projectId, data, loading: false, error: '' });
      }
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      console.error('Unable to load project board:', error);
      if (current === generation.current) setState({
        projectId, data: emptyBoard, loading: false,
        error: error instanceof Error ? error.message : 'Unable to load project board',
      });
    });
    return () => { controller.abort(); generation.current++; };
  }, [projectId, attempt]);

  const data = state.projectId === projectId ? state.data : emptyBoard;
  const ready = state.projectId === projectId && !state.loading && !state.error;
  const mutate = async <T,>(operation: () => Promise<T>, apply: (board: ProjectBoard, result: T) => ProjectBoard) => {
    if (!ready) throw new Error('Wait for this project to finish loading.');
    const current = generation.current;
    const result = await operation();
    if (active.current === projectId && current === generation.current) {
      setState((previous) => ({ ...previous, data: apply(previous.data, result) }));
    }
    return result;
  };
  const findTask = (id: string) => {
    const task = data.tasks.find((item) => item.id === id);
    if (!task) throw new Error('Task not loaded. Refresh this project before retrying.');
    return task;
  };
  return {
    ...data, ready, loading: !projectId || state.projectId !== projectId || state.loading,
    error: state.projectId === projectId ? state.error : '',
    reload: () => setAttempt((value) => value + 1),
    saveTask: (task: Task, create: boolean) => mutate(() => boardApi.saveTask(task, create), (board, saved) => ({
      ...board, tasks: create ? [saved, ...board.tasks] : mergeTasks(board.tasks, [saved]),
    })),
    deleteTask: (id: string) => mutate(() => boardApi.deleteTask(findTask(id)), (board) => ({
      ...board, tasks: board.tasks.filter((task) => task.id !== id),
    })),
    moveTask: (id: string, status: KanbanStatus, index?: number) => mutate(
      () => boardApi.moveTask(findTask(id), status, index),
      (board, changed) => ({ ...board, tasks: mergeTasks(board.tasks, changed) }),
    ),
    saveFeature: (feature: Feature) => mutate(() => boardApi.saveFeature(feature, true), (board, saved) => ({
      ...board, features: [saved, ...board.features],
    })),
    updateFeatureStatus: (id: string, status: KanbanStatus) => mutate(() => {
      const feature = data.features.find((item) => item.id === id);
      if (!feature) throw new Error('Epic not loaded. Refresh this project before retrying.');
      return boardApi.saveFeature({ ...feature, status }, false);
    }, (board, saved) => ({
      ...board, features: mergeFeatures(board.features, [saved]),
    })),
    deleteFeature: (id: string) => mutate(async () => {
      const feature = data.features.find((item) => item.id === id);
      if (!feature) throw new Error('Feature not loaded. Refresh this project before retrying.');
      await boardApi.deleteFeature(feature);
    }, (board) => ({
      features: board.features.filter((feature) => feature.id !== id),
      tasks: board.tasks.map((task) => task.featureId === id
        ? { ...task, featureId: undefined, revision: task.revision + 1 } : task),
    })),
    breakdown: (feature: Feature, tasks: Task[]) => mutate(() => boardApi.breakdown(feature, tasks), (board, saved) => ({
      features: board.features.some((item) => item.id === saved.feature.id)
        ? board.features : [saved.feature, ...board.features],
      tasks: [...saved.tasks, ...board.tasks],
    })),
  };
}
