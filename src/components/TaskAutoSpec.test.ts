import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TaskAutoSpecButton, TaskAutoSpecPlan, TaskAutoSpecResult, TaskAutoSpecStatus } from './TaskAutoSpec';
import { AssistantModeToggle } from './AssistantModeToggle';

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
    spec: { feedback: null, impactAnalysis: '', quality: null, dismissFeedback: noop },
  })), '');
  const html = renderToStaticMarkup(createElement(TaskAutoSpecResult, {
    spec: { feedback: 'Copilot generated the specification.', impactAnalysis: 'Touches **server/routes/board.ts**', quality: null, dismissFeedback: noop },
  }));
  assert.match(html, /Copilot generated the specification\./);
  assert.match(html, /Code impact analysis/);
  assert.match(html, /<strong[^>]*>server\/routes\/board\.ts<\/strong>/);
  const report = renderToStaticMarkup(createElement(TaskAutoSpecResult, {
    spec: { feedback: null, impactAnalysis: '', quality: { status: 'ready-for-review', issues: [] }, dismissFeedback: noop },
  }));
  assert.match(report, /Ready for human review/);
  assert.match(report, /last generated proposal, before your edits/);
});

test('Auto-Spec plan is editable, explains why it is needed and can be applied or discarded', () => {
  assert.equal(renderToStaticMarkup(createElement(TaskAutoSpecPlan, {
    spec: { plan: null, generating: false, editPlan: noop, discardPlan: noop }, disabled: false, onApprove: noop,
  })), '');
  const html = renderToStaticMarkup(createElement(TaskAutoSpecPlan, {
    spec: { plan: { plan: '1. Split the ticket', reason: 'The scope spans two features.' }, generating: false, editPlan: noop, discardPlan: noop },
    disabled: false, onApprove: noop,
  }));
  assert.match(html, /aria-label="Copilot specification plan"/);
  assert.match(html, /The scope spans two features\./);
  assert.match(html, /<textarea[^>]*>1\. Split the ticket<\/textarea>/);
  assert.match(html, /Generate specification from plan/);
  assert.match(html, /Discard plan/);
});

test('the assistant mode toggle exposes Auto and Plan as an accessible radio group', () => {
  const html = renderToStaticMarkup(createElement(AssistantModeToggle, { mode: 'plan', onChange: noop }));
  assert.match(html, /role="radiogroup" aria-label="Copilot assistant mode"/);
  assert.match(html, /value="auto"/);
  assert.match(html, /checked="" value="plan"/);
  assert.match(html, /proposes an editable plan first/);
});
