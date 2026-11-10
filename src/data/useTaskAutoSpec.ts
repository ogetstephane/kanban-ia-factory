import { useEffect, useRef, useState } from 'react';
import type { Subtask } from '../../shared/types/kanban';
import type { AssistantMode, AssistantPlan } from '../../shared/types/assistantMode';
import type { TaskDraftInput, TaskDraftSpecification } from '../../shared/types/taskDraft';
import { boardApi } from './boardApi';
import { assessTicketProposal, type TicketProposalQuality } from '../../shared/utils/ticketProposalQuality';
import {
  clarificationContext, ticketClarificationAnswersSchema,
  type TicketClarification, type TicketClarificationAnswer,
} from '../../shared/types/ticketClarification';

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
  if (data.description) fields.setDescription([
    data.description,
    ...(data.openQuestions?.length ? [
      `## Open decisions\n\n${data.openQuestions.map((question) => `- ${question}`).join('\n')}`,
    ] : []),
  ].join('\n\n'));
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

export type TaskSpecRequest = Omit<TaskDraftInput, 'mode' | 'approvedPlan' | 'clarificationAnswers'>;

/**
 * Copilot Auto-Spec of a task form: one cancellable generation at a time, applied to the form when it succeeds.
 * In Auto mode Copilot writes the specification directly unless it judges a plan necessary; in Plan mode it
 * always returns an editable plan first, and the specification is generated from the plan the user approves.
 */
export function useTaskAutoSpec(fields: TaskSpecFields) {
  const [generating, setGenerating] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [impactAnalysis, setImpactAnalysis] = useState('');
  const [quality, setQuality] = useState<TicketProposalQuality | null>(null);
  const [mode, setMode] = useState<AssistantMode>('auto');
  const [plan, setPlan] = useState<AssistantPlan | null>(null);
  const [clarification, setClarification] = useState<TicketClarification | null>(null);
  const [answers, setAnswers] = useState<string[]>([]);
  const [confirmedAnswers, setConfirmedAnswers] = useState<TicketClarificationAnswer[]>([]);
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
    setQuality(null);
    const controller = new AbortController();
    activeGeneration.current = controller;

    try {
      const submittedAnswers = clarification
        ? ticketClarificationAnswersSchema.parse(clarification.questions.map((question, index) => ({ question, answer: answers[index] ?? '' })))
        : confirmedAnswers;
      const data = await boardApi.assistTask(projectId, {
        ...input, mode, ...(approvedPlan?.trim() ? { approvedPlan: approvedPlan.trim() } : {}),
        ...(submittedAnswers.length ? { clarificationAnswers: submittedAnswers } : {}),
      }, controller.signal);
      if (controller.signal.aborted) return;

      if (data.kind === 'clarification') {
        setPlan(null);
        setClarification(data);
        setAnswers(data.questions.map(() => ''));
        return;
      }
      setConfirmedAnswers(submittedAnswers);
      setClarification(null);
      setAnswers([]);
      if (data.kind === 'plan') {
        setPlan({ plan: data.plan, reason: data.reason });
        setFeedback(mode === 'plan'
          ? 'Copilot prepared a plan. Review or edit it, then generate the specification from it.'
          : 'Copilot judged that this ticket needs a plan first. Review or edit it, then generate the specification from it.');
        return;
      }
      setPlan(null);
      applyTaskSpec({
        ...data, description: [data.description, clarificationContext(submittedAnswers)].filter(Boolean).join('\n\n'),
      }, fields);
      setImpactAnalysis(data.impactAnalysis);
      setQuality(assessTicketProposal(data));
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
    setQuality(null);
    setFeedback(null);
    setPlan(null);
    discardClarification();
  };

  const discardClarification = () => {
    setClarification(null);
    setAnswers([]);
    setConfirmedAnswers([]);
  };

  return {
    generating, feedback, impactAnalysis, quality, mode, plan, generate, cancel, reset, setMode,
    clarification, answers, discardClarification,
    editAnswer: (index: number, answer: string) => setAnswers((current) => current.map((value, i) => i === index ? answer : value)),
    editPlan: (text: string) => setPlan((current) => current && { ...current, plan: text }),
    discardPlan: () => setPlan(null),
    dismissFeedback: () => setFeedback(null),
  };
}

export type TaskAutoSpec = ReturnType<typeof useTaskAutoSpec>;
