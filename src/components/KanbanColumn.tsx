import React, { useState } from 'react';
import { Plus, Inbox, ListTodo, PlayCircle, Eye, CheckCircle } from 'lucide-react';
import { KanbanStatus, Task, Feature, Project } from '../types/kanban';
import { KanbanCard } from './KanbanCard';
import { EpicCard } from './EpicCard';
import { canCreateTaskIn } from '../utils/kanbanLogic';
import type { AgentWorkflow } from '../types/workflow';

interface KanbanColumnProps {
  status: KanbanStatus;
  tasks: Task[];
  features: Feature[];
  featureTasks: Map<string, Task[]>;
  featuresMap: Map<string, Feature>;
  projects?: Project[];
  workflows?: Record<string, AgentWorkflow>;
  onMoveTask: (taskId: string, targetStatus: KanbanStatus, targetIndex?: number) => void;
  onMoveFeature: (featureId: string, targetStatus: KanbanStatus) => void;
  onEditTask: (task: Task) => void;
  onDeleteTask: (taskId: string) => void;
  onAddTask: (status: KanbanStatus, featureId?: string) => void;
  onOpenCopilotSpec: (task: Task) => void;
  onReviewTask: (task: Task, ai: boolean) => void;
  onReviewFeature: (feature: Feature, ai: boolean) => void;
  /** Whether the card being dragged (from another column) may be dropped here. */
  dropState: 'idle' | 'allowed' | 'forbidden';
  onDragTask: (from: KanbanStatus | null) => void;
}

const STATUS_CONFIG: Record<
  KanbanStatus,
  {
    icon: React.ElementType;
    headerColor: string;
    badgeBg: string;
    badgeText: string;
    borderTop: string;
    glowColor: string;
    description: string;
  }
> = {
  Backlog: {
    icon: Inbox,
    headerColor: 'text-slate-300',
    badgeBg: 'bg-slate-700/60',
    badgeText: 'text-slate-300',
    borderTop: 'border-t-slate-500',
    glowColor: 'rgb(100 116 139 / 0.35)',
    description: 'Ideas, future scope & uncommitted work',
  },
  'To Do': {
    icon: ListTodo,
    headerColor: 'text-sky-300',
    badgeBg: 'bg-sky-500/10',
    badgeText: 'text-sky-400',
    borderTop: 'border-t-sky-500',
    glowColor: 'rgb(14 165 233 / 0.35)',
    description: 'Prioritized & ready for development',
  },
  'In Progress': {
    icon: PlayCircle,
    headerColor: 'text-amber-300',
    badgeBg: 'bg-amber-500/10',
    badgeText: 'text-amber-400',
    borderTop: 'border-t-amber-500',
    glowColor: 'rgb(245 158 11 / 0.35)',
    description: 'Actively being implemented',
  },
  Review: {
    icon: Eye,
    headerColor: 'text-purple-300',
    badgeBg: 'bg-purple-500/10',
    badgeText: 'text-purple-400',
    borderTop: 'border-t-purple-500',
    glowColor: 'rgb(168 85 247 / 0.35)',
    description: 'Code review, testing & QA approval',
  },
  Done: {
    icon: CheckCircle,
    headerColor: 'text-emerald-300',
    badgeBg: 'bg-emerald-500/10',
    badgeText: 'text-emerald-400',
    borderTop: 'border-t-emerald-500',
    glowColor: 'rgb(16 185 129 / 0.35)',
    description: 'Shipped & verified in production',
  },
};

