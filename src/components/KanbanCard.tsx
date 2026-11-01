import React, { useState } from 'react';
import {
  Sparkles,
  CheckSquare,
  MoreVertical,
  ArrowRight,
  ArrowLeft,
  Trash2,
  Edit2,
  Tag,
  AlertCircle
} from 'lucide-react';
import { Task, Feature, KanbanStatus, TaskPriority } from '../types/kanban';
import { KANBAN_STATUSES, canMoveTask, reachableStatuses } from '../utils/kanbanLogic';
import ReviewActions from './ReviewActions';
import WorkflowTimeline from './WorkflowTimeline';
import { getAgentWorkflow } from '../utils/agentWorkflow';
import type { AgentWorkflow } from '../types/workflow';

interface KanbanCardProps {
  task: Task;
  workflow?: AgentWorkflow;
  feature?: Feature;
  projectName?: string;
  onEdit: (task: Task) => void;
  onDelete: (taskId: string) => void;
  onMoveStatus: (taskId: string, targetStatus: KanbanStatus) => void;
  onOpenCopilotSpec: (task: Task) => void;
  onDragStatus: (from: KanbanStatus | null) => void;
  onReview?: (task: Task, ai: boolean) => void;
}

const PRIORITY_STYLES: Record<TaskPriority, { bg: string; text: string; border: string }> = {
  Critical: { bg: 'bg-rose-500/10', text: 'text-rose-400', border: 'border-rose-500/30' },
  High: { bg: 'bg-amber-500/10', text: 'text-amber-400', border: 'border-amber-500/30' },
  Medium: { bg: 'bg-sky-500/10', text: 'text-sky-400', border: 'border-sky-500/30' },
  Low: { bg: 'bg-slate-500/10', text: 'text-slate-400', border: 'border-slate-500/30' },
};

