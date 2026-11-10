import test from 'node:test';
import assert from 'node:assert/strict';
import { agentContextSchema } from '../../shared/types/agent';
import { TicketOrchestrator } from './ticketOrchestrator';
import type { AgentRequest } from './provider';

function request(provider: 'copilot' | 'claude-code', phase: AgentRequest['phase'] = 'execute'): AgentRequest {
  const now = new Date().toISOString();
  return {
    context: agentContextSchema.parse({ project: null, feature: null, task: {
      id: 'ticket', title: 'Ticket', description: '', status: 'In Progress', priority: 'Medium', tags: [],
      acceptanceCriteria: [], subtasks: [], order: 0, storyPoints: 1, createdAt: now, updatedAt: now, agentProvider: provider,
    } }),
    phase, plan: 'Approved', workspace: '/fixture', answers: [], onSession: async () => {}, ask: async () => 'Answer',
  };
}

test('ticket orchestrator routes every phase to the selected runtime, applying only its own default model', async () => {
  const calls: AgentRequest[] = [];
  const orchestrator = new TicketOrchestrator(['copilot', 'claude-code'].map((id) => ({
    id: id === 'copilot' ? 'copilot' : 'claude-code', name: id, defaultModel: `${id}-model`,
    provider: { id, run: async (input) => { calls.push(input); return id; } },
  })));
  for (const phase of ['plan', 'execute', 'review'] as const) {
    assert.equal(await orchestrator.run(request('claude-code', phase)), 'claude-code');
    assert.equal(calls.at(-1)?.resolvedModel, 'claude-code-model');
    assert.equal(calls.at(-1)?.context.task.agentModel, undefined);
  }
  const input = request('copilot');
  input.context.task.agentModel = 'ticket-model';
  await orchestrator.run(input);
  assert.equal(calls.at(-1)?.resolvedModel, 'ticket-model');
  assert.equal(calls.at(-1)?.context.task.agentModel, 'ticket-model');
  await orchestrator.run(request('copilot'));
  assert.equal(calls.at(-1)?.resolvedModel, 'copilot-model');
  assert.equal(calls.at(-1)?.context.task.agentModel, undefined);
});

test('unavailable and failed runtimes never fall back to another provider', async () => {
  let calls = 0;
  const orchestrator = new TicketOrchestrator([
    { id: 'copilot', name: 'Copilot', defaultModel: null, provider: { id: 'copilot', run: async () => { calls++; return 'ok'; } } },
    { id: 'claude-code', name: 'Claude', defaultModel: null, experimental: true, issue: 'Explicit experimental activation required.' },
  ]);
  await assert.rejects(orchestrator.run(request('claude-code')), /activation required/);
  assert.equal(calls, 0);
  const options = await orchestrator.options();
  assert.equal(options.providers[1].available, false);
  assert.equal(options.providers[1].experimental, true);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(orchestrator.run({ ...request('copilot'), signal: controller.signal }));
  assert.equal(calls, 0);
});

test('catalogue failures are explicit and isolated per runtime', async () => {
  const orchestrator = new TicketOrchestrator([
    { id: 'copilot', name: 'Copilot', defaultModel: null, provider: {
      id: 'copilot', run: async () => 'ok', models: async () => { throw new Error('Copilot login expired'); },
    } },
    { id: 'claude-code', name: 'Claude', defaultModel: null, provider: {
      id: 'claude-code', run: async () => 'ok', models: async () => [{ id: 'model', name: 'Model' }],
    } },
  ]);
  const options = await orchestrator.options();
  assert.equal(options.providers[0].issue, 'Copilot login expired');
  assert.equal(options.providers[0].available, false);
  assert.equal(options.providers[1].available, true);
});
