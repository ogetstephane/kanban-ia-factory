import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TaskModal } from './TaskModal';

test('task drafting identifies the skill and explains when unsaved attachments are sent', () => {
  const html = renderToStaticMarkup(createElement(TaskModal, {
    isOpen: true, task: null, features: [], projectId: 'project',
    onClose: () => undefined, onSave: () => undefined, presentation: 'page',
  }));
  assert.match(html, /ticket-graphify skill/);
  assert.match(html, /Sent to Copilot for Auto-Spec and ticket sessions; stored when you save the task/);
  assert.equal((html.match(/Any file type, including PDFs and images/g) ?? []).length, 1);
});
