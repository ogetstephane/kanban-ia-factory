import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateStageDwellTimes,
  generateVelocityTrends,
  generateCumulativeFlowData,
  calculateVelocityDashboardData
} from './velocityMetrics';
import { Task } from '../types/kanban';

const testTasks: Task[] = [
  {
    id: 't-1',
    title: 'Test Task 1',
    description: '',
    status: 'Done',
    priority: 'High',
    featureId: 'feat-1',
    storyPoints: 5,
    tags: [],
    subtasks: [],
    acceptanceCriteria: [],
    order: 0,
    createdAt: '2026-10-20T00:00:00Z',
    updatedAt: '2026-10-22T00:00:00Z',
  },
  {
    id: 't-2',
    title: 'Test Task 2',
    description: '',
    status: 'In Progress',
    priority: 'Critical',
    featureId: 'feat-1',
    storyPoints: 8,
    tags: [],
    subtasks: [],
    acceptanceCriteria: [],
    order: 1,
    createdAt: '2026-10-22T00:00:00Z',
    updatedAt: '2026-10-23T00:00:00Z',
  },
  {
    id: 't-3',
    title: 'Test Task 3',
    description: '',
    status: 'Review',
    priority: 'Medium',
    featureId: 'feat-2',
    storyPoints: 3,
    tags: [],
    subtasks: [],
    acceptanceCriteria: [],
    order: 0,
    createdAt: '2026-10-24T00:00:00Z',
    updatedAt: '2026-10-25T00:00:00Z',
  },
  {
    id: 't-4',
    title: 'Test Task 4',
    description: '',
    status: 'Backlog',
    priority: 'Low',
    featureId: 'feat-2',
    storyPoints: 2,
    tags: [],
    subtasks: [],
    acceptanceCriteria: [],
    order: 0,
    createdAt: '2026-10-25T00:00:00Z',
    updatedAt: '2026-10-25T00:00:00Z',
  },
];

test('calculateStageDwellTimes produces dwell stats for all 5 stages', () => {
  const dwell = calculateStageDwellTimes(testTasks);
  assert.equal(dwell.length, 5);
  const inProgressStage = dwell.find(s => s.stage === 'In Progress');
  assert.ok(inProgressStage);
  assert.equal(inProgressStage.activeCount, 1);
  assert.ok(inProgressStage.avgDays > 0);
});

test('generateVelocityTrends computes sprint velocity arrays', () => {
  const trends = generateVelocityTrends(testTasks, 'All');
  assert.equal(trends.length, 6);
  const currentSprint = trends[trends.length - 1];
  assert.equal(currentSprint.period, 'Current Sprint');
  assert.ok(currentSprint.completedPoints >= 5);
});

test('generateCumulativeFlowData returns valid CFD data points', () => {
  const cfd = generateCumulativeFlowData(testTasks);
  assert.equal(cfd.length, 6);
  const currentPoint = cfd[cfd.length - 1];
  assert.equal(currentPoint.date, 'Current');
  assert.equal(currentPoint.Done, 1);
  assert.equal(currentPoint['In Progress'], 1);
  assert.equal(currentPoint.Review, 1);
  assert.equal(currentPoint.Backlog, 1);
});

test('calculateVelocityDashboardData computes high-level KPIs and flags bottlenecks', () => {
  const dashboard = calculateVelocityDashboardData(testTasks, 'All');
  assert.ok(dashboard.kpis.avgCycleTimeDays > 0);
  assert.ok(dashboard.kpis.currentSprintVelocity > 0);
  assert.equal(dashboard.cumulativeFlow.length, 6);
  assert.equal(dashboard.velocityTrends.length, 6);
});
