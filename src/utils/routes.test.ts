import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isViewMode, taskEditorPath, taskReturnPath, VIEW_MODES, viewPath } from './routes';

test('every main view has a project-scoped, shareable URL', () => {
  assert.equal(VIEW_MODES.length, 11);
  for (const view of VIEW_MODES) {
    assert.equal(isViewMode(view), true);
    assert.equal(viewPath('project one', view), `/projects/project%20one/${view}`);
    assert.equal(viewPath('All', view), `/projects/All/${view}`);
  }
  assert.equal(isViewMode('unknown'), false);
  assert.equal(isViewMode(undefined), false);
});

test('new task pages preserve project, stage and feature defaults', () => {
  const url = new URL(taskEditorPath('project/a', { status: 'To Do', featureId: 'feature & one' }), 'http://localhost');
  assert.equal(url.pathname, '/projects/project%2Fa/tasks/new');
  assert.equal(url.searchParams.get('status'), 'To Do');
  assert.equal(url.searchParams.get('featureId'), 'feature & one');
});

test('edit task pages preserve owning project and requested session action', () => {
  const url = new URL(taskEditorPath('owner', { taskId: 'ticket/a', action: 'review' }), 'http://localhost');
  assert.equal(url.pathname, '/projects/owner/tasks/ticket%2Fa/edit');
  assert.equal(url.searchParams.get('action'), 'review');
  assert.equal(taskEditorPath('owner', { taskId: 'ticket' }), '/projects/owner/tasks/ticket/edit');
});

test('task pages return to their originating view including aggregate scopes', () => {
  assert.equal(taskReturnPath('owner', { returnProjectId: 'All', returnView: 'releases' }), '/projects/All/releases');
  assert.equal(taskReturnPath('owner', { returnProjectId: 'project one', returnView: 'git' }), '/projects/project%20one/git');
});

test('direct task URLs and invalid return state default to the owning board', () => {
  for (const state of [null, undefined, {}, 'https://example.com', { returnProjectId: '', returnView: 'board' },
    { returnProjectId: 'owner', returnView: 'unknown' }]) {
    assert.equal(taskReturnPath('owner', state), '/projects/owner/board');
  }
});
