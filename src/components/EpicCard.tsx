import React, { useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronRight, Layers, Plus, Trash2 } from 'lucide-react';
import type { Feature, KanbanStatus, Task } from '../../shared/types/kanban';
import { reachableStatuses } from '../../shared/utils/kanbanLogic';
import ReviewActions from './ReviewActions';
import WorkflowTimeline from './WorkflowTimeline';
import { getAgentWorkflow } from '../../shared/utils/agentWorkflow';
import type { AgentWorkflow } from '../../shared/types/workflow';

interface EpicCardProps {
  feature: Feature;
  tasks: Task[];
  workflows?: Record<string, AgentWorkflow>;
  projectName?: string;
  onMoveStatus: (id: string, status: KanbanStatus) => void;
  onDragStatus: (status: KanbanStatus | null) => void;
  onOpenTask: (task: Task) => void;
  onDeleteTask: (taskId: string) => void;
  onAddTask: (status: KanbanStatus, featureId?: string) => void;
  onReviewFeature: (feature: Feature, ai: boolean) => void;
  onReviewTask: (task: Task, ai: boolean) => void;
}

const STATUS_STYLES: Record<KanbanStatus, string> = {
  Backlog: 'bg-slate-700/60 text-slate-300',
  'To Do': 'bg-sky-500/10 text-sky-300',
  'In Progress': 'bg-amber-500/10 text-amber-300',
  Review: 'bg-purple-500/10 text-purple-300',
  Done: 'bg-emerald-500/10 text-emerald-300',
};

export const EpicCard: React.FC<EpicCardProps> = ({
  feature, tasks, workflows, projectName, onMoveStatus, onDragStatus, onOpenTask, onDeleteTask, onAddTask, onReviewFeature, onReviewTask,
}) => {
  const [expanded, setExpanded] = useState(false);
  const done = tasks.filter((task) => task.status === 'Done').length;
  const statusOptions = reachableStatuses(feature.status);

  return (
    <article
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData('text/plain', feature.id);
        event.dataTransfer.setData('application/x-kanban-kind', 'feature');
        event.dataTransfer.effectAllowed = 'move';
        onDragStatus(feature.status);
      }}
      onDragEnd={() => onDragStatus(null)}
      className="group relative rounded-xl border border-slate-700/70 bg-slate-800/80 p-3.5 shadow-sm transition-all duration-150 hover:border-slate-600 hover:bg-slate-800 hover:shadow-md"
      style={{ borderLeftColor: feature.color || '#6366f1', borderLeftWidth: 3 }}
    >
      {projectName && <p className="mb-2 break-words text-xs font-medium text-indigo-300">{projectName}</p>}
      <div className="flex items-start gap-2">
        <Layers className="mt-0.5 h-4 w-4 shrink-0" style={{ color: feature.color || '#6366f1' }} />
        <div className="min-w-0 flex-1">
          <h3 className="line-clamp-2 break-words text-sm font-semibold text-slate-100">{feature.title}</h3>
          {feature.description && <p className="mt-1 line-clamp-2 break-words text-xs leading-relaxed text-slate-400">{feature.description}</p>}
        </div>
      </div>

      {feature.status === 'Review' && <ReviewActions title={feature.title} onReview={(ai) => onReviewFeature(feature, ai)} />}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <label className={`rounded-full px-2 py-1 text-[10px] font-semibold ${STATUS_STYLES[feature.status]}`}>
          <span className="sr-only">Epic status: </span>
          <select
            value={feature.status}
            onChange={(event) => onMoveStatus(feature.id, event.target.value as KanbanStatus)}
            onClick={(event) => event.stopPropagation()}
            className="cursor-pointer appearance-none bg-transparent outline-none"
            aria-label={`Epic status for ${feature.title}`}
          >
            {statusOptions.map((status) => <option key={status} value={status}>{status}</option>)}
          </select>
        </label>
        <span className="text-[11px] text-slate-400">{done}/{tasks.length} tickets done</span>
      </div>

      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-700/80">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${tasks.length ? (done / tasks.length) * 100 : 0}%`, backgroundColor: feature.color || '#6366f1' }}
        />
      </div>

      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        aria-label={`${expanded ? 'Hide' : 'Show'} tickets for epic ${feature.title}`}
        className="mt-3 flex w-full flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-700/70 bg-slate-900/50 px-2.5 py-2 text-left text-xs text-slate-300 transition hover:border-slate-600 hover:text-white"
      >
        <span className="flex flex-wrap items-center gap-1.5">
          {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          <span>{tasks.length} {tasks.length === 1 ? 'ticket' : 'tickets'}</span>
          <span className="text-slate-500">·</span>
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
          <span>{done} done</span>
        </span>
        <span className="text-[10px] text-slate-500">{expanded ? 'Hide tickets' : 'View tickets'}</span>
      </button>

      {expanded && (
        <div className="mt-2 space-y-1.5">
          {tasks.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-700 px-3 py-3 text-center text-xs text-slate-500">No tickets in this epic yet.</p>
          ) : tasks.map((task) => (
            <div
              key={task.id}
              className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-700/50 bg-slate-900/40 px-2.5 py-2 transition hover:border-indigo-500/40 hover:bg-slate-900/80"
            >
              <button
                type="button"
                onClick={() => onOpenTask(task)}
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
                aria-label={`Open ticket ${task.title}`}
              >
                <span className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-medium ${STATUS_STYLES[task.status]}`}>
                  {task.status}
                </span>
                <span className="min-w-0 flex-1 truncate text-xs text-slate-200">{task.title}</span>
                <span className="shrink-0 text-[10px] text-slate-500">{task.priority}</span>
              </button>
              <button
                type="button"
                onClick={() => onDeleteTask(task.id)}
                className="shrink-0 rounded p-1 text-slate-500 transition hover:bg-rose-500/10 hover:text-rose-300"
                aria-label={`Delete ticket ${task.title}`}
                title="Delete ticket"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
              <div className="w-full">
                <WorkflowTimeline workflow={workflows?.[task.id] ?? getAgentWorkflow()} compact label={`Agent workflow for ${task.title}`} />
              </div>
              {task.status === 'Review' && <div className="w-full"><ReviewActions title={task.title} onReview={(ai) => onReviewTask(task, ai)} /></div>}
            </div>
          ))}
          {feature.status !== 'Review' && feature.status !== 'Done' && <button
            type="button"
            onClick={() => onAddTask(feature.status, feature.id)}
            className="flex w-full items-center justify-center gap-1 rounded-lg border border-dashed border-slate-700 px-2 py-2 text-xs text-indigo-300 transition hover:border-indigo-500/50 hover:bg-indigo-500/5"
            aria-label={`Add ticket to epic ${feature.title}`}
          >
            <Plus className="h-3.5 w-3.5" /> Add ticket to epic
          </button>}
        </div>
      )}
    </article>
  );
};
