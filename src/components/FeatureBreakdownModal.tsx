import React, { useState, useEffect } from 'react';
import {
  X,
  Sparkles,
  Layers,
  CheckCircle2,
  AlertCircle,
  Plus,
  Loader2,
  ArrowRight,
  ListPlus
} from 'lucide-react';
import { Feature, Task, TaskPriority, KanbanStatus } from '../types/kanban';

interface ProposedTask {
  title: string;
  description: string;
  priority: TaskPriority;
  status: KanbanStatus;
  storyPoints: number;
  tags: string[];
  acceptanceCriteria: string[];
  subtasks: string[];
  suggestedWorkflow?: string;
  selected: boolean;
}

interface FeatureBreakdownModalProps {
  isOpen: boolean;
  onClose: () => void;
  features: Feature[];
  initialFeatureId?: string;
  onApplyBreakdown: (feature: Feature, tasks: Omit<Task, 'id' | 'createdAt' | 'updatedAt' | 'order'>[]) => void;
}

export const FeatureBreakdownModal: React.FC<FeatureBreakdownModalProps> = ({
  isOpen,
  onClose,
  features,
  initialFeatureId,
  onApplyBreakdown,
}) => {
  const [mode, setMode] = useState<'existing' | 'new'>('existing');
  const [selectedFeatureId, setSelectedFeatureId] = useState<string>('');
  const [newTitle, setNewTitle] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newCategory, setNewCategory] = useState('Core Architecture');
  const [newColor, setNewColor] = useState('#6366f1');

  const [isLoading, setIsLoading] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const [proposedTasks, setProposedTasks] = useState<ProposedTask[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (initialFeatureId) {
      setSelectedFeatureId(initialFeatureId);
      setMode('existing');
    } else if (features.length > 0) {
      setSelectedFeatureId(features[0].id);
      setMode('existing');
    } else {
      setMode('new');
    }
    setProposedTasks([]);
    setSummary(null);
    setErrorMsg(null);
  }, [isOpen, initialFeatureId, features]);

  if (!isOpen) return null;

  const currentFeature = features.find((f) => f.id === selectedFeatureId);

  const activeTitle = mode === 'existing' ? currentFeature?.title || '' : newTitle;
  const activeDesc = mode === 'existing' ? currentFeature?.description || '' : newDescription;
  const activeCategory = mode === 'existing' ? currentFeature?.category || 'General' : newCategory;

  const handleGenerateBreakdown = async () => {
    if (!activeTitle.trim()) {
      setErrorMsg('Please specify a feature title to break down.');
      return;
    }

    setIsLoading(true);
    setErrorMsg(null);
    setProposedTasks([]);

    try {
      const response = await fetch('/api/copilot/breakdown', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          featureTitle: activeTitle,
          featureDescription: activeDesc,
          category: activeCategory,
        }),
      });

      if (!response.ok) throw new Error('Failed to generate breakdown from Copilot');

      const data = await response.json();
      setSummary(data.summary || 'AI Copilot generated the following task breakdown:');

      if (Array.isArray(data.tasks)) {
        const mapped: ProposedTask[] = data.tasks.map((t: any) => ({
          title: t.title || 'Untitled Task',
          description: t.description || '',
          priority: (t.priority as TaskPriority) || 'Medium',
          status: t.status === 'Backlog' ? 'Backlog' : 'To Do',
          storyPoints: t.storyPoints || 3,
          tags: Array.isArray(t.tags) ? t.tags : ['feature'],
          acceptanceCriteria: Array.isArray(t.acceptanceCriteria) ? t.acceptanceCriteria : [],
          subtasks: Array.isArray(t.subtasks) ? t.subtasks : [],
          suggestedWorkflow: t.suggestedWorkflow || '',
          selected: true,
        }));
        setProposedTasks(mapped);
      }
    } catch (err: any) {
      setErrorMsg(`Copilot breakdown error: ${err.message || 'Unknown error'}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleToggleTaskSelection = (index: number) => {
    setProposedTasks(
      proposedTasks.map((t, i) => (i === index ? { ...t, selected: !t.selected } : t))
    );
  };

  const handleUpdateTaskPriority = (index: number, priority: TaskPriority) => {
    setProposedTasks(
      proposedTasks.map((t, i) => (i === index ? { ...t, priority } : t))
    );
  };

  const handleApply = () => {
    const selected = proposedTasks.filter((t) => t.selected);
    if (selected.length === 0) {
      setErrorMsg('Please select at least one task to add to the board.');
      return;
    }

    let targetFeature: Feature;
    if (mode === 'existing' && currentFeature) {
      targetFeature = currentFeature;
    } else {
      targetFeature = {
        id: `feat-${Date.now()}`,
        title: newTitle.trim(),
        description: newDescription.trim(),
        category: newCategory.trim(),
        status: 'To Do',
        color: newColor,
        createdAt: new Date().toISOString(),
      };
    }

    const tasksToAdd = selected.map((pt) => ({
      title: pt.title,
      description: pt.description,
      priority: pt.priority,
      status: targetFeature.status,
      featureId: targetFeature.id,
      storyPoints: pt.storyPoints,
      tags: pt.tags,
      subtasks: pt.subtasks.map((st, i) => ({
        id: `sub-${Date.now()}-${i}`,
        text: st,
        completed: false,
      })),
      acceptanceCriteria: pt.acceptanceCriteria,
      suggestedWorkflow: pt.suggestedWorkflow,
    }));

    onApplyBreakdown(targetFeature, tasksToAdd);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="breakdown-modal-title"
    >
      <div className="relative w-full max-w-3xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl p-6 text-slate-100 my-8">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-amber-500 to-indigo-600 flex items-center justify-center shadow-md shadow-amber-500/20">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <div>
              <h2 id="breakdown-modal-title" className="text-lg font-bold">
                Feature Decomposition & Task Breakdown
              </h2>
              <p className="text-xs text-slate-400">
                Split large product features into prioritized, actionable Kanban tasks with AI Copilot
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
            aria-label="Close dialog"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Feature Selection / Creation Tabs */}
        <div className="mt-4">
          <div className="flex items-center gap-2 p-1 bg-slate-800/80 rounded-xl mb-4 border border-slate-700/60 w-fit">
            <button
              type="button"
              onClick={() => setMode('existing')}
              className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                mode === 'existing'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Select Existing Feature ({features.length})
            </button>
            <button
              type="button"
              onClick={() => setMode('new')}
              className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                mode === 'new'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              + Write New Feature
            </button>
          </div>

          {mode === 'existing' ? (
            <div className="space-y-3 bg-slate-800/40 p-4 rounded-xl border border-slate-800">
              <label htmlFor="breakdown-feature-select" className="text-xs font-semibold text-slate-300 block">
                Choose Feature to Decompose
              </label>
              <select
                id="breakdown-feature-select"
                value={selectedFeatureId}
                onChange={(e) => setSelectedFeatureId(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-slate-800 border border-slate-700 rounded-lg text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
              >
                {features.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.title} ({f.category})
                  </option>
                ))}
              </select>
              {currentFeature && (
                <p className="text-xs text-slate-400 italic">
                  &ldquo;{currentFeature.description}&rdquo;
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-3 bg-slate-800/40 p-4 rounded-xl border border-slate-800">
              <div>
                <label htmlFor="new-feature-title" className="text-xs font-semibold text-slate-300 block mb-1">
                  Feature Title *
                </label>
                <input
                  id="new-feature-title"
                  type="text"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="e.g. AI-Powered Smart Search & Auto-Tagging"
                  className="w-full px-3 py-2 text-sm bg-slate-800 border border-slate-700 rounded-lg text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label htmlFor="new-feature-desc" className="text-xs font-semibold text-slate-300 block mb-1">
                  Feature Goals & Scope
                </label>
                <textarea
                  id="new-feature-desc"
                  rows={2}
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  placeholder="High-level description of what the user needs and business outcome..."
                  className="w-full px-3 py-2 text-xs bg-slate-800 border border-slate-700 rounded-lg text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="new-feature-category" className="text-xs font-semibold text-slate-300 block mb-1">
                    Category
                  </label>
                  <input
                    id="new-feature-category"
                    type="text"
                    value={newCategory}
                    onChange={(e) => setNewCategory(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs bg-slate-800 border border-slate-700 rounded-lg text-slate-200"
                  />
                </div>
                <div>
                  <label htmlFor="new-feature-color" className="text-xs font-semibold text-slate-300 block mb-1">
                    Badge Color
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      id="new-feature-color"
                      type="color"
                      value={newColor}
                      onChange={(e) => setNewColor(e.target.value)}
                      className="w-8 h-8 rounded bg-transparent border-0 cursor-pointer"
                    />
                    <span className="text-xs font-mono text-slate-400">{newColor}</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Trigger Button */}
          <div className="mt-4 flex items-center justify-between">
            <button
              type="button"
              onClick={handleGenerateBreakdown}
              disabled={isLoading || !activeTitle.trim()}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs sm:text-sm font-semibold rounded-xl bg-gradient-to-r from-amber-500 via-indigo-600 to-purple-600 hover:from-amber-400 hover:to-purple-500 text-white shadow-lg shadow-indigo-600/25 active:scale-95 transition-all disabled:opacity-50 cursor-pointer"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-white" />
                  <span>AI Copilot is analyzing & splitting tasks...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 text-amber-300" />
                  <span>Auto-Split Feature with Copilot</span>
                </>
              )}
            </button>

            {proposedTasks.length > 0 && (
              <span className="text-xs text-slate-400">
                {proposedTasks.filter((t) => t.selected).length} of {proposedTasks.length} tasks selected
              </span>
            )}
          </div>

          {errorMsg && (
            <div className="mt-3 p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/30 text-xs text-rose-300 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Proposed Tasks Preview & Customization */}
          {proposedTasks.length > 0 && (
            <div className="mt-5 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                  <ListPlus className="w-4 h-4 text-emerald-400" />
                  <span>Proposed Decomposed Tasks</span>
                </h3>
                {summary && <span className="text-xs text-slate-400 italic">{summary}</span>}
              </div>

              <div className="space-y-2.5 max-h-72 overflow-y-auto pr-1">
                {proposedTasks.map((t, idx) => (
                  <div
                    key={idx}
                    className={`p-3 rounded-xl border transition-all ${
                      t.selected
                        ? 'bg-slate-800/80 border-indigo-500/40'
                        : 'bg-slate-900/40 border-slate-800 opacity-60'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-2.5 flex-1">
                        <input
                          type="checkbox"
                          checked={t.selected}
                          onChange={() => handleToggleTaskSelection(idx)}
                          className="mt-1 rounded border-slate-700 bg-slate-900 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                        />
                        <div>
                          <h4 className="text-xs font-semibold text-slate-100 mb-1">
                            {t.title}
                          </h4>
                          <p className="text-[11px] text-slate-400 line-clamp-2 leading-relaxed mb-2">
                            {t.description}
                          </p>

                          {/* Acceptance preview & subtasks */}
                          {t.subtasks && t.subtasks.length > 0 && (
                            <div className="flex flex-wrap gap-1 mb-1.5">
                              {t.subtasks.map((st, i) => (
                                <span
                                  key={i}
                                  className="text-[10px] px-1.5 py-0.5 rounded bg-slate-900/80 text-slate-300 border border-slate-800"
                                >
                                  ✓ {st}
                                </span>
                              ))}
                            </div>
                          )}

                          {t.suggestedWorkflow && (
                            <p className="text-[10px] text-purple-300 italic">
                              Workflow tip: {t.suggestedWorkflow}
                            </p>
                          )}
                        </div>
                      </div>

                      {/* Priority selector & Stage pill */}
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        <select
                          value={t.priority}
                          onChange={(e) => handleUpdateTaskPriority(idx, e.target.value as TaskPriority)}
                          className="text-[11px] bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-slate-200 cursor-pointer"
                        >
                          <option value="Critical">Critical</option>
                          <option value="High">High</option>
                          <option value="Medium">Medium</option>
                          <option value="Low">Low</option>
                        </select>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700/50 text-slate-300">
                          {t.status} • {t.storyPoints} pts
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Modal Actions */}
          <div className="flex items-center justify-end gap-3 pt-5 mt-4 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleApply}
              disabled={proposedTasks.filter((t) => t.selected).length === 0}
              className="px-4 py-2 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white transition-all shadow-md shadow-emerald-600/20 active:scale-95 cursor-pointer flex items-center gap-1.5"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>Add Selected Tasks to Board</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
