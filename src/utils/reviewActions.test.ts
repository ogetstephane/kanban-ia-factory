import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { KanbanCard } from '../components/KanbanCard';
import { EpicCard } from '../components/EpicCard';
import FileDiff from '../components/FileDiff';
import { featureSchema, taskSchema } from '../../shared/types/board';
import PublishedWork from '../components/PublishedWork';

const now = '2026-10-28T17:00:00Z';
const task = taskSchema.parse({
  id: 'review-ticket', title: 'Review ticket', status: 'Review', description: '',
  priority: 'Medium', tags: [], acceptanceCriteria: [], subtasks: [], order: 0,
  storyPoints: 1, createdAt: now, updatedAt: now,
});
const noop = () => undefined;

test('Review cards offer separate human and AI actions, other stages do not', () => {
  const props = {
    task, onEdit: noop, onMoveStatus: noop, onDragStatus: noop, onReview: noop,
  };
  const review = renderToStaticMarkup(createElement(KanbanCard, props));
  assert.match(review, /Manually review Review ticket/);
  assert.match(review, /AI review Review ticket/);
  const active = renderToStaticMarkup(createElement(KanbanCard, { ...props, task: { ...task, status: 'In Progress' } }));
  assert.doesNotMatch(active, /Manually review/);
});

test('cards show only a status selector, and only when several statuses are reachable', () => {
  const props = { task: { ...task, status: 'To Do' as const }, onEdit: noop, onMoveStatus: noop, onDragStatus: noop };
  const todo = renderToStaticMarkup(createElement(KanbanCard, props));
  assert.match(todo, /Current stage of Review ticket/);
  assert.doesNotMatch(todo, /Edit task|Delete task|Enhance task|Move task/);
  const done = renderToStaticMarkup(createElement(KanbanCard, { ...props, task: { ...task, status: 'Done' as const } }));
  assert.doesNotMatch(done, /<select/);
  assert.doesNotMatch(done, /border-t/);
});

test('Review epics expose both review actions without expanding their children', () => {
  const feature = featureSchema.parse({
    id: 'review-epic', title: 'Review epic', status: 'Review', description: '',
    category: 'Test', color: '#6366f1', createdAt: now,
  });
  const markup = renderToStaticMarkup(createElement(EpicCard, {
    feature, tasks: [task], onMoveStatus: noop, onDragStatus: noop,
    onOpenTask: noop, onDeleteTask: noop, onAddTask: noop,
    onReviewFeature: noop, onReviewTask: noop,
  }));
  assert.match(markup, /Manually review Review epic/);
  assert.match(markup, /AI review Review epic/);
});

test('diff browser lists every modified file as a selectable button', () => {
  const markup = renderToStaticMarkup(createElement(FileDiff, {
    files: [{ path: 'src/first.ts', status: 'M' }, { path: 'src/second.ts', status: 'A' }],
    selected: 'src/first.ts', onSelect: noop, baseCommit: '1234567', error: '',
    file: { path: 'src/first.ts', patch: '@@ -1 +1 @@\n-old\n+new\n', binary: false, truncated: false },
  }));
  assert.match(markup, /aria-label="All modified files"/);
  assert.match(markup, /aria-current="true"/);
  assert.match(markup, /<button[^>]*>[\s\S]*?src\/first.ts<\/button>/);
  assert.match(markup, /<button[^>]*>[\s\S]*?src\/second.ts<\/button>/);
  assert.match(markup, /Side-by-side file comparison/);
});

test('Git published work shows completed epic branch and release after worktree cleanup', () => {
  const work = {
    id: 'published-epic', kind: 'features' as const, title: 'Published epic', branch: 'feature/published-epic',
    tasks: [{ id: 'published-child', title: 'Child ticket', revision: 1, releaseId: 'release-next', releaseVersion: '2.0.0' }],
    finishStatus: null, finishError: '',
  };
  const markup = renderToStaticMarkup(createElement(PublishedWork, {
    work, projectId: 'project', onRefresh: noop, onOpenTask: noop,
  }));
  assert.match(markup, /Epic · Published epic · Done/);
  assert.match(markup, /origin\/feature\/published-epic/);
  assert.match(markup, /v2.0.0/);
  assert.match(markup, />Finish<\/button>/);
  const finished = renderToStaticMarkup(createElement(PublishedWork, {
    work: { ...work, finishStatus: 'finished' }, projectId: 'project', onRefresh: noop, onOpenTask: noop,
  }));
  assert.match(finished, /Finished · branch closed/);
  assert.doesNotMatch(finished, />Finish<\/button>/);
});
