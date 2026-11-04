import test from 'node:test';
import assert from 'node:assert/strict';
import {
  moveTask,
  calculateFeatureProgress,
  filterTasks,
  calculateWorkflowMetrics,
  parseCopilotResponse,
  KANBAN_STATUSES,
  canMoveTask,
  canCreateTaskIn,
  reachableStatuses,
} from './kanbanLogic';
import { Task, KanbanFilters } from '../types/kanban';

const mockTasks: Task[] = [
  {
    id: 't-1',
    title: 'Design OAuth architecture',
    description: 'Create sequence diagrams for Google & GitHub OAuth',
    status: 'Done',
    priority: 'High',
    featureId: 'feat-auth',
    storyPoints: 3,
    tags: ['auth', 'architecture'],
    subtasks: [
      { id: 's1', text: 'Google OAuth flow', completed: true },
      { id: 's2', text: 'GitHub OAuth flow', completed: true }
    ],
    acceptanceCriteria: ['Passes security audit'],
    order: 0,
    createdAt: '2026-10-26T00:00:00Z',
    updatedAt: '2026-10-26T01:00:00Z'
  },
  {
    id: 't-2',
    title: 'Implement JWT session verification',
    description: 'Verify tokens in middleware',
    status: 'In Progress',
    priority: 'Critical',
    featureId: 'feat-auth',
    storyPoints: 5,
    tags: ['auth', 'backend'],
    subtasks: [{ id: 's3', text: 'Token rotation', completed: false }],
    acceptanceCriteria: ['Bearer header supported'],
    order: 0,
    createdAt: '2026-10-26T00:00:00Z',
    updatedAt: '2026-10-26T01:00:00Z'
  },
  {
    id: 't-3',
    title: 'Write unit tests for session revoking',
    description: 'Ensure revoked tokens reject requests',
    status: 'Backlog',
    priority: 'Medium',
    featureId: 'feat-auth',
    storyPoints: 2,
    tags: ['testing'],
    subtasks: [],
    acceptanceCriteria: ['Coverage >= 90%'],
    order: 0,
    createdAt: '2026-10-26T00:00:00Z',
    updatedAt: '2026-10-26T01:00:00Z'
  },
  {
    id: 't-4',
    title: 'Add Billing webhook handlers',
    description: 'Stripe webhook listeners',
    status: 'Review',
    priority: 'High',
    featureId: 'feat-billing',
    storyPoints: 5,
    tags: ['stripe', 'payments'],
    subtasks: [],
    acceptanceCriteria: ['Idempotency enforced'],
    order: 0,
    createdAt: '2026-10-26T00:00:00Z',
    updatedAt: '2026-10-26T01:00:00Z'
  }
];

test('KANBAN_STATUSES includes all 5 requested statuses in order', () => {
  assert.deepEqual(KANBAN_STATUSES, [
    'Backlog',
    'To Do',
    'In Progress',
    'Review',
    'Done'
  ]);
});

test('calculateFeatureProgress computes correct metrics', () => {
  const result = calculateFeatureProgress('feat-auth', mockTasks);
  assert.equal(result.total, 3);
  assert.equal(result.done, 1);
  assert.equal(result.inProgress, 1);
  assert.equal(result.percentage, 33);

  const emptyResult = calculateFeatureProgress('non-existent', mockTasks);
  assert.equal(emptyResult.total, 0);
  assert.equal(emptyResult.percentage, 0);
});

test('moveTask changes status and updates ordering', () => {
  const moved = moveTask(mockTasks, 't-3', 'In Progress', 0);
  const target = moved.find(t => t.id === 't-3');
  assert.ok(target);
  assert.equal(target.status, 'In Progress');
  assert.equal(target.order, 0);

  const prevInProg = moved.find(t => t.id === 't-2');
  assert.ok(prevInProg);
  assert.equal(prevInProg.order, 1);
});

test('filterTasks correctly filters by search, priority, feature, and status', () => {
  const filtersAll: KanbanFilters = {
    search: '',
    featureId: 'All',
    priority: 'All',
    status: 'All',
    tag: ''
  };

  assert.equal(filterTasks(mockTasks, filtersAll).length, 4);

  // Search filter
  const searchFilter: KanbanFilters = { ...filtersAll, search: 'stripe' };
  assert.equal(filterTasks(mockTasks, searchFilter).length, 1);
  assert.equal(filterTasks(mockTasks, searchFilter)[0].id, 't-4');

  // Priority filter
  const priorityFilter: KanbanFilters = { ...filtersAll, priority: 'Critical' };
  assert.equal(filterTasks(mockTasks, priorityFilter).length, 1);
  assert.equal(filterTasks(mockTasks, priorityFilter)[0].id, 't-2');

  // Feature filter
  const featureFilter: KanbanFilters = { ...filtersAll, featureId: 'feat-billing' };
  assert.equal(filterTasks(mockTasks, featureFilter).length, 1);
  assert.equal(filterTasks(mockTasks, featureFilter)[0].id, 't-4');
});

test('calculateWorkflowMetrics summarizes status counts and checks bottlenecks', () => {
  const metrics = calculateWorkflowMetrics(mockTasks);
  assert.equal(metrics.totalTasks, 4);
  assert.equal(metrics.completedTasks, 1);
  assert.equal(metrics.donePercentage, 25);
  assert.equal(metrics.wipCount, 1);
  assert.equal(metrics.reviewQueueCount, 1);
  assert.equal(metrics.statusCounts['Done'], 1);
  assert.equal(metrics.priorityCounts['Critical'], 1);
});

test('parseCopilotResponse handles markdown code blocks and raw JSON', () => {
  const markdownJson = '```json\n{"tasks": [{"title": "Task 1"}]}\n```';
  const parsed = parseCopilotResponse<{ tasks: { title: string }[] }>(markdownJson, { tasks: [] });
  assert.equal(parsed.tasks[0].title, 'Task 1');

  const rawJson = '{"name": "Copilot"}';
  const parsedRaw = parseCopilotResponse(rawJson, { name: '' });
  assert.equal(parsedRaw.name, 'Copilot');

  const invalid = 'Some non-json response text';
  const fallback = { fallback: true };
  const parsedFallback = parseCopilotResponse(invalid, fallback);
  assert.deepEqual(parsedFallback, fallback);
});

test('workflow allows sequential stages and returning Review to In Progress', () => {
  const allowed = KANBAN_STATUSES.flatMap((from) => KANBAN_STATUSES
    .filter((to) => from !== to && canMoveTask(from, to)).map((to) => `${from} -> ${to}`));
  assert.deepEqual(allowed, [
    'Backlog -> To Do', 'To Do -> Backlog', 'To Do -> In Progress', 'In Progress -> Review', 'Review -> In Progress', 'Review -> Done',
  ]);
  assert.ok(KANBAN_STATUSES.every((status) => canMoveTask(status, status)));
  assert.deepEqual(reachableStatuses('To Do'), ['Backlog', 'To Do', 'In Progress']);
  assert.deepEqual(reachableStatuses('Done'), ['Done']);
  assert.deepEqual(KANBAN_STATUSES.filter(canCreateTaskIn), ['Backlog', 'To Do']);
});
