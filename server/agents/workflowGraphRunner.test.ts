import test from 'node:test';
import assert from 'node:assert/strict';
import { builtInWorkflow } from './currentWorkflowModels';
import { runWorkflowGraph } from './workflowGraphRunner';
import { workflowDocumentSchema, type WorkflowRuntimeSnapshot } from '../../shared/types/workflowEditor';
import { workflowGraphErrors } from '../../shared/utils/workflowGraph';
import { TicketOrchestrator } from './ticketOrchestrator';
import { taskSchema } from '../../shared/types/board';
import { ticketSession } from './ticketSession';
import type { AgentRequest } from './provider';

async function snapshot(scope: WorkflowRuntimeSnapshot['scope'] = 'ticket-authoring'): Promise<WorkflowRuntimeSnapshot> {
  return { scope, versionId: null, document: await builtInWorkflow(scope) };
}

test('prebuilt graph executes selected skill steps even without a custom active version', async () => {
  const workflow = await snapshot();
  const calls: { id: string; inputs: Record<string, string> }[] = [];
  assert.equal(await runWorkflowGraph(workflow, 'author', async (node, inputs) => {
    calls.push({ id: node.id, inputs }); return node.id;
  }), 'quality');
  assert.deepEqual(calls.map((call) => call.id), ['framing', 'impact', 'writer', 'quality']);
  assert.deepEqual(calls[2].inputs, { impact: 'impact' });
  calls.length = 0;
  await runWorkflowGraph(workflow, 'plan', async (node, inputs) => {
    calls.push({ id: node.id, inputs }); return node.id;
  });
  assert.deepEqual(calls, [{ id: 'plan-agent', inputs: {} }]);
});

test('adding, removing and reconnecting nodes changes calls and joined data rather than hardcoded agent IDs', async () => {
  const workflow = await snapshot();
  const doc = workflow.document;
  const extra = { ...structuredClone(doc.nodes[1]), id: 'custom-analysis', label: 'Custom analysis' };
  doc.nodes.push(extra);
  doc.nodes = doc.nodes.filter((node) => node.id !== 'writer');
  doc.edges = [
    { from: 'framing', to: 'impact' }, { from: 'framing', to: extra.id },
    { from: 'impact', to: 'quality' }, { from: extra.id, to: 'quality' }, { from: 'quality', to: 'plan-agent' },
  ];
  assert.ok(workflowDocumentSchema.safeParse(doc).success);
  const calls: string[] = [];
  await runWorkflowGraph(workflow, 'author', async (node, inputs) => {
    calls.push(node.id);
    if (node.id === 'quality') assert.deepEqual(inputs, { impact: 'impact', 'custom-analysis': 'custom-analysis' });
    return node.id;
  });
  assert.deepEqual(calls, ['framing', 'impact', 'custom-analysis', 'quality']);
});

test('skipped lifecycle nodes forward nearest executed predecessor outputs', async () => {
  const workflow = await snapshot('ticket-processing');
  const calls: string[] = [];
  await runWorkflowGraph(workflow, 'review', async (node, inputs) => {
    calls.push(node.id);
    if (node.id === 'reviewer') assert.deepEqual(inputs, { impact: 'verified impact' });
    return 'verified impact';
  });
  assert.deepEqual(calls, ['impact', 'reviewer']);
});

test('failures, cancellation, empty output and oversized output stop downstream calls explicitly', async () => {
  for (const mode of ['failure', 'cancel', 'empty', 'size'] as const) {
    const workflow = await snapshot();
    const controller = new AbortController();
    let count = 0;
    await assert.rejects(runWorkflowGraph(workflow, 'author', async () => {
      count++;
      if (mode === 'failure') throw new Error('Failure fixture');
      if (mode === 'cancel') controller.abort(new Error('Cancelled fixture'));
      return mode === 'empty' ? '' : mode === 'size' ? 'x'.repeat(256_001) : 'context';
    }, controller.signal), mode === 'failure' ? /Failure fixture/ : mode === 'cancel' ? /Cancelled fixture/ : mode === 'empty' ? /no result/ : /context budget/);
    assert.equal(count, 1);
  }
  assert.equal((await runWorkflowGraph(await snapshot(), 'author', async () => 'x'.repeat(250_000))).length, 250_000,
    'The exact one-million-byte aggregate limit is accepted');
  await assert.rejects(runWorkflowGraph(await snapshot(), 'author', async () => 'x'.repeat(250_001)), /context budget/,
    'Aggregate limits are enforced even when every individual result fits');
});

