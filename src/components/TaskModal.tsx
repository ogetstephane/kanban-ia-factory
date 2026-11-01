import React, { useState, useEffect, lazy, Suspense } from 'react';
import {
  X,
  Sparkles,
  Plus,
  Trash2,
  CheckSquare,
  Square,
  AlertCircle,
  HelpCircle,
  Loader2,
  Tag as TagIcon
} from 'lucide-react';
import { Task, Feature, KanbanStatus, TaskPriority, Subtask } from '../types/kanban';
import { CREATION_STATUSES, TASK_PRIORITIES, canCreateTaskIn, reachableStatuses } from '../utils/kanbanLogic';
import type { SessionActionFocus } from '../types/agent';
import { useOperation } from '../data/useOperation';
import { ContextFiles } from './ContextFiles';
import type { ContextFile } from '../types/contextFile';

const TaskAgentSession = lazy(() => import('./TaskAgentSession'));
const ReleaseSelect = lazy(() => import('./ReleaseSelect'));

interface TaskModalProps {
  isOpen: boolean;
  onClose: () => void;
  task: Task | null;
  features: Feature[];
  projectId: string;
  defaultStatus?: KanbanStatus;
  defaultFeatureId?: string;
  sessionAction?: SessionActionFocus;
  onSave: (task: Task) => void | boolean | Promise<void | boolean>;
  onSessionTaskChange?: () => void;
  presentation?: 'modal' | 'page';
  pending?: boolean;
  error?: string;
}

