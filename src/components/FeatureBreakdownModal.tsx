import React, { useState, useEffect, useRef } from 'react';
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
import { Feature, Task, TaskPriority } from '../../shared/types/kanban';
import type { TaskBreakdownTicket } from '../../shared/types/taskBreakdown';
import type { AssistantPlan } from '../../shared/types/assistantMode';
import { boardApi } from '../data/boardApi';
import { taskDraftInputSchema } from '../../shared/types/taskDraft';
import { selectedBreakdownTasks } from '../utils/ticketBreakdown';
import { MarkdownPreview } from './MarkdownPreview';
import { canCreateTaskIn } from '../../shared/utils/kanbanLogic';
import { assessTicketBreakdown } from '../../shared/utils/ticketProposalQuality';
import { TicketProposalQuality } from './TicketProposalQuality';
import { TicketClarification } from './TicketClarification';
import {
  clarificationContext, ticketClarificationAnswersSchema,
  type TicketClarification as Clarification, type TicketClarificationAnswer,
} from '../../shared/types/ticketClarification';

interface ProposedTask extends TaskBreakdownTicket {
  selected: boolean;
}

interface FeatureBreakdownModalProps {
  isOpen: boolean;
  onClose: () => void;
  features: Feature[];
  projectId: string;
  initialFeatureId?: string;
  onApplyBreakdown: (feature: Feature, tasks: Omit<Task, 'id' | 'createdAt' | 'updatedAt' | 'order'>[]) => void | boolean | Promise<void | boolean>;
}