test('human plan and clarification responses return to the host without running downstream agents', async () => {
  for (const kind of ['plan', 'clarification']) {
    let count = 0;
    const output = JSON.stringify({ kind, summary: 'Needs user input' });
    assert.equal(await runWorkflowGraph(await snapshot(), 'author', async () => { count++; return output; }), output);
    assert.equal(count, 1);
  }
});

test('activation validation rejects disconnected results, multiple writers and unsafe release ordering', async () => {
  const workflow = await snapshot();
  workflow.document.edges = workflow.document.edges.filter((edge) => edge.to !== 'quality');
  assert.match(workflowGraphErrors(workflow.document, workflow.scope).join(' '), /feed the result/);
  const processing = await snapshot('ticket-processing');
  processing.document.nodes[0].run!.access = 'phase';
  assert.match(workflowGraphErrors(processing.document, processing.scope).join(' '), /must be read-only/);
  const releases = await snapshot('releases');
  releases.document.edges = [{ from: 'push-tag', to: 'create-tag' }, { from: 'create-tag', to: 'record-publication' }];
  assert.match(workflowGraphErrors(releases.document, releases.scope).join(' '), /Release operations must connect/);
  releases.document.nodes[0].run!.access = 'phase';
  assert.match(workflowGraphErrors(releases.document, releases.scope).join(' '), /registered permission policy/);
});

test('production ticket dispatch runs editable nodes with inherited runtime, per-step models and read-only intermediate tools', async () => {
  const workflow = await snapshot('ticket-processing');
  workflow.document.agents[0].model = 'analysis-model';
  workflow.document.agents.find((agent) => agent.id === 'executor')!.model = 'implementation-model';
  const calls: AgentRequest[] = [];
  const orchestrator = new TicketOrchestrator([{ id: 'copilot', name: 'Copilot', defaultModel: 'server-model',
    provider: { id: 'copilot', run: async (request) => { calls.push(request); return request.workflowStep!.nodeId; } } }]);
  const request: AgentRequest = {
    context: { task: taskSchema.parse({ id: 'graph-test', title: 'Graph test', status: 'In Progress', priority: 'Medium',
      description: '', order: 0, storyPoints: 1, tags: [], acceptanceCriteria: [], subtasks: [],
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }), project: null, feature: null, workflow },
    workspace: '/tmp', phase: 'execute', adaptive: true, requestPlanApproval: async () => {},
    plan: '', ask: async () => 'Answer', answers: [], onSession: async () => {}, onContent: async () => {},
  };
  assert.equal(await orchestrator.run(request), 'executor');
  assert.deepEqual(calls.map((call) => call.workflowStep!.nodeId), ['impact', 'executor']);
  assert.deepEqual(calls.map((call) => call.resolvedModel), ['analysis-model', 'implementation-model']);
  assert.equal(calls[0].onContent, undefined);
  assert.equal(calls[0].requestPlanApproval, undefined);
  assert.equal(calls[1].requestPlanApproval, request.requestPlanApproval);
  assert.deepEqual(calls[1].workflowStep!.inputs, { impact: 'impact' });
  assert.ok(!ticketSession(calls[0], undefined, () => {}).tools.some((tool) => tool.name === 'ticket_write_file'));
  assert.ok(ticketSession(calls[1], undefined, () => {}).tools.some((tool) => tool.name === 'ticket_write_file'));
});
