import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { agentRuntimeSchema, attemptSnapshotSchema } from '../../shared/types/agent';
import SessionAgentDetails from './SessionAgentDetails';

test('agent block displays reported usage, correct context utilization and billing units', () => {
  const runtime = agentRuntimeSchema.parse({
    id: 'runtime', phase: 'execute', providerSessionId: 'copilot-id', status: 'completed',
    startedAt: '2026-11-03T10:00:00Z', endedAt: '2026-11-03T10:00:05Z',
    error: '', metadata: { requestedModel: 'fixture-model' },
    events: [
      { id: 'usage', type: 'assistant.usage', timestamp: 'now', data: { model: 'fixture-model', inputTokens: 100, outputTokens: 20, cost: 0, duration: 500 } },
      { id: 'context', type: 'session.usage_info', timestamp: 'now', data: { currentTokens: 250, tokenLimit: 1000 } },
    ],
  });
  const snapshot = attemptSnapshotSchema.parse({
    status: 'completed', resumeStatus: 'executing', plan: '', output: '', error: '',
    questions: [], checks: [], runtimes: [runtime], sessionInfo: { workspace: '/fixture' },
  });
  const html = renderToStaticMarkup(createElement(SessionAgentDetails, { snapshot }));
  assert.ok(html.includes('aria-label="Agent details"'));
  assert.ok(html.includes('Execution agent'));
  assert.ok(html.includes('copilot-id'));
  assert.ok(html.includes('25.0%'));
  assert.ok(html.includes(`250 / ${(1000).toLocaleString()}`));
  assert.match(html, /Premium request cost \(multiplier units\)[\s\S]*?>0<\/dd>/);
  assert.ok(html.includes('All session information'));
  assert.ok(html.includes('All raw runtime events (2)'));
  assert.ok(!html.includes('No runtime telemetry recorded'));
});

test('older or queued sessions explicitly show that telemetry is unavailable', () => {
  const snapshot = attemptSnapshotSchema.parse({
    status: 'queued', resumeStatus: null, plan: '', output: '', error: '', questions: [], checks: [],
  });
  const html = renderToStaticMarkup(createElement(SessionAgentDetails, { snapshot }));
  assert.ok(html.includes('No runtime telemetry recorded'));
  assert.ok(html.includes('Not reported'));
  assert.ok(!html.includes('NaN'));
});
