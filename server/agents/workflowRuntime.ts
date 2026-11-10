import type { WorkflowRuntimeSnapshot } from '../../shared/types/workflowEditor';
import type { AgentRequest } from './provider';
import { RepositoryError } from '../git/repositoryService';
import { GRAPHIFY_SKILL_INSTRUCTION } from './graphifySkill';

export function workflowAgent(snapshot: WorkflowRuntimeSnapshot | undefined, agentId: string, variant = false) {
  if (!snapshot || (!snapshot.versionId && !snapshot.document.execution)) return undefined;
  const { document } = snapshot;
  const agent = document.agents.find((item) => item.id === agentId);
  if (!agent) throw new RepositoryError(409, `Active workflow is missing agent ${agentId}. Restore the built-in base.`);
  const promptId = variant ? agent.promptVariants?.[0]?.promptId : agent.promptId;
  const prompt = document.prompts.find((item) => item.id === promptId);
  if (!prompt) throw new RepositoryError(409, `Active workflow is missing the prompt for ${agentId}.`);
  const skills = agent.skillIds.map((id) => {
    const skill = document.skills.find((item) => item.id === id);
    if (!skill) throw new RepositoryError(409, `Active workflow is missing skill ${id}.`);
    return `## Skill: ${skill.name}\n${skill.instructions}`;
  });
  return {
    model: agent.model || undefined,
    instructions: [
      'Activated workflow configuration. Host permissions, output contracts and lifecycle gates remain mandatory.',
      `Role: ${agent.role}`, prompt.template.replaceAll(GRAPHIFY_SKILL_INSTRUCTION, 'The Graphify skill is injected below; use the available graph tools directly.'),
      'The selected workflow skills are injected below. Do not load native skills or other skill files.',
      ...skills,
    ].join('\n\n'),
  };
}

export function ticketWorkflowAgent(request: Pick<AgentRequest, 'context' | 'phase' | 'adaptive' | 'workflowStep'>) {
  if (request.workflowStep && request.context.workflow) return workflowNodeAgent(request.context.workflow, request.workflowStep.nodeId);
  if (request.context.workflow?.document.execution) return undefined;
  const id = request.phase === 'plan' ? 'planner' : request.phase === 'review' ? 'reviewer' : 'executor';
  return workflowAgent(request.context.workflow, id, request.phase === 'execute' && !request.adaptive);
}

export function workflowNodeAgent(snapshot: WorkflowRuntimeSnapshot, nodeId: string) {
  const node = snapshot.document.nodes.find((item) => item.id === nodeId);
  if (!node || node.kind !== 'agent') throw new RepositoryError(422, `Workflow step ${nodeId} is not an agent.`);
  return workflowAgent(snapshot, node.referenceId)!;
}
