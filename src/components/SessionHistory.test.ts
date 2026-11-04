import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { agentRuntimeSchema, type AgentRuntime, type AgentSession } from '../../shared/types/agent';
import { agentSession } from './stories/fixtures';
import SessionHistory from './SessionHistory';

function runtime(phase: AgentRuntime['phase'], status: AgentRuntime['status'] = 'completed') {
  return agentRuntimeSchema.parse({
    id: `${phase}-runtime`, phase, status, providerSessionId: `${phase}-provider`,
    startedAt: agentSession.createdAt, endedAt: status === 'running' ? null : agentSession.updatedAt,
    error: '', metadata: {},
    events: [
      { id: `${phase}-message`, type: 'assistant.message', timestamp: agentSession.createdAt, data: { messageId: 'm', content: `${phase} activity only` } },
      { id: `${phase}-tool`, type: 'tool.execution_start', timestamp: agentSession.createdAt, data: { toolCallId: 't', toolName: 'ticket_read_file', arguments: { path: `${phase}.ts` } } },
    ],
  });
}

function render(patch: Partial<AgentSession>) {
  return renderToStaticMarkup(createElement(SessionHistory, {
    taskId: agentSession.taskId, session: { ...agentSession, ...patch },
  }));
}

function step(html: string, label: string, nextLabel?: string) {
  const start = html.indexOf(`aria-label="${label} step"`);
  assert.notEqual(start, -1);
  const end = nextLabel ? html.indexOf(`aria-label="${nextLabel} step"`, start) : html.length;
  return html.slice(start, end);
}

test('shows live planning activity in Plan without leaking it into Execution', () => {
  const html = render({ status: 'planning', resumeStatus: 'planning', plan: '', output: '', runtimes: [runtime('plan', 'running')] });
  const plan = step(html, 'Plan', 'Approval');
  assert.match(plan, /Copilot planning activity feed/);
  assert.match(plan, /plan activity only/);
  assert.match(plan, /plan\.ts/);
  assert.match(plan, /Live ·/);
  assert.doesNotMatch(step(html, 'Execution', 'Review'), /plan activity only|Copilot planning activity feed/);
});

test('keeps each phase in its matching step and only marks the running phase live', () => {
  const html = render({
    status: 'completed', runtimes: [runtime('plan'), runtime('execute'), runtime('review', 'running')],
  });
  const plan = step(html, 'Plan', 'Approval');
  const execution = step(html, 'Execution', 'Review');
  const review = step(html, 'Review', 'Delivery');
  assert.match(plan, /plan activity only/);
  assert.doesNotMatch(plan, /execute activity only|review activity only|Live ·/);
  assert.match(execution, /execute activity only/);
  assert.doesNotMatch(execution, /plan activity only|review activity only|Live ·/);
  assert.match(review, /review activity only/);
  assert.match(review, /Copilot ai review activity feed/);
  assert.match(review, /Live ·/);
  assert.doesNotMatch(review, /plan activity only|execute activity only/);
});

test('waiting and failed planning runs retain activity without a live indicator', () => {
  for (const status of ['awaiting_input', 'failed', 'cancelled'] as const) {
    const html = render({
      status, resumeStatus: 'planning', output: '',
      runtimes: [runtime('plan', status === 'awaiting_input' ? 'running' : status)],
    });
    const plan = step(html, 'Plan', 'Approval');
    assert.match(plan, /plan activity only/);
    assert.doesNotMatch(plan, /Live ·/);
  }
});

test('legacy plans remain readable as Markdown previews without runtime events', () => {
  const html = render({ status: 'awaiting_approval', plan: '# Approved plan', output: '', runtimes: [] });
  const plan = step(html, 'Plan', 'Approval');
  assert.match(plan, /Preview implementation plan/);
  assert.match(plan, /Approved plan/);
  assert.doesNotMatch(plan, /Live ·/);
});
