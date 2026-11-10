import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { currentWorkflowModel } from './currentWorkflowModels';
import { workflowAgent, ticketWorkflowAgent } from './workflowRuntime';
import { ticketSession } from './ticketSession';
import { taskSchema } from '../../shared/types/board';
import type { AgentRequest } from './provider';
import { TicketOrchestrator } from './ticketOrchestrator';

test('workflow configuration resolves roles, linked prompts, variants and selected skill bodies without native loading', async () => {
  const document = await currentWorkflowModel('ticket-authoring');
  document.runtimeReference!.execution = 'host-runtime';
  const snapshot = { scope: 'ticket-authoring' as const, versionId: randomUUID(), document };
  document.agents[0].role = 'Use precise language.';
  document.prompts.find((item) => item.id === document.agents[0].promptId)!.template = 'Single ticket instructions.';
  document.prompts.find((item) => item.id === 'auto-breakdown-prompt')!.template = 'Breakdown instructions.';
  document.skills[0].instructions = 'Custom planning skill.';
  document.agents[0].model = 'workflow-model';
  const single = workflowAgent(snapshot, 'auto-agent')!;
  assert.match(single.instructions, /Use precise language/);
  assert.match(single.instructions, /Single ticket instructions/);
  assert.match(single.instructions, /Custom planning skill/);
  assert.doesNotMatch(single.instructions, /Breakdown instructions/);
  assert.equal(single.model, 'workflow-model');
  assert.match(workflowAgent(snapshot, 'auto-agent', true)!.instructions, /Breakdown instructions/);
  assert.equal(workflowAgent({ ...snapshot, versionId: null }, 'auto-agent'), undefined, 'Base preserves existing native behavior');
  assert.throws(() => workflowAgent(snapshot, 'missing-agent'), /missing agent/);
});

test('ticket execution applies the pinned phase configuration but cannot expand tools or bypass host documentation gates', async () => {
  const document = await currentWorkflowModel('ticket-processing');
  document.runtimeReference!.execution = 'host-runtime';
  const snapshot = { scope: 'ticket-processing' as const, versionId: randomUUID(), document };
  document.prompts.find((item) => item.id === 'executor-prompt')!.template = 'Adaptive custom instruction.';
  document.prompts.find((item) => item.id === 'approved-execution-prompt')!.template = 'Approved custom instruction.';
  document.agents.find((item) => item.id === 'executor')!.model = 'workflow-model';
  const request: AgentRequest = {
    context: { task: taskSchema.parse({ id: 'test', title: 'Workflow test', status: 'In Progress', priority: 'Medium',
      description: '', order: 0, storyPoints: 1, tags: [], acceptanceCriteria: [], subtasks: [],
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }), project: null, feature: null, workflow: snapshot },
    workspace: '/tmp', phase: 'execute', adaptive: true, requestPlanApproval: async () => {},
    plan: '', ask: async () => 'Answer', answers: [], onSession: async () => {},
  };
  const adaptive = ticketSession(request, undefined, () => {});
  assert.match(adaptive.instructions.join('\n'), /Adaptive custom instruction/);
  assert.match(adaptive.instructions.join('\n'), /Required ticket documentation:/);
  assert.ok(adaptive.tools.some((tool) => tool.name === 'ticket_request_plan_approval'));
  const approved = ticketSession({ ...request, adaptive: false }, undefined, () => {});
  assert.match(approved.instructions.join('\n'), /Approved custom instruction/);
  assert.ok(!approved.tools.some((tool) => tool.name === 'ticket_request_plan_approval'));
  const review = ticketSession({ ...request, phase: 'review' }, undefined, () => {});
  assert.ok(review.tools.every((tool) => !['ticket_write_file', 'ticket_run_checks', 'ticket_ask_user'].includes(tool.name)));
  assert.equal(ticketWorkflowAgent(request)?.model, 'workflow-model');
  let actualModel: string | undefined;
  const orchestrator = new TicketOrchestrator([{ id: 'copilot', name: 'Copilot', defaultModel: 'server-model',
    provider: { id: 'copilot', run: async (actual) => { actualModel = actual.resolvedModel; return 'done'; } } }]);
  await orchestrator.run(request);
  assert.equal(actualModel, 'workflow-model');
  await orchestrator.run({ ...request, context: { ...request.context, task: { ...request.context.task, agentModel: 'ticket-model' } } });
  assert.equal(actualModel, 'ticket-model', 'Explicit ticket model takes precedence');
});