export const KanbanColumn: React.FC<KanbanColumnProps> = ({
  status,
  tasks,
  features,
  featureTasks,
  featuresMap,
  projects,
  workflows,
  onMoveTask,
  onMoveFeature,
  onEditTask,
  onDeleteTask,
  onAddTask,
  onOpenCopilotSpec,
  dropState,
  onDragTask,
  onReviewTask,
  onReviewFeature,
}) => {
  const [isDragOver, setIsDragOver] = useState(false);
  const config = STATUS_CONFIG[status];
  const IconComponent = config.icon;

  const canCreate = canCreateTaskIn(status);
  const glowStyle: React.CSSProperties & { '--column-glow': string } = {
    '--column-glow': config.glowColor,
  };

  const handleDragOver = (e: React.DragEvent) => {
    // Not calling preventDefault makes the browser refuse the drop.
    if (dropState === 'forbidden') {
      e.dataTransfer.dropEffect = 'none';
      return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (!isDragOver) setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    onDragTask(null);
    if (dropState === 'forbidden') return;
    const entityId = e.dataTransfer.getData('text/plain');
    if (!entityId) return;
    if (e.dataTransfer.getData('application/x-kanban-kind') === 'feature') onMoveFeature(entityId, status);
    else onMoveTask(entityId, status);
  };
  const itemCount = tasks.length + features.length;

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      style={glowStyle}
      className={`flex min-w-0 flex-col bg-slate-900/70 border border-slate-800 rounded-2xl p-3 transition-[box-shadow,background-color,opacity] duration-200 ${
        config.borderTop
      } border-t-2 ${
        dropState === 'forbidden' ? 'opacity-40 cursor-not-allowed shadow-lg' : `hover:shadow-[0_0_24px_var(--column-glow)] ${
          dropState === 'allowed' || isDragOver ? 'shadow-[0_0_24px_var(--column-glow)]' : 'shadow-lg'
        }`
      } ${
        isDragOver && dropState !== 'forbidden' ? 'bg-slate-800/60' : ''
      }`}
    >
      {/* Column Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3 px-1">
        <div className="flex flex-wrap items-center gap-2">
          <IconComponent className={`w-4 h-4 ${config.headerColor}`} />
          <h2 className="text-sm font-semibold text-slate-100 tracking-tight">
            {status}
          </h2>
          <span
            className={`text-xs font-semibold px-2 py-0.5 rounded-full ${config.badgeBg} ${config.badgeText}`}
          >
            {itemCount}
          </span>
        </div>

        {canCreate && <button
          onClick={() => onAddTask(status)}
          className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
          title={`Add task to ${status}`}
          aria-label={`Add task to ${status}`}
        >
          <Plus className="w-4 h-4" />
        </button>}
      </div>

      {/* Task Cards List */}
      <div className="flex-1 overflow-y-auto space-y-3 min-h-[300px] pr-1">
        {itemCount === 0 ? (
          <div className="h-44 flex flex-col items-center justify-center border border-dashed border-slate-800 rounded-xl p-4 text-center text-slate-400">
            <p className="text-xs font-medium mb-1">No tasks in {status}</p>
            <p className="text-[11px] text-slate-400 mb-3">{config.description}</p>
            {canCreate && <button
              onClick={() => onAddTask(status)}
              className="inline-flex items-center gap-1 text-xs font-medium text-indigo-400 hover:text-indigo-300 px-2 py-1 rounded bg-indigo-500/10 hover:bg-indigo-500/20 transition-colors cursor-pointer"
            >
              <Plus className="w-3 h-3" /> Add a task
            </button>}
          </div>
        ) : (
          <>
          {features.map((feature) => (
            <EpicCard
              key={feature.id}
              feature={feature}
              tasks={featureTasks.get(feature.id) ?? []}
              projectName={projects ? projects.find((project) => project.id === feature.projectId)?.name ?? 'No project' : undefined}
              workflows={workflows}
              onMoveStatus={onMoveFeature}
              onDragStatus={onDragTask}
              onOpenTask={onEditTask}
              onDeleteTask={onDeleteTask}
              onAddTask={onAddTask}
              onReviewTask={onReviewTask}
              onReviewFeature={onReviewFeature}
            />
          ))}
          {tasks.map((task) => (
            <KanbanCard
              key={task.id}
              task={task}
              workflow={workflows?.[task.id]}
              projectName={projects ? projects.find((project) => project.id === task.projectId)?.name ?? 'No project' : undefined}
              feature={task.featureId ? featuresMap.get(task.featureId) : undefined}
              onEdit={onEditTask}
              onDelete={onDeleteTask}
              onMoveStatus={(taskId, targetStatus) => onMoveTask(taskId, targetStatus)}
              onOpenCopilotSpec={onOpenCopilotSpec}
              onDragStatus={onDragTask}
              onReview={onReviewTask}
            />
          ))
          }
          </>
        )}
      </div>
    </div>
  );
};
