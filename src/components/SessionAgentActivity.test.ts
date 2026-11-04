import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { agentRuntimeSchema } from '../../shared/types/agent';
import SessionAgentActivity from './SessionAgentActivity';

const runtime = agentRuntimeSchema.parse({
  id: 'runtime', phase: 'execute', providerSessionId: 'provider', status: 'running',
  startedAt: '2026-11-04T10:00:00Z', endedAt: null, error: '', metadata: {},
  events: [
    { id: 'reason', type: 'assistant.reasoning', timestamp: 'now', data: { reasoningId: 'r', content: 'Detailed thinking' } },
    { id: 'message', type: 'assistant.message_delta', timestamp: 'now', data: { messageId: 'm', deltaContent: 'Inspecting files.' } },
    { id: 'start', type: 'tool.execution_start', timestamp: 'now', data: { toolCallId: 't', toolName: 'ticket_read_file', arguments: { path: 'src/app.ts' } } },
    { id: 'failure', type: 'tool.execution_complete', timestamp: 'now', data: { toolCallId: 't', success: false, error: { message: 'Unable to read <file>' } } },
  ],
});

test('renders live messages, collapsed reasoning and explicit tool failures', () => {
  const html = renderToStaticMarkup(createElement(SessionAgentActivity, {
    phase: 'execute', runtimes: [runtime], output: 'Inspecting files.', active: true, live: true,
  }));
  assert.match(html, /aria-label="Copilot execution activity"/);
  assert.match(html, /aria-label="Copilot execution activity feed"/);
  assert.match(html, /Live · refreshes every 2 seconds/);
  assert.match(html, /Inspecting files\./);
  assert.equal((html.match(/Inspecting files\./g) ?? []).length, 1);
  assert.match(html, /Reasoning/);
  assert.doesNotMatch(html, /Detailed thinking/);
  assert.match(html, /Read file/);
  assert.match(html, /src\/app\.ts/);
  assert.match(html, /Failed/);
  assert.match(html, /Unable to read &lt;file&gt;/);
  assert.doesNotMatch(html, /Execution report/);
});

test('renders legacy output and truthful empty states without telemetry', () => {
  const report = renderToStaticMarkup(createElement(SessionAgentActivity, {
    phase: 'execute', runtimes: [], output: '# Completed report', active: false, live: false,
  }));
  assert.match(report, /Execution report/);
  assert.match(report, /Completed report/);
  assert.doesNotMatch(report, /Live ·/);

  const waiting = renderToStaticMarkup(createElement(SessionAgentActivity, {
    phase: 'execute', runtimes: [], output: '', active: true, live: true,
  }));
  assert.match(waiting, /Waiting for Copilot activity/);

  const unavailable = renderToStaticMarkup(createElement(SessionAgentActivity, {
    phase: 'execute', runtimes: [], output: '', active: false, live: false,
  }));
  assert.match(unavailable, /No execution activity was recorded/);
});

test('labels the planning preview and review report for the matching phase', () => {
  for (const { phase, label, report } of [
    { phase: 'plan', label: 'planning', report: 'Preview implementation plan' },
    { phase: 'review', label: 'ai review', report: 'AI review report' },
  ] as const) {
    const html = renderToStaticMarkup(createElement(SessionAgentActivity, {
      phase, runtimes: [], output: '# Markdown result', active: false, live: false,
    }));
    assert.ok(html.includes(`aria-label="Copilot ${label} activity feed"`));
    assert.ok(html.includes(report));
    assert.match(html, /Markdown result/);
    assert.doesNotMatch(html, /Execution report/);
  }
});
