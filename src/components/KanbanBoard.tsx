import { lazy, Suspense, useMemo, useState } from 'react';
import type { Feature, Project, Task, KanbanFilters, KanbanStatus } from '../../shared/types/kanban';
import { KANBAN_STATUSES, canMoveTask, filterTasks } from '../../shared/utils/kanbanLogic';
import { useOperation } from '../data/useOperation';
import { KanbanColumn } from './KanbanColumn';
import { useAgentWorkflows } from '../data/useAgentWorkflows';
const BoardReview = lazy(() => import('./BoardReview'));

interface Props {
  projectId?: string;
  tasks: Task[];
  features: Feature[];
  projects?: Project[];
  filters: KanbanFilters;
  onMoveTask: (id: string, status: KanbanStatus, index?: number) => Promise<unknown>;
  onMoveFeature: (id: string, status: KanbanStatus) => Promise<unknown>;
  onDeleteTask: (id: string) => Promise<unknown>;
  onEditTask: (task: Task) => void;
  onAddTask: (status: KanbanStatus, featureId?: string) => void;
  onReviewValidated?: () => void;
}

export default function KanbanBoard({ projectId, tasks, features, projects, filters, onMoveTask, onMoveFeature, onDeleteTask, onEditTask, onAddTask, onReviewValidated }: Props) {
  const operation = useOperation();
  const { workflows, error: workflowError } = useAgentWorkflows(projectId);
  const [dragFrom, setDragFrom] = useState<KanbanStatus | null>(null);
  const [review, setReview] = useState<{ title: string; tasks: Task[]; ai: boolean; featureId?: string } | null>(null);
  const featuresMap = useMemo(() => new Map(features.map((feature) => [feature.id, feature])), [features]);
  const { featureCards, featureTasks, looseTasks } = useMemo(() => {
    const tasksByFeature = new Map<string, Task[]>();
    for (const task of tasks) {
      if (!task.featureId) continue;
      const current = tasksByFeature.get(task.featureId) ?? [];
      current.push(task);
      tasksByFeature.set(task.featureId, current);
    }

    const childFilters = { ...filters, featureId: 'All' as const, status: 'All' as const };
    const visibleFeatureTasks = new Map<string, Task[]>();
    const visibleFeatures = features.filter((feature) => {
      if (filters.featureId !== 'All' && filters.featureId !== feature.id) return false;
      if (filters.status !== 'All' && filters.status !== feature.status) return false;
      const children = tasksByFeature.get(feature.id) ?? [];
      const matchingChildren = filterTasks(children, childFilters);
      const matchesEpicSearch = !filters.search.trim() ||
        feature.title.toLowerCase().includes(filters.search.trim().toLowerCase()) ||
        feature.description.toLowerCase().includes(filters.search.trim().toLowerCase());
      const hasTaskFilters = filters.priority !== 'All' || !!filters.tag;
      if (hasTaskFilters && matchingChildren.length === 0) return false;
      if (!hasTaskFilters && !matchesEpicSearch && matchingChildren.length === 0) return false;
      visibleFeatureTasks.set(feature.id, matchesEpicSearch && !hasTaskFilters ? children : matchingChildren);
      return true;
    });

    return {
      featureCards: visibleFeatures,
      featureTasks: visibleFeatureTasks,
      looseTasks: filterTasks(tasks.filter((task) => !task.featureId), { ...filters, featureId: 'All' }),
    };
  }, [tasks, features, filters]);
  return (
    <>
      {operation.error && <p role="alert" className="text-rose-300 mb-3">{operation.error}</p>}
      {workflowError && <p role="alert" className="mb-3 text-sm text-rose-300">Unable to refresh agent workflows: {workflowError}</p>}
      <div role="region" aria-label="Kanban columns" aria-busy={operation.pending} className={`grid w-full min-w-0 grid-cols-1 gap-4 pb-6 sm:grid-cols-2 lg:min-h-[calc(100vh-230px)] lg:grid-cols-5 ${operation.pending ? 'pointer-events-none opacity-70' : ''}`}>
        {KANBAN_STATUSES.map((status) => (
          <KanbanColumn
            key={status} status={status}
            tasks={looseTasks.filter((task) => task.status === status).sort((a, b) => a.order - b.order)}
            features={featureCards.filter((feature) => feature.status === status)}
            featureTasks={featureTasks}
            featuresMap={featuresMap}
            projects={projects}
            workflows={workflows}
            dropState={dragFrom === null || dragFrom === status ? 'idle' : canMoveTask(dragFrom, status) ? 'allowed' : 'forbidden'}
            onDragTask={setDragFrom}
            onMoveTask={(id, target, index) => { void operation.run(() => onMoveTask(id, target, index)); }}
            onMoveFeature={(id, target) => { void operation.run(() => onMoveFeature(id, target)); }}
            onDeleteTask={(id) => { void operation.run(() => onDeleteTask(id)); }}
            onEditTask={onEditTask} onOpenCopilotSpec={onEditTask} onAddTask={onAddTask}
            onReviewTask={(task, ai) => setReview({ title: task.title, tasks: [task], ai })}
            onReviewFeature={(feature, ai) => setReview({
              title: feature.title, tasks: tasks.filter((task) => task.featureId === feature.id), ai, featureId: feature.id,
            })}
          />
        ))}
      </div>
      {review && <Suspense fallback={<p role="status">Opening review…</p>}>
        <BoardReview title={review.title} tasks={review.tasks} ai={review.ai} featureId={review.featureId}
          onValidated={onReviewValidated} onClose={() => setReview(null)} />
      </Suspense>}
    </>
  );
}