export const TaskModal: React.FC<TaskModalProps> = ({
  isOpen,
  onClose,
  task,
  features,
  projectId,
  defaultStatus = 'To Do',
  defaultFeatureId,
  sessionAction,
  onSave,
  onSessionTaskChange,
  presentation = 'modal',
  pending = false,
  error = '',
}) => {
  const save = useOperation();
  const upload = useOperation();
  const [contextFiles, setContextFiles] = useState<ContextFile[]>([]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<KanbanStatus>(defaultStatus);
  const [priority, setPriority] = useState<TaskPriority>('Medium');
  const [featureId, setFeatureId] = useState<string>('');
  const [releaseId, setReleaseId] = useState('');
  const [storyPoints, setStoryPoints] = useState<number>(3);
  const [tagsInput, setTagsInput] = useState('');
  const [subtasks, setSubtasks] = useState<Subtask[]>([]);
  const [newSubtaskText, setNewSubtaskText] = useState('');
  const [acceptanceCriteria, setAcceptanceCriteria] = useState<string[]>([]);
  const [newCriterion, setNewCriterion] = useState('');
  const [suggestedWorkflow, setSuggestedWorkflow] = useState('');
  const [blockedReason, setBlockedReason] = useState('');
  const [isCopilotGenerating, setIsCopilotGenerating] = useState(false);
  const [copilotFeedback, setCopilotFeedback] = useState<string | null>(null);

  useEffect(() => {
    upload.clearError();
    if (task) {
      setContextFiles(task.contextFiles ?? []);
      setTitle(task.title);
      setDescription(task.description);
      setStatus(task.status);
      setPriority(task.priority);
      setFeatureId(task.featureId || '');
      setReleaseId(task.releaseId || '');
      setStoryPoints(task.storyPoints || 3);
      setTagsInput(task.tags ? task.tags.join(', ') : '');
      setSubtasks(task.subtasks || []);
      setAcceptanceCriteria(task.acceptanceCriteria || []);
      setSuggestedWorkflow(task.suggestedWorkflow || '');
      setBlockedReason(task.blockedReason || '');
      setCopilotFeedback(null);
    } else {
      setContextFiles([]);
      setTitle('');
      setDescription('');
      setPriority('Medium');
      const defaultFeature = features.find((feature) => feature.id === defaultFeatureId)
        ?? features.find((feature) => !['Review', 'Done'].includes(feature.status));
      setFeatureId(defaultFeature?.id ?? '');
      setStatus(defaultFeature?.status ?? (canCreateTaskIn(defaultStatus) ? defaultStatus : 'To Do'));
      setReleaseId('');
      setStoryPoints(3);
      setTagsInput('');
      setSubtasks([]);
      setAcceptanceCriteria([]);
      setSuggestedWorkflow('');
      setBlockedReason('');
      setCopilotFeedback(null);
    }
  }, [task, isOpen, defaultStatus, defaultFeatureId, features]);

  if (!isOpen) return null;

  const handleAddSubtask = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSubtaskText.trim()) return;
    setSubtasks([
      ...subtasks,
      {
        id: `st-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        text: newSubtaskText.trim(),
        completed: false,
      },
    ]);
    setNewSubtaskText('');
  };

  const handleToggleSubtask = (id: string) => {
    setSubtasks(
      subtasks.map((st) => (st.id === id ? { ...st, completed: !st.completed } : st))
    );
  };

  const handleDeleteSubtask = (id: string) => {
    setSubtasks(subtasks.filter((st) => st.id !== id));
  };

  const handleAddCriterion = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCriterion.trim()) return;
    setAcceptanceCriteria([...acceptanceCriteria, newCriterion.trim()]);
    setNewCriterion('');
  };

  const handleDeleteCriterion = (index: number) => {
    setAcceptanceCriteria(acceptanceCriteria.filter((_, i) => i !== index));
  };

  // AI Copilot Auto-Specification trigger
  const handleCopilotEnhance = async () => {
    if (!title.trim()) {
      setCopilotFeedback('Please enter at least a Task Title for Copilot to enhance.');
      return;
    }
    setIsCopilotGenerating(true);
    setCopilotFeedback(null);

    const parentFeature = features.find((f) => f.id === featureId);

    try {
      const response = await fetch('/api/copilot/generate-description', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          currentDescription: description,
          featureTitle: parentFeature ? parentFeature.title : undefined,
          priority,
        }),
      });

      if (!response.ok) throw new Error('Failed to generate task description');
      const data = await response.json();

      if (data.description) setDescription(data.description);
      if (Array.isArray(data.acceptanceCriteria) && data.acceptanceCriteria.length > 0) {
        setAcceptanceCriteria(data.acceptanceCriteria);
      }
      if (Array.isArray(data.subtasks) && data.subtasks.length > 0) {
        setSubtasks(
          data.subtasks.map((text: string, i: number) => ({
            id: `copilot-st-${Date.now()}-${i}`,
            text,
            completed: false,
          }))
        );
      }
      if (data.suggestedWorkflow) setSuggestedWorkflow(data.suggestedWorkflow);
      if (data.estimatedStoryPoints) setStoryPoints(data.estimatedStoryPoints);
      if (Array.isArray(data.suggestedTags) && data.suggestedTags.length > 0) {
        setTagsInput(data.suggestedTags.join(', '));
      }

      setCopilotFeedback('✨ Copilot auto-generated detailed spec & acceptance criteria!');
    } catch (err: any) {
      setCopilotFeedback(`Notice: ${err.message || 'Error communicating with AI Copilot'}`);
    } finally {
      setIsCopilotGenerating(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || upload.pending) return;

    const parsedTags = tagsInput
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t.length > 0);

    const updatedTask: Task = {
      id: task ? task.id : `task-${Date.now()}`,
      projectId: (task ? task.projectId : projectId) || undefined,
      title: title.trim(),
      description: description.trim(),
      status,
      priority,
      featureId: featureId || undefined,
      releaseId: releaseId || undefined,
      storyPoints,
      tags: parsedTags,
      subtasks,
      acceptanceCriteria,
      suggestedWorkflow: suggestedWorkflow.trim() || undefined,
      blockedReason: blockedReason.trim(),
      contextFiles,
      order: task ? task.order : 0,
      createdAt: task ? task.createdAt : new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    void save.run(async () => {
      const result = await onSave(updatedTask);
      if (result !== false) onClose();
    });
  };

  return (
    <div
      className={presentation === 'page' ? 'mx-auto w-full max-w-6xl' : 'fixed inset-0 z-50 flex items-start justify-center p-4 bg-slate-950/80 backdrop-blur-sm overflow-y-auto'}
      role={presentation === 'page' ? 'region' : 'dialog'}
      aria-modal={presentation === 'modal' ? true : undefined}
      aria-labelledby="modal-task-title"
    >
      <div className={`relative w-full ${presentation === 'modal' ? 'max-w-6xl' : ''} bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl p-6 text-slate-100 my-auto`}>
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <h2 id="modal-task-title" className="text-lg font-bold">
              {task ? 'Edit Kanban Task' : 'Create New Task'}
            </h2>
            <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 font-medium">
              {status}
            </span>
          </div>
          <button
            onClick={onClose}
            disabled={pending || save.pending || upload.pending}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
            aria-label={presentation === 'page' ? 'Return to workspace' : 'Close dialog'}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <fieldset disabled={pending || save.pending} className="space-y-4">
          <div className="grid gap-6 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <section aria-label="Task content" className="min-w-0 space-y-4">
          {/* Title & Copilot Button */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label htmlFor="task-title-input" className="text-xs font-semibold text-slate-300">
                Task Title *
              </label>
              <button
                type="button"
                onClick={handleCopilotEnhance}
                disabled={isCopilotGenerating || !title.trim()}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-300 hover:text-amber-200 bg-amber-500/10 hover:bg-amber-500/20 px-2.5 py-1 rounded-lg border border-amber-500/30 transition-all disabled:opacity-50 cursor-pointer"
                title="Use Copilot to auto-generate description, acceptance criteria & subtasks"
              >
                {isCopilotGenerating ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-400" />
                    <span>Generating spec...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                    <span>Copilot Auto-Spec</span>
                  </>
                )}
              </button>
            </div>
            <input
              id="task-title-input"
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Implement OAuth token revocation endpoints"
              className="w-full px-3 py-2 text-sm bg-slate-800 border border-slate-700 rounded-lg text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          {copilotFeedback && (
            <div className="p-2.5 rounded-lg bg-indigo-500/10 border border-indigo-500/30 text-xs text-indigo-300 flex items-center justify-between">
              <span>{copilotFeedback}</span>
              <button
                type="button"
                onClick={() => setCopilotFeedback(null)}
                className="text-xs text-indigo-400 hover:text-white"
              >
                ✕
              </button>
            </div>
          )}

          <div>
            <label htmlFor="task-desc-input" className="text-xs font-semibold text-slate-300 block mb-1">
              Description & Context
            </label>
            <textarea
              id="task-desc-input"
              rows={14}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Outline technical approach, scope, and instructions..."
              className="w-full px-3 py-2 text-sm bg-slate-800 border border-slate-700 rounded-lg text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-sans"
            />
          </div>
          <ContextFiles files={contextFiles} onChange={setContextFiles} operation={upload} />
          </section>

          <section aria-label="Task details" className="min-w-0 space-y-4">
          <Suspense fallback={<p className="text-xs">Loading versions...</p>}>
            <ReleaseSelect projectId={task?.projectId ?? projectId} value={releaseId} onChange={setReleaseId} />
          </Suspense>

          {/* Metadata Row: Feature, Status, Priority, Story Points */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="task-feature-select" className="text-xs font-semibold text-slate-300 block mb-1">
                Parent Feature
              </label>
              <select
                id="task-feature-select"
                value={featureId}
                onChange={(e) => {
                  const selectedFeatureId = e.target.value;
                  setFeatureId(selectedFeatureId);
                  const selectedFeature = features.find((feature) => feature.id === selectedFeatureId);
                  if (selectedFeature && !task) setStatus(selectedFeature.status);
                }}
                className="w-full px-2.5 py-1.5 text-xs bg-slate-800 border border-slate-700 rounded-lg text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
              >
                <option value="">None (Standalone)</option>
                {features.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.title}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="task-status-select" className="text-xs font-semibold text-slate-300 block mb-1">
                Workflow Stage
              </label>
              <select
                id="task-status-select"
                value={status}
                onChange={(e) => setStatus(e.target.value as KanbanStatus)}
                className="w-full px-2.5 py-1.5 text-xs bg-slate-800 border border-slate-700 rounded-lg text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
              >
                {(task ? reachableStatuses(task.status) : featureId
                  ? [features.find((feature) => feature.id === featureId)?.status ?? status]
                  : CREATION_STATUSES).map((st) => (
                  <option key={st} value={st}>
                    {st}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="task-priority-select" className="text-xs font-semibold text-slate-300 block mb-1">
                Priority
              </label>
              <select
                id="task-priority-select"
                value={priority}
                onChange={(e) => setPriority(e.target.value as TaskPriority)}
                className="w-full px-2.5 py-1.5 text-xs bg-slate-800 border border-slate-700 rounded-lg text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
              >
                {TASK_PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="task-points-select" className="text-xs font-semibold text-slate-300 block mb-1">
                Story Points
              </label>
              <select
                id="task-points-select"
                value={storyPoints}
                onChange={(e) => setStoryPoints(Number(e.target.value))}
                className="w-full px-2.5 py-1.5 text-xs bg-slate-800 border border-slate-700 rounded-lg text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
              >
                <option value={1}>1 pt (Trivial)</option>
                <option value={2}>2 pts (Small)</option>
                <option value={3}>3 pts (Medium)</option>
                <option value={5}>5 pts (Large)</option>
                <option value={8}>8 pts (Complex)</option>
              </select>
            </div>
          </div>

          <div>
            <label htmlFor="task-blocked-reason" className="text-xs font-semibold text-slate-300 block mb-1">Blocked reason (leave empty when unblocked)</label>
            <input id="task-blocked-reason" value={blockedReason} maxLength={2000}
              onChange={(event) => setBlockedReason(event.target.value)}
              className="w-full px-3 py-2 text-sm bg-slate-800 border border-slate-700 rounded-lg"
              placeholder="Waiting for access, product decision..." />
          </div>

          {/* Subtasks Checklist */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-semibold text-slate-300 flex items-center gap-1">
                <CheckSquare className="w-3.5 h-3.5 text-indigo-400" />
                <span>Checklist / Subtasks ({subtasks.filter((s) => s.completed).length}/{subtasks.length})</span>
              </label>
            </div>

            <div className="space-y-1.5 max-h-36 overflow-y-auto mb-2 pr-1">
              {subtasks.map((st) => (
                <div
                  key={st.id}
                  className="flex items-center justify-between gap-2 p-1.5 rounded-lg bg-slate-800/60 border border-slate-700/50 text-xs"
                >
                  <button
                    type="button"
                    onClick={() => handleToggleSubtask(st.id)}
                    className="flex items-center gap-2 text-left flex-1 cursor-pointer"
                  >
                    {st.completed ? (
                      <CheckSquare className="w-4 h-4 text-emerald-400 shrink-0" />
                    ) : (
                      <Square className="w-4 h-4 text-slate-400 shrink-0" />
                    )}
                    <span className={st.completed ? 'line-through text-slate-400' : 'text-slate-200'}>
                      {st.text}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteSubtask(st.id)}
                    className="text-slate-400 hover:text-rose-400 p-0.5 cursor-pointer"
                    aria-label={`Remove subtask ${st.text}`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <input
                type="text"
                value={newSubtaskText}
                onChange={(e) => setNewSubtaskText(e.target.value)}
                placeholder="Add checklist step..."
                className="min-w-0 flex-1 px-3 py-1.5 text-xs bg-slate-800 border border-slate-700 rounded-lg text-slate-200 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <button
                type="button"
                onClick={handleAddSubtask}
                className="px-3 py-1.5 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg border border-slate-700 cursor-pointer"
              >
                Add Step
              </button>
            </div>
          </div>

          {/* Acceptance Criteria */}
          <div>
            <label className="text-xs font-semibold text-slate-300 block mb-1">
              Acceptance Criteria ({acceptanceCriteria.length})
            </label>
            <div className="space-y-1 max-h-32 overflow-y-auto mb-2 pr-1">
              {acceptanceCriteria.map((ac, idx) => (
                <div
                  key={idx}
                  className="flex items-start justify-between gap-2 p-1.5 rounded-lg bg-slate-800/40 border border-slate-700/40 text-xs text-slate-300"
                >
                  <span className="flex-1">• {ac}</span>
                  <button
                    type="button"
                    onClick={() => handleDeleteCriterion(idx)}
                    className="text-slate-400 hover:text-rose-400 p-0.5 cursor-pointer"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={newCriterion}
                onChange={(e) => setNewCriterion(e.target.value)}
                placeholder="Given/When/Then acceptance condition..."
                className="min-w-0 flex-1 px-3 py-1.5 text-xs bg-slate-800 border border-slate-700 rounded-lg text-slate-200 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <button
                type="button"
                onClick={handleAddCriterion}
                className="px-3 py-1.5 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg border border-slate-700 cursor-pointer"
              >
                Add Criteria
              </button>
            </div>
          </div>

          {/* Suggested Workflow / Testing Guidance */}
          {suggestedWorkflow && (
            <div className="p-3 rounded-xl bg-purple-500/10 border border-purple-500/20 text-xs text-purple-200">
              <div className="flex items-center gap-1.5 font-semibold text-purple-300 mb-1">
                <Sparkles className="w-3.5 h-3.5" />
                <span>Copilot Workflow Suggestion</span>
              </div>
              <p className="leading-relaxed">{suggestedWorkflow}</p>
            </div>
          )}

          {/* Tags */}
          <div>
            <label htmlFor="task-tags-input" className="text-xs font-semibold text-slate-300 flex items-center gap-1 mb-1">
              <TagIcon className="w-3 h-3 text-slate-400" />
              <span>Tags (comma-separated)</span>
            </label>
            <input
              id="task-tags-input"
              type="text"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              placeholder="e.g. auth, backend, security"
              className="w-full px-3 py-1.5 text-xs bg-slate-800 border border-slate-700 rounded-lg text-slate-200 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          </section>
          </div>

          {task && <div><Suspense fallback={<p className="text-xs">Loading AI session…</p>}>
            <TaskAgentSession key={task.id} taskId={task.id} initialAction={sessionAction} onTaskChange={onSessionTaskChange} />
          </Suspense></div>}

          {/* Modal Actions */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-800">
            {(error || save.error) && <p role="alert" className="mr-auto text-sm text-rose-300">{error || save.error}</p>}
            <button
              type="button"
              onClick={onClose}
              disabled={pending || save.pending || upload.pending}
              className="px-4 py-2 text-xs font-medium rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending || save.pending || upload.pending}
              className="px-4 py-2 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white transition-all shadow-md shadow-indigo-600/20 active:scale-95 cursor-pointer"
            >
              {pending || save.pending ? 'Saving...' : task ? 'Save Changes' : 'Create Task'}
            </button>
          </div>
          </fieldset>
        </form>
      </div>
    </div>
  );
};
