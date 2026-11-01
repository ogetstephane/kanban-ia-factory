import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { getAgentWorkflow } from './agentWorkflow';
import WorkflowTimeline from '../components/WorkflowTimeline';
import { agentSession } from '../components/stories/fixtures';
import type { AgentSession } from '../types/agent';

const states = (patch: Partial<AgentSession>) => getAgentWorkflow({ ...agentSession, output: '', ...patch });

test('tickets without a session have five grey pending steps, regardless of board status', () => {
  assert.deepEqual(Object.values(getAgentWorkflow()), Array(5).fill('pending'));
});

test('planning and approval do not complete execution or review', () => {
  assert.deepEqual(states({ status: 'planning', plan: '# Partial plan' }), {
    plan: 'active', approval: 'pending', execution: 'pending', review: 'pending', delivery: 'pending',
  });
  assert.deepEqual(states({ status: 'awaiting_approval', output: '' }), {
    plan: 'completed', approval: 'waiting', execution: 'pending', review: 'pending', delivery: 'pending',
  });
});

test('queued and running execution leave review and delivery grey', () => {
  for (const status of ['execution_queued', 'executing'] as const) {
    assert.deepEqual(states({ status }), {
      plan: 'completed', approval: 'completed', execution: 'active', review: 'pending', delivery: 'pending',
    });
  }
});

test('questions highlight the phase waiting for an answer', () => {
  assert.equal(states({ status: 'awaiting_input', resumeStatus: 'planning', output: '' }).plan, 'waiting');
  const executing = states({ status: 'awaiting_input', resumeStatus: 'executing', output: '' });
  assert.equal(executing.execution, 'waiting');
  assert.equal(executing.approval, 'completed');
});

test('completion still requires human review and a separate delivery', () => {
  assert.deepEqual(states({ status: 'completed' }), {
    plan: 'completed', approval: 'completed', execution: 'completed', review: 'waiting', delivery: 'pending',
  });
  assert.deepEqual(states({ status: 'completed', reviewStatus: 'accepted' }), {
    plan: 'completed', approval: 'completed', execution: 'completed', review: 'completed', delivery: 'waiting',
  });
});

test('failed and cancelled phases retain truthful progress even with partial streaming text', () => {
  assert.deepEqual(states({ status: 'failed', resumeStatus: 'planning', output: '' }), {
    plan: 'failed', approval: 'pending', execution: 'pending', review: 'pending', delivery: 'pending',
  });
  assert.deepEqual(states({ status: 'cancelled', resumeStatus: 'executing', output: '' }), {
    plan: 'completed', approval: 'completed', execution: 'stopped', review: 'pending', delivery: 'pending',
  });
  assert.deepEqual(states({ status: 'cancelled', resumeStatus: 'awaiting_approval', output: '' }), {
    plan: 'completed', approval: 'stopped', execution: 'pending', review: 'pending', delivery: 'pending',
  });
});

test('publication completion and failure do not masquerade as execution failure', () => {
  assert.equal(states({
    status: 'delivering', reviewStatus: 'accepted',
    publication: { status: 'pushing', branch: 'main', commitHash: '123', error: '' },
  }).delivery, 'active');
  assert.equal(states({
    status: 'completed', reviewStatus: 'accepted',
    publication: { status: 'failed', branch: 'main', commitHash: '123', error: 'Push rejected' },
  }).delivery, 'failed');
  assert.equal(states({
    status: 'completed', reviewStatus: 'accepted',
    publication: { status: 'pushed', branch: 'main', commitHash: '123', error: '' },
  }).delivery, 'completed');
});

test('local delivery retains completed review and highlights only its own progress', () => {
  for (const status of ['committing', 'committed', 'merging', 'delivered', 'failed']) {
    assert.deepEqual(getAgentWorkflow({
      status: 'completed', resumeStatus: 'executing', reviewStatus: 'accepted',
      delivery: { status, error: status === 'failed' ? 'Merge conflict' : '' },
    }), {
      plan: 'completed', approval: 'completed', execution: 'completed', review: 'completed',
      delivery: status === 'delivered' ? 'completed' : status === 'failed' ? 'failed' : 'active',
    });
  }
});

test('a fresh queued attempt does not inherit progress from the previous run', () => {
  assert.deepEqual(states({ status: 'queued', resumeStatus: null, reviewStatus: 'pending', plan: '', output: '' }), {
    plan: 'active', approval: 'pending', execution: 'pending', review: 'pending', delivery: 'pending',
  });
});

test('the compact component keeps accessible names and explicit step states', () => {
  const markup = renderToStaticMarkup(createElement(WorkflowTimeline, {
    workflow: states({ status: 'executing' }), compact: true, label: 'Ticket workflow',
  }));
  assert.match(markup, /aria-label="Ticket workflow"/);
  assert.equal((markup.match(/data-step=/g) ?? []).length, 5);
  assert.match(markup, /data-step="execution" data-state="active" aria-current="step"/);
  assert.match(markup, /data-step="review" data-state="pending"/);
  assert.match(markup, /title="Delivery: Not started"/);
  assert.match(markup, /Not started/);
});
