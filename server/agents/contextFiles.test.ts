import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { agentMessage } from './contextFiles';
import { agentContextSchema } from '../../shared/types/agent';
import { INITIAL_TASKS } from '../../shared/data/initialData';
import type { AgentRequest } from './provider';

test('agent messages embed text and send exact PDF/image bytes as SDK blob attachments in every phase', () => {
  const text = '# Requirements\nUse the uploaded design.\n';
  const pdf = Buffer.from('%PDF-1.7\n\x00\xff', 'latin1');
  const image = Buffer.from([137, 80, 78, 71, 0, 255]);
  const contextFiles = [
    { id: randomUUID(), name: 'requirements.md', mimeType: 'text/markdown', size: Buffer.byteLength(text), data: Buffer.from(text).toString('base64') },
    { id: randomUUID(), name: 'design.pdf', mimeType: 'application/pdf', size: pdf.length, data: pdf.toString('base64') },
    { id: randomUUID(), name: 'design.png', mimeType: 'image/png', size: image.length, data: image.toString('base64') },
  ];
  for (const phase of ['plan', 'execute', 'review'] as const) {
    const request: AgentRequest = {
      context: agentContextSchema.parse({ project: null, feature: null, task: { ...INITIAL_TASKS[0], contextFiles } }),
      phase, workspace: '/unused', plan: 'Approved plan', feedback: 'Feedback',
      answers: [{ question: 'Question', answer: 'Answer' }], reviewDiff: 'Diff',
      onSession: async () => {}, ask: async () => '',
    };
    const message = agentMessage(request);
    const prompt = JSON.parse(message.prompt);
    assert.equal(prompt.context.task.contextFiles[0].content, text);
    assert.equal(prompt.context.task.contextFiles[0].data, undefined);
    assert.match(prompt.context.task.contextFiles[1].content, /binary attachment/);
    assert.equal(prompt.phase, phase);
    assert.equal(prompt.approvedPlan, request.plan);
    assert.deepEqual(prompt.previousAnswers, request.answers);
    assert.equal(prompt.reviewDiff, 'Diff');
    assert.deepEqual(message.attachments, [
      { type: 'blob', data: pdf.toString('base64'), mimeType: 'application/pdf', displayName: 'design.pdf' },
      { type: 'blob', data: image.toString('base64'), mimeType: 'image/png', displayName: 'design.png' },
    ]);
  }
});

test('older tasks remain valid and binary data disguised as text is attached without lossy decoding', () => {
  const request: AgentRequest = {
    context: agentContextSchema.parse({ project: null, feature: null, task: INITIAL_TASKS[0] }),
    phase: 'plan', workspace: '/unused', plan: '', answers: [],
    onSession: async () => {}, ask: async () => '',
  };
  assert.equal(agentMessage(request).attachments, undefined);
  assert.equal(JSON.parse(agentMessage(request).prompt).codeGraph, undefined);
  request.context.task.contextFiles = [{
    id: randomUUID(), name: 'data.txt', mimeType: 'text/plain', size: 2, data: '/wA=',
  }];
  assert.deepEqual(agentMessage(request).attachments, [{
    type: 'blob', data: '/wA=', mimeType: 'text/plain', displayName: 'data.txt',
  }]);
});
