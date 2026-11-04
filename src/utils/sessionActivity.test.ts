import test from 'node:test';
import assert from 'node:assert/strict';
import { agentRuntimeSchema, type AgentRuntime } from '../../shared/types/agent';
import { sessionActivity, showActivityReport, toolArgumentSummary, toolLabel } from './sessionActivity';

type Event = AgentRuntime['events'][number];

function event(id: string, type: string, data: Event['data'], agentId?: string): Event {
  return { id, type, timestamp: '2026-11-04T10:00:00Z', data, ...(agentId ? { agentId } : {}) };
}

function runtime(events: Event[], patch: Partial<AgentRuntime> = {}): AgentRuntime {
  return agentRuntimeSchema.parse({
    id: 'runtime', phase: 'execute', providerSessionId: 'provider', status: 'running',
    startedAt: '2026-11-04T10:00:00Z', endedAt: null, error: '', metadata: {}, events, ...patch,
  });
}

test('combines streaming text with authoritative messages and preserves tool order', () => {
  const events = [
    event('r1', 'assistant.reasoning_delta', { reasoningId: 'reason', deltaContent: 'Inspect ' }),
    event('r2', 'assistant.reasoning_delta', { reasoningId: 'reason', deltaContent: 'the code' }),
    event('r3', 'assistant.reasoning', { reasoningId: 'reason', content: 'Inspect the code carefully.' }),
    event('m1', 'assistant.message_delta', { messageId: 'message', deltaContent: 'Reading ' }),
    event('m2', 'assistant.message_delta', { messageId: 'message', deltaContent: 'files' }),
    event('m3', 'assistant.message', { messageId: 'message', content: 'Reading files.' }),
    event('start', 'tool.execution_start', { toolCallId: 'call', toolName: 'ticket_read_file', arguments: { path: 'src/app.ts' } }),
    event('progress', 'tool.execution_progress', { toolCallId: 'call', progressMessage: 'Reading' }),
    event('partial', 'tool.execution_partial_result', { toolCallId: 'call', partialOutput: 'older output' }),
    event('shell1', 'tool.shell_output', { toolCallId: 'call', text: 'first ' }),
    event('shell2', 'tool.shell_output', { toolCallId: 'call', text: 'second' }),
    event('complete', 'tool.execution_complete', { toolCallId: 'call', success: true, result: { content: 'file contents' } }),
    event('final', 'assistant.message', { messageId: 'final', content: 'Done.' }),
    event('ignored', 'assistant.streaming_delta', { totalResponseSizeBytes: 123 }),
  ];
  const items = sessionActivity([runtime(events)], 'execute');
  assert.deepEqual(items.map((item) => item.kind), ['reasoning', 'message', 'tool', 'message']);
  assert.equal(items[0].kind === 'reasoning' && items[0].text, 'Inspect the code carefully.');
  assert.equal(items[1].kind === 'message' && items[1].text, 'Reading files.');
  assert.equal(items[1].kind === 'message' && items[1].complete, true);
  const tool = items[2];
  assert.equal(tool.kind, 'tool');
  if (tool.kind !== 'tool') throw new Error('Expected tool activity');
  assert.equal(tool.status, 'completed');
  assert.equal(tool.progress, 'Reading');
  assert.equal(tool.partialOutput, 'older output');
  assert.equal(tool.shellOutput, 'first second');
  assert.deepEqual(tool.result, { content: 'file contents' });
  assert.equal(toolLabel(tool), 'Read file');
  assert.equal(toolArgumentSummary(tool.arguments), 'src/app.ts');
  assert.equal(showActivityReport(items, 'Done.', false), false);
  assert.equal(showActivityReport(items, 'Reading files.\n\nDone.', false), false);
  assert.equal(showActivityReport(items, 'A separate report', false), true);
  assert.equal(showActivityReport(items, 'A partial report', true), false);
  assert.equal(showActivityReport([], 'Legacy report', false), true);
});