export const KanbanCard: React.FC<KanbanCardProps> = ({
  task,
  workflow,
  feature,
  projectName,
  onEdit,
  onDelete,
  onMoveStatus,
  onOpenCopilotSpec,
  onDragStatus,
  onReview,
}) => {
  const [showMenu, setShowMenu] = useState(false);
  const priorityStyle = PRIORITY_STYLES[task.priority] || PRIORITY_STYLES.Medium;

  const completedSubtasks = task.subtasks.filter((s) => s.completed).length;
  const totalSubtasks = task.subtasks.length;

  const currentStatusIndex = KANBAN_STATUSES.indexOf(task.status);
  const before = KANBAN_STATUSES[currentStatusIndex - 1];
  const after = KANBAN_STATUSES[currentStatusIndex + 1];
  const prevStatus = before && canMoveTask(task.status, before) ? before : null;
  const nextStatus = after && canMoveTask(task.status, after) ? after : null;
  const stageOptions = reachableStatuses(task.status);

  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData('text/plain', task.id);
    e.dataTransfer.effectAllowed = 'move';
    onDragStatus(task.status);
  };

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      onDragEnd={() => onDragStatus(null)}
      className="group relative bg-slate-800/80 hover:bg-slate-800 border border-slate-700/70 hover:border-slate-600 rounded-xl p-3.5 shadow-sm hover:shadow-md transition-all duration-150 cursor-grab active:cursor-grabbing select-none"
    >
      {projectName && <p className="mb-2 break-words text-xs font-medium text-indigo-300">{projectName}</p>}
      {task.status === 'Review' && onReview && <ReviewActions title={task.title} onReview={(ai) => onReview(task, ai)} />}
      {/* Top row: Priority & Feature pill */}
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          {/* Priority Badge */}
          <span
            className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border ${priorityStyle.bg} ${priorityStyle.text} ${priorityStyle.border}`}
          >
            {task.priority === 'Critical' && <AlertCircle className="w-2.5 h-2.5" />}
            {task.priority}
          </span>

          {/* Feature Badge */}
          {feature && (
            <span
              className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-slate-700/60 text-slate-300 border border-slate-600/50 max-w-[130px] truncate"
              title={feature.title}
            >
              <span
                className="w-1.5 h-1.5 rounded-full inline-block shrink-0"
                style={{ backgroundColor: feature.color || '#6366f1' }}
              />
              <span className="truncate">{feature.title}</span>
            </span>
          )}
        </div>

        {/* Story Points pill */}
        <span className="text-[10px] font-mono font-medium px-1.5 py-0.5 rounded bg-slate-700/50 text-slate-300">
          {task.storyPoints || 1} pts
        </span>
      </div>

      {task.blockedReason && <p title={task.blockedReason} className="text-xs text-rose-300 bg-rose-500/10 rounded p-2 mb-2">Blocked: {task.blockedReason}</p>}
      <div className="mb-3">
        <WorkflowTimeline workflow={workflow ?? getAgentWorkflow()} compact label={`Agent workflow for ${task.title}`} />
      </div>

      {/* Task Title (click to open detail modal) */}
      <button
        onClick={() => onEdit(task)}
        className="w-full text-left font-medium text-sm text-slate-100 hover:text-indigo-300 transition-colors line-clamp-2 mb-1.5 cursor-pointer"
        aria-label={`Open task ${task.title}`}
      >
        {task.title}
      </button>

      {/* Description Snippet */}
      {task.description && (
        <p className="text-xs text-slate-400 line-clamp-2 mb-2.5 leading-relaxed">
          {task.description}
        </p>
      )}

      {/* Subtasks / Checklist progress */}
      {totalSubtasks > 0 && (
        <div className="flex items-center gap-1.5 text-[11px] text-slate-400 mb-2.5 bg-slate-900/40 px-2 py-1 rounded-md border border-slate-800">
          <CheckSquare className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
          <span>
            {completedSubtasks}/{totalSubtasks} subtasks
          </span>
          <div className="flex-1 h-1 bg-slate-700 rounded-full ml-1 overflow-hidden">
            <div
              className="h-full bg-indigo-500 rounded-full"
              style={{ width: `${(completedSubtasks / totalSubtasks) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* Tags row */}
      {task.tags && task.tags.length > 0 && (
        <div className="flex items-center gap-1 flex-wrap mb-2.5">
          {task.tags.map((tag) => (
            <span
              key={tag}
              className="text-[10px] text-slate-400 bg-slate-900/60 px-1.5 py-0.5 rounded border border-slate-800"
            >
              #{tag}
            </span>
          ))}
        </div>
      )}

      {/* Action / Stage Progression Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-700/40 text-xs">
        <div className="flex items-center gap-1">
          {prevStatus && (
            <button
              onClick={() => onMoveStatus(task.id, prevStatus)}
              className="p-1 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-700/60 transition-colors cursor-pointer"
              title={`Move to ${prevStatus}`}
              aria-label={`Move task ${task.title} back to ${prevStatus}`}
            >
              <ArrowLeft className="w-3.5 h-3.5" />
            </button>
          )}

          {/* Quick status dropdown */}
          <select
            value={task.status}
            onChange={(e) => onMoveStatus(task.id, e.target.value as KanbanStatus)}
            className="text-[11px] bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-slate-300 hover:text-white cursor-pointer focus:outline-none"
            aria-label={`Current stage of ${task.title}`}
          >
            {stageOptions.map((st) => (
              <option key={st} value={st}>
                {st}
              </option>
            ))}
          </select>

          {nextStatus && (
            <button
              onClick={() => onMoveStatus(task.id, nextStatus)}
              className="p-1 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-700/60 transition-colors cursor-pointer"
              title={`Move to ${nextStatus}`}
              aria-label={`Move task ${task.title} forward to ${nextStatus}`}
            >
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-1">
          {/* Copilot spec button */}
          <button
            onClick={() => onOpenCopilotSpec(task)}
            className="p-1 rounded text-slate-400 hover:text-amber-300 hover:bg-amber-400/10 transition-colors cursor-pointer"
            title="Auto-enhance spec with Copilot"
            aria-label={`Enhance task ${task.title} with Copilot`}
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
          </button>

          {/* Edit button */}
          <button
            onClick={() => onEdit(task)}
            className="p-1 rounded text-slate-400 hover:text-indigo-400 hover:bg-indigo-400/10 transition-colors cursor-pointer"
            title="Edit task details"
            aria-label={`Edit task ${task.title}`}
          >
            <Edit2 className="w-3.5 h-3.5" />
          </button>

          {/* Delete button */}
          <button
            onClick={() => onDelete(task.id)}
            className="p-1 rounded text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors cursor-pointer"
            title="Delete task"
            aria-label={`Delete task ${task.title}`}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};
