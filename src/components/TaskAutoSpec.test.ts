import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TaskAutoSpecButton, TaskAutoSpecResult, TaskAutoSpecStatus } from './TaskAutoSpec';

const noop = () => undefined;

test('Auto-Spec button names the skill and turns into a disabled progress label while generating', () => {
  const idle = renderToStaticMarkup(createElement(TaskAutoSpecButton, { spec: { generating: false }, disabled: false, onGenerate: noop }));
  assert.match(idle, /ticket-graphify skill/);
  assert.match(idle, /Copilot Auto-Spec/);
  assert.doesNotMatch(idle, /disabled=""/);

  const blocked = renderToStaticMarkup(createElement(TaskAutoSpecButton, { spec: { generating: false }, disabled: true, onGenerate: noop }));
  assert.match(blocked, /disabled=""/);

  const generating = renderToStaticMarkup(createElement(TaskAutoSpecButton, { spec: { generating: true }, disabled: false, onGenerate: noop }));
  assert.match(generating, /Generating spec\.\.\./);
  assert.match(generating, /disabled=""/);
});

test('Auto-Spec status offers cancellation only while a generation runs', () => {
  assert.equal(renderToStaticMarkup(createElement(TaskAutoSpecStatus, { spec: { generating: false, cancel: noop } })), '');
  const html = renderToStaticMarkup(createElement(TaskAutoSpecStatus, { spec: { generating: true, cancel: noop } }));
  assert.match(html, /role="status"/);
  assert.match(html, /Cancel generation/);
});

test('Auto-Spec result shows the notice and the rendered code impact analysis once available', () => {
  assert.equal(renderToStaticMarkup(createElement(TaskAutoSpecResult, {
    spec: { feedback: null, impactAnalysis: '', dismissFeedback: noop },
  })), '');
  const html = renderToStaticMarkup(createElement(TaskAutoSpecResult, {
    spec: { feedback: 'Copilot generated the specification.', impactAnalysis: 'Touches **server/routes/board.ts**', dismissFeedback: noop },
  }));
  assert.match(html, /Copilot generated the specification\./);
  assert.match(html, /Code impact analysis/);
  assert.match(html, /<strong[^>]*>server\/routes\/board\.ts<\/strong>/);
});
