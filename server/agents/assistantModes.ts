import type { CustomAgentConfig, SessionConfig } from '@github/copilot-sdk';
import type { z } from 'zod';
import { assistantPlanSchema, type AssistantMode, type AssistantPlan } from '../../shared/types/assistantMode';
import { RepositoryError } from '../git/repositoryService';
import { BUNDLED_SKILLS_DIRECTORY } from './graphifySkill';

export const ASSISTANT_PLANNING_SKILL = 'assistant-planning';
export const AUTO_ASSISTANT_AGENT = 'kanban-auto-assistant';
export const PLAN_ASSISTANT_AGENT = 'kanban-plan-assistant';

export interface AssistantModeRequest {
  mode: AssistantMode;
  approvedPlan?: string;
}

export type AssistantOutput<T> = ({ kind: 'plan' } & AssistantPlan) | ({ kind: 'proposal' } & T);

/** Plan mode starts with the planner; an approved plan is always applied by the auto agent. */
export function assistantAgentName({ mode, approvedPlan }: AssistantModeRequest) {
  return mode === 'plan' && !approvedPlan ? PLAN_ASSISTANT_AGENT : AUTO_ASSISTANT_AGENT;
}

/** Copilot custom agents implementing the Auto and Plan modes; both preload the bundled assistant-planning skill. */
export function assistantModeConfiguration(request: AssistantModeRequest, subject: string, extraSkills: string[] = []) {
  const customAgents: CustomAgentConfig[] = [
    {
      name: AUTO_ASSISTANT_AGENT,
      displayName: 'Auto',
      description: `Writes the ${subject} directly and plans only when the request needs confirmation.`,
      infer: false,
      skills: [ASSISTANT_PLANNING_SKILL, ...extraSkills],
      prompt: [
        `AUTO MODE: you decide whether the ${subject} request needs a plan.`,
        `Follow the ${ASSISTANT_PLANNING_SKILL} skill: return the final proposal directly when the request is clear and bounded;`,
        'return a plan with its reason only when the skill criteria say confirmation is needed.',
        'When the request contains approvedPlan, apply that plan and return the final proposal; never return another plan.',
        ...(extraSkills.includes('ticket-framing') ? [
          'For ticket authoring only: when missing user decisions prevent a useful draft, return the structured clarification questions allowed by the host instead of a plan or proposal. Plan mode and approvedPlan take precedence.',
        ] : []),
      ].join('\n'),
    },
    {
      name: PLAN_ASSISTANT_AGENT,
      displayName: 'Plan',
      description: `Proposes a plan for the ${subject} and waits for the user to confirm it.`,
      infer: false,
      skills: [ASSISTANT_PLANNING_SKILL, ...extraSkills],
      prompt: [
        `PLAN MODE: the user asked to review a plan before any ${subject} is written.`,
        `Inspect the supplied context, then return ONLY a plan and its reason following the ${ASSISTANT_PLANNING_SKILL} skill.`,
        'Do not write the final proposal now, even for simple requests.',
      ].join('\n'),
    },
  ];
  return {
    customAgents,
    agent: assistantAgentName(request),
    enableSkills: true,
    enableConfigDiscovery: false,
    skillDirectories: [BUNDLED_SKILLS_DIRECTORY],
  } satisfies Partial<SessionConfig>;
}

export function assistantOutputInstruction(proposalFields: string, allowClarification = false) {
  return [
    'Return ONLY one JSON object, without code fences, in the shape required by the active mode agent:',
    '- a plan: {"kind": "plan", "plan": Markdown plan, "reason": one sentence explaining why confirmation is useful};',
    `- or the final proposal: {"kind": "proposal", ${proposalFields}}.`,
    ...(allowClarification ? [
      '- or, only in Auto mode without approvedPlan or previous answers, clarification: {"kind":"clarification","reason":string,"questions":[1 to 5 unique concise questions]}.',
    ] : []),
  ].join('\n');
}

/** Parses the agent JSON and enforces the requested mode: plan mode needs a plan, an approved plan needs a proposal. */
export function parseAssistantOutput<T, C = never>(
  raw: string | undefined, proposalSchema: z.ZodType<T>, request: AssistantModeRequest, subject: string,
  clarificationSchema?: z.ZodType<C>,
): AssistantOutput<T> | C {
  if (!raw?.trim()) throw new RepositoryError(502, `Copilot returned no ${subject}. Please retry.`);
  let parsed: unknown;
  try { parsed = JSON.parse(raw); }
  catch (error) {
    console.error(`Invalid ${subject} JSON response:`, error);
    throw new RepositoryError(502, `Copilot returned an invalid ${subject}. Please retry.`);
  }
  if (typeof parsed === 'object' && parsed !== null && 'kind' in parsed && parsed.kind === 'clarification') {
    if (!clarificationSchema || request.mode === 'plan' || request.approvedPlan) {
      throw new RepositoryError(502, 'Copilot returned clarification questions instead of the requested plan or proposal. Please retry.');
    }
    const clarification = clarificationSchema.safeParse(parsed);
    if (!clarification.success) throw new RepositoryError(502, 'Copilot returned invalid clarification questions. Please retry.');
    return clarification.data;
  }
  if (typeof parsed === 'object' && parsed !== null && 'kind' in parsed && parsed.kind === 'plan') {
    if (request.approvedPlan) throw new RepositoryError(502, 'Copilot returned another plan instead of applying the approved plan. Please retry.');
    const plan = assistantPlanSchema.safeParse(parsed);
    if (!plan.success) throw new RepositoryError(502, 'Copilot returned an invalid or oversized plan. Please retry.');
    return { kind: 'plan', ...plan.data };
  }
  if (request.mode === 'plan' && !request.approvedPlan) {
    throw new RepositoryError(502, 'Copilot returned a proposal instead of the requested plan. Please retry.');
  }
  const proposal = proposalSchema.safeParse(parsed);
  if (!proposal.success) throw new RepositoryError(502, `Copilot returned an invalid or oversized ${subject}. Please retry with a smaller scope.`);
  return { kind: 'proposal', ...proposal.data };
}
