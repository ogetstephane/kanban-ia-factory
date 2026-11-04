import test from 'node:test';
import assert from 'node:assert/strict';
import { agentContextSchema, type AgentRuntime } from '../../shared/types/agent';
import type { AgentRequest } from './provider';
import { RuntimeTelemetry } from './runtimeTelemetry';

function request(onRuntime: NonNullable<AgentRequest['onRuntime']>, signal?: AbortSignal): AgentRequest {
  return {
    context: agentContextSchema.parse({
      task: { id: 'runtime-ticket', title: 'Telemetry', description: '', status: 'In Progress', priority: 'Medium',
        tags: [], acceptanceCriteria: [], subtasks: [], order: 0, storyPoints: 1,
        createdAt: '2026-11-03T10:00:00Z', updatedAt: '2026-11-03T10:00:00Z' },
      project: null, feature: null,
    }),
    workspace: '/fixture', phase: 'plan', plan: '', answers: [],
    onSession: async () => undefined, ask: async () => 'answer', onRuntime, signal,
  };
}

test('runtime telemetry persists metadata and every event, including ephemeral and subagent data, and drains on finish', async () => {
  const writes: AgentRuntime[] = [];
  const telemetry = new RuntimeTelemetry(request(async (runtime) => { writes.push(runtime); }));
  await telemetry.update({ configuration: { systemMessage: 'instructions', tools: ['read'], omitted: undefined } });
  const event = { id: 'early', type: 'session.start', timestamp: '2026-11-03T10:00:00Z', data: { futureField: { nested: true } } };
  telemetry.event(event);
  telemetry.event(event);
  telemetry.event({ ...event, id: 'usage', type: 'assistant.usage', ephemeral: true, agentId: 'child', data: { inputTokens: 50, cost: 0.25, model: 'fixture' } });
  await telemetry.update({ message: { prompt: 'full prompt', attachments: [{ data: 'binary', mimeType: 'application/pdf' }] } }, 'provider-id');
  await telemetry.finish();
  const final = writes.at(-1)!;
  assert.equal(final.status, 'completed');
  assert.equal(final.providerSessionId, 'provider-id');
  assert.ok(final.endedAt);
  assert.equal(final.events.length, 2);
  assert.equal(final.events[1].agentId, 'child');
  assert.equal(final.events[1].ephemeral, true);
  assert.deepEqual(final.events[0].data.futureField, { nested: true });
  assert.deepEqual(final.metadata.configuration, { systemMessage: 'instructions', tools: ['read'] });
  assert.equal(writes[0].events.length, 0, 'previous snapshots must not mutate');
});

test('failed and cancelled runtimes retain their partial events and errors', async () => {
  for (const cancelled of [false, true]) {
    const controller = new AbortController();
    const writes: AgentRuntime[] = [];
    const telemetry = new RuntimeTelemetry(request(async (runtime) => { writes.push(runtime); }, controller.signal));
    await telemetry.update({});
    telemetry.event({ id: 'partial', type: 'assistant.message_delta', timestamp: 'now', data: { deltaContent: 'partial' } });
    if (cancelled) controller.abort();
    await telemetry.finish(new Error('Interrupted'));
    assert.equal(writes.at(-1)?.status, cancelled ? 'cancelled' : 'failed');
    assert.equal(writes.at(-1)?.error, 'Interrupted');
    assert.equal(writes.at(-1)?.events.length, 1);
  }
});

test('telemetry persistence failures are surfaced to the caller', async () => {
  const telemetry = new RuntimeTelemetry(request(async () => { throw new Error('Storage unavailable'); }));
  await assert.rejects(telemetry.update({}), /Storage unavailable/);
  await assert.rejects(telemetry.finish(new Error('Stopped')), /Storage unavailable/);
});

test('malformed provider events are ignored without interrupting the run', async () => {
  const writes: AgentRuntime[] = [];
  const telemetry = new RuntimeTelemetry(request(async (runtime) => { writes.push(runtime); }));
  assert.doesNotThrow(() => telemetry.event({ type: 'missing.id' }));
  assert.doesNotThrow(() => telemetry.event(undefined));
  telemetry.event({ id: 'valid', type: 'session.idle', timestamp: 'now', data: {} });
  await telemetry.finish();
  assert.deepEqual(writes.at(-1)?.events.map((event) => event.id), ['valid']);
});
