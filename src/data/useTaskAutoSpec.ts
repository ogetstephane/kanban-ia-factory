import { useEffect, useRef, useState } from 'react';
import type { Subtask } from '../../shared/types/kanban';
import type { AssistantMode, AssistantPlan } from '../../shared/types/assistantMode';
import type { TaskDraftInput, TaskDraftSpecification } from '../../shared/types/taskDraft';
import { boardApi } from './boardApi';

/** Setters of the task form fields that a generated specification fills in. */
export interface TaskSpecFields {
  setDescription: (description: string) => void;
  setAcceptanceCriteria: (criteria: string[]) => void;
  setSubtasks: (subtasks: Subtask[]) => void;
  setSuggestedWorkflow: (workflow: string) => void;
  setStoryPoints: (points: number) => void;
  setTagsInput: (tags: string) => void;
}

/** Copies a generated specification into the form; fields the proposal leaves empty keep what the user typed. */
export function applyTaskSpec(data: TaskDraftSpecification, fields: TaskSpecFields) {
  if (data.description) fields.setDescription(data.description);
  if (Array.isArray(data.acceptanceCriteria) && data.acceptanceCriteria.length > 0) {
    fields.setAcceptanceCriteria(data.acceptanceCriteria);
  }
  if (Array.isArray(data.subtasks) && data.subtasks.length > 0) {
    fields.setSubtasks(
      data.subtasks.map((text: string, i: number) => ({
        id: `copilot-st-${Date.now()}-${i}`,
        text,
        completed: false,
      }))
    );
  }
  if (data.suggestedWorkflow) fields.setSuggestedWorkflow(data.suggestedWorkflow);
  if (data.estimatedStoryPoints) fields.setStoryPoints(data.estimatedStoryPoints);
  if (Array.isArray(data.suggestedTags) && data.suggestedTags.length > 0) {
    fields.setTagsInput(data.suggestedTags.join(', '));
  }
}

export type TaskSpecRequest = Omit<TaskDraftInput, 'mode' | 'approvedPlan'>;

/**
 * Copilot Auto-Spec of a task form: one cancellable generation at a time, applied to the form when it succeeds.
 * In Auto mode Copilot writes the specification directly unless it judges a plan necessary; in Plan mode it
 * always returns an editable plan first, and the specification is generated from the plan the user approves.
 */
export function useTaskAutoSpec(fields: TaskSpecFields) {
  const [generating, setGenerating] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [impactAnalysis, setImpactAnalysis] = useState('');
  const [mode, setMode] = useState<AssistantMode>('auto');
  const [plan, setPlan] = useState<AssistantPlan | null>(null);
  const activeGeneration = useRef<AbortController | null>(null);

  useEffect(() => () => {
    activeGeneration.current?.abort();
    activeGeneration.current = null;
  }, []);

  const cancel = () => {
    activeGeneration.current?.abort();
    activeGeneration.current = null;
    setGenerating(false);
  };

  const generate = async (projectId: string, input: TaskSpecRequest, approvedPlan?: string) => {
    if (activeGeneration.current) return;
    if (!input.title.trim()) {
      setFeedback('Please enter at least a Task Title for Copilot to enhance.');
      return;
    }
    setGenerating(true);
    setFeedback(null);
    setImpactAnalysis('');
    const controller = new AbortController();
    activeGeneration.current = controller;

    try {
      const data = await boardApi.assistTask(projectId, {
        ...input, mode, ...(approvedPlan?.trim() ? { approvedPlan: approvedPlan.trim() } : {}),
      }, controller.signal);
      if (controller.signal.aborted) return;

      if (data.kind === 'plan') {
        setPlan({ plan: data.plan, reason: data.reason });
        setFeedback(mode === 'plan'
          ? 'Copilot prepared a plan. Review or edit it, then generate the specification from it.'
          : 'Copilot judged that this ticket needs a plan first. Review or edit it, then generate the specification from it.');
        return;
      }
      setPlan(null);
      applyTaskSpec(data, fields);
      setImpactAnalysis(data.impactAnalysis);
      setFeedback(data.graphAvailable
        ? 'Copilot generated the specification. Review the code impact analysis before saving.'
        : 'Copilot generated the specification without Graphify. Review the impact analysis for limitations before saving.');
    } catch (err) {
      if (!controller.signal.aborted) {
        console.error('Task specification generation failed:', err);
        setFeedback(`Notice: ${err instanceof Error ? err.message : 'Error communicating with AI Copilot'}`);
      }
    } finally {
      if (activeGeneration.current === controller) {
        activeGeneration.current = null;
        setGenerating(false);
      }
    }
  };

  /** Cancels any generation and forgets its outcome, e.g. when the form switches to another task. */
  const reset = () => {
    cancel();
    setImpactAnalysis('');
    setFeedback(null);
    setPlan(null);
  };

  return {
    generating, feedback, impactAnalysis, mode, plan, generate, cancel, reset, setMode,
    editPlan: (text: string) => setPlan((current) => current && { ...current, plan: text }),
    discardPlan: () => setPlan(null),
    dismissFeedback: () => setFeedback(null),
  };
}

export type TaskAutoSpec = ReturnType<typeof useTaskAutoSpec>;