export const FeatureBreakdownModal: React.FC<FeatureBreakdownModalProps> = ({
  isOpen,
  onClose,
  features,
  projectId,
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
  const [impact, setImpact] = useState('');
  const [graphAvailable, setGraphAvailable] = useState(false);
  const [questions, setQuestions] = useState<string[]>([]);
  const [plan, setPlan] = useState<AssistantPlan | null>(null);
  const [clarification, setClarification] = useState<Clarification | null>(null);
  const [answers, setAnswers] = useState<string[]>([]);
  const [confirmedAnswers, setConfirmedAnswers] = useState<TicketClarificationAnswer[]>([]);
  const [saving, setSaving] = useState(false);
  const active = useRef<AbortController | null>(null);

  useEffect(() => {
    active.current?.abort();
    active.current = null;
    setIsLoading(false);
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
    setPlan(null);
    setImpact('');
    setQuestions([]);
    setClarification(null);
    setAnswers([]);
    setConfirmedAnswers([]);
    return () => { active.current?.abort(); active.current = null; };
  }, [isOpen, initialFeatureId, features, projectId]);

  useEffect(() => {
    active.current?.abort();
    active.current = null;
    setIsLoading(false);
    setProposedTasks([]);
    setSummary(null);
    setPlan(null);
    setImpact('');
    setQuestions([]);
    setErrorMsg(null);
    setClarification(null);
    setAnswers([]);
    setConfirmedAnswers([]);
  }, [mode, selectedFeatureId, newTitle, newDescription, newCategory]);

  if (!isOpen) return null;

  const currentFeature = features.find((f) => f.id === selectedFeatureId);

  const activeTitle = mode === 'existing' ? currentFeature?.title || '' : newTitle;
  const activeDesc = mode === 'existing' ? currentFeature?.description || '' : newDescription;
  const activeCategory = mode === 'existing' ? currentFeature?.category || 'General' : newCategory;

  const handleGenerateBreakdown = async (approvedPlan?: string) => {
    if (active.current || saving) return;
    if (!activeTitle.trim()) {
      setErrorMsg('Please specify a feature title to break down.');
      return;
    }

    setIsLoading(true);
    setErrorMsg(null);
    setProposedTasks([]);
    setSummary(null);
    setImpact('');
    setQuestions([]);
    const controller = new AbortController();
    active.current = controller;

    try {
      const submittedAnswers = clarification
        ? ticketClarificationAnswersSchema.parse(clarification.questions.map((question, index) => ({ question, answer: answers[index] ?? '' })))
        : confirmedAnswers;
      const data = await boardApi.assistBreakdown(projectId, taskDraftInputSchema.parse({
        title: activeTitle, currentDescription: activeDesc, tags: [activeCategory],
        ...(approvedPlan ? { approvedPlan } : {}),
        ...(submittedAnswers.length ? { clarificationAnswers: submittedAnswers } : {}),
      }), controller.signal);
      if (controller.signal.aborted) return;
      if (data.kind === 'clarification') {
        setPlan(null);
        setClarification(data);
        setAnswers(data.questions.map(() => ''));
        return;
      }
      setClarification(null);
      setAnswers([]);
      setConfirmedAnswers(submittedAnswers);
      if (data.kind === 'plan') {
        setPlan({ plan: data.plan, reason: data.reason });
        return;
      }
      setPlan(null);
      setSummary(data.summary);
      setImpact(data.impactAnalysis);
      setGraphAvailable(data.graphAvailable);
      setQuestions(data.openQuestions);
      setProposedTasks(data.tasks.map((task) => ({ ...task, selected: true })));
    } catch (err) {
      if (!controller.signal.aborted) setErrorMsg(`Copilot breakdown error: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      if (active.current === controller) { active.current = null; setIsLoading(false); }
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

  const handleApply = async () => {
    if (saving || active.current) return;
    setSaving(true);
    setErrorMsg(null);
    try {
      const selected = selectedBreakdownTasks(proposedTasks);
      if (mode === 'existing' && (!currentFeature || !canCreateTaskIn(currentFeature.status))) {
        throw new Error('Choose a Backlog or To Do feature. Ticket creation must not start implementation automatically.');
      }
      const targetFeature: Feature = mode === 'existing' && currentFeature ? currentFeature : {
        id: `feat-${Date.now()}`, title: newTitle.trim(), description: newDescription.trim(),
        category: newCategory.trim(), status: 'To Do', color: newColor, createdAt: new Date().toISOString(),
      };
      const tasksToAdd = selected.map((pt) => {
        const openQuestions = [...questions, ...(pt.openQuestions ?? [])];
        return {
          title: pt.title,
          description: [pt.description, ...[clarificationContext(confirmedAnswers)].filter(Boolean), ...(openQuestions.length ? [
            `## Open decisions\n\n${openQuestions.map((question) => `- ${question}`).join('\n')}`,
          ] : [])].join('\n\n'),
          priority: pt.priority, status: targetFeature.status, featureId: targetFeature.id,
          storyPoints: pt.estimatedStoryPoints, tags: pt.suggestedTags,
          subtasks: pt.subtasks.map((text) => ({ id: crypto.randomUUID(), text, completed: false })),
          acceptanceCriteria: pt.acceptanceCriteria, suggestedWorkflow: pt.suggestedWorkflow,
        };
      });
      const result = await onApplyBreakdown(targetFeature, tasksToAdd);
      if (result !== false) onClose();
      else setErrorMsg('Unable to save the breakdown. Your proposal is preserved; check the board error and retry.');
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : 'Unable to save the breakdown.');
    } finally { setSaving(false); }
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
            disabled={saving}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
            aria-label="Close dialog"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Feature Selection / Creation Tabs */}
        <fieldset disabled={saving || isLoading} className="mt-4">
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
              onClick={() => void handleGenerateBreakdown()}
              disabled={isLoading || !!clarification || !activeTitle.trim() || (mode === 'existing' && (!currentFeature || !canCreateTaskIn(currentFeature.status)))}
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
          {mode === 'existing' && currentFeature && !canCreateTaskIn(currentFeature.status) && <p role="alert" className="mt-2 text-xs text-amber-300">
            Choose a Backlog or To Do feature to create tickets without starting implementation.
          </p>}

          {clarification && <div className="mt-3">
            <TicketClarification clarification={clarification} answers={answers}
              onChange={(index, answer) => setAnswers((current) => current.map((value, i) => i === index ? answer : value))}
              onGenerate={() => void handleGenerateBreakdown()}
              onDiscard={() => { setClarification(null); setAnswers([]); setConfirmedAnswers([]); }}
              disabled={isLoading || saving || !activeTitle.trim()} />
          </div>}
          {plan && <section aria-label="Ticket breakdown plan" className="mt-3 space-y-2">
            <p className="text-xs text-amber-300">{plan.reason}</p>
            <textarea aria-label="Breakdown plan" value={plan.plan} rows={6} maxLength={20_000}
              onChange={(event) => setPlan({ ...plan, plan: event.target.value })}
              className="w-full rounded bg-slate-800 p-2 text-sm" />
            <button type="button" disabled={!plan.plan.trim()} onClick={() => void handleGenerateBreakdown(plan.plan)}>
              Generate tickets from plan
            </button>
          </section>}
          {impact && <details className="mt-3 text-xs"><summary>Code impact analysis</summary><MarkdownPreview source={impact} /></details>}
          {impact && !graphAvailable && <p className="mt-2 text-xs text-amber-300">
            Graphify was unavailable; verify the reported limitations.
          </p>}
          {proposedTasks.length > 0 && <p className="mt-3 text-xs text-slate-400">
            Drafts only until saved. Prerequisites are planning references preserved in descriptions, not execution gates.
          </p>}
          {proposedTasks.length > 0 && <div className="mt-3 space-y-1">
            <p className="text-xs text-slate-400">Checks for the selected tickets.</p>
            <TicketProposalQuality report={assessTicketBreakdown({
              summary, impactAnalysis: impact, openQuestions: questions,
              tasks: proposedTasks.filter((task) => task.selected),
            })} />
          </div>}
          {questions.length > 0 && <div className="mt-3 text-xs text-amber-300">
            <p>Open decisions — resolve these before processing tickets:</p>
            <ul>{questions.map((question, index) => <li key={index}>{question}</li>)}</ul>
          </div>}
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
                          {t.dependsOn.length > 0 && <p className="text-xs text-amber-300">Prerequisites: {t.dependsOn.join(', ')}</p>}
                          <p className="text-[11px] text-slate-400 line-clamp-2 leading-relaxed mb-2">
                            {t.description}
                          </p>
                          <details className="mb-2 text-xs">
                            <summary>Review specification and acceptance criteria</summary>
                            <MarkdownPreview source={t.description} />
                            <ul>{t.acceptanceCriteria.map((criterion, index) => <li key={index}>{criterion}</li>)}</ul>
                            <MarkdownPreview source={t.impactAnalysis} />
                          </details>

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
                          {mode === 'existing' ? currentFeature?.status : 'To Do'} • {t.estimatedStoryPoints} pts
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
        </fieldset>
        {isLoading && <button type="button" className="mt-3 text-xs underline" onClick={() => {
          active.current?.abort(); active.current = null; setIsLoading(false);
        }}>Cancel generation</button>}
      </div>
    </div>
  );
};