test('separates subagent and runtime IDs and retains incomplete or failed calls accurately', () => {
  const partial = [
    event('root-message', 'assistant.message_delta', { messageId: 'same', deltaContent: 'Root' }),
    event('child-message', 'assistant.message_delta', { messageId: 'same', deltaContent: 'Child' }, 'child'),
    event('root-tool', 'tool.execution_start', { toolCallId: 'same', toolName: 'ticket_write_file', arguments: { path: 'src/a.ts', content: 'large source' } }),
    event('child-tool', 'tool.execution_start', { toolCallId: 'same', toolName: 'ticket_search_files', arguments: { path: 'src', query: 'hello' } }, 'child'),
    event('child-fail', 'tool.execution_complete', { toolCallId: 'same', success: false, error: { message: 'Search failed' } }, 'child'),
  ];
  const live = sessionActivity([runtime(partial)], 'execute');
  assert.deepEqual(live.map((item) => item.kind), ['message', 'message', 'tool', 'tool']);
  assert.equal(live[0].kind === 'message' && live[0].text, 'Root');
  assert.equal(live[1].kind === 'message' && live[1].text, 'Child');
  assert.equal(live[2].kind === 'tool' && live[2].status, 'running');
  assert.equal(live[3].kind === 'tool' && live[3].status, 'failed');
  assert.equal(live[3].kind === 'tool' && live[3].error, 'Search failed');
  assert.equal(live[2].kind === 'tool' && toolArgumentSummary(live[2].arguments), 'src/a.ts');
  assert.equal(live[3].kind === 'tool' && toolArgumentSummary(live[3].arguments), 'src · hello');

  const stopped = sessionActivity([
    runtime(partial, { status: 'cancelled' }),
    runtime([event('again', 'assistant.message', { messageId: 'same', content: 'Another runtime' })], { id: 'another' }),
    runtime([event('plan', 'assistant.message', { messageId: 'plan', content: 'Plan only' })], { id: 'planning', phase: 'plan' }),
  ], 'execute');
  assert.equal(stopped[2].kind === 'tool' && stopped[2].status, 'unrecorded');
  assert.equal(stopped.length, 5);
  assert.notEqual(stopped[0].key, stopped[4].key);
  assert.equal(stopped[0].key, live[0].key);
});

test('shows intents, skills, subagent lifecycle and provider notices without inventing details', () => {
  const items = sessionActivity([runtime([
    event('intent', 'assistant.intent', { intent: 'Locating relevant files' }),
    event('skill', 'skill.invoked', { name: 'ticket-graphify' }),
    event('agent-start', 'subagent.started', { toolCallId: 'agent', agentDisplayName: 'Explorer', agentDescription: 'Inspect code' }),
    event('agent-end', 'subagent.failed', { toolCallId: 'agent', error: 'Agent stopped' }),
    event('warning', 'session.warning', { message: 'Context limit approaching' }),
    event('error', 'session.error', { message: 'Provider error' }),
    event('empty', 'assistant.message', { messageId: 'empty', content: '' }),
    event('usage', 'assistant.usage', { inputTokens: 10 }),
  ], { status: 'failed' })], 'execute');
  assert.deepEqual(items.map((item) => item.kind), ['intent', 'skill', 'subagent', 'notice', 'notice']);
  assert.equal(items[0].kind === 'intent' && items[0].text, 'Locating relevant files');
  assert.equal(items[2].kind === 'subagent' && items[2].status, 'failed');
  assert.equal(items[2].kind === 'subagent' && items[2].error, 'Agent stopped');
  assert.equal(items[3].kind === 'notice' && items[3].level, 'warning');
  assert.equal(items[4].kind === 'notice' && items[4].level, 'error');
});

test('keeps planning, execution and review activity scoped to their own phase', () => {
  const runtimes = (['plan', 'execute', 'review'] as const).map((phase) =>
    runtime([
      event('message', 'assistant.message', { messageId: 'message', content: `${phase} content` }),
      event('tool', 'tool.execution_start', { toolCallId: 'call', toolName: 'ticket_read_file', arguments: { path: `${phase}.ts` } }),
    ], { id: phase, phase }));
  for (const phase of ['plan', 'execute', 'review'] as const) {
    const items = sessionActivity(runtimes, phase);
    assert.equal(items.length, 2);
    assert.equal(items[0].kind === 'message' && items[0].text, `${phase} content`);
    assert.equal(items[1].kind === 'tool' && toolArgumentSummary(items[1].arguments), `${phase}.ts`);
  }
});
