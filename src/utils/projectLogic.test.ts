import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ALL_PROJECTS,
  createProject,
  deleteProject,
  calculateProjectStats,
  filterByProject,
} from './projectLogic';
import { Project, Task, Feature } from '../types/kanban';

const mockProjects: Project[] = [
  {
    id: 'proj-1',
    name: 'SaaS Web App',
    description: 'Core web portal',
    color: '#6366f1',
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
  },
  {
    id: 'proj-2',
    name: 'Mobile App',
    description: 'React Native companion app',
    color: '#10b981',
    createdAt: '2026-10-02T00:00:00Z',
    updatedAt: '2026-10-02T00:00:00Z',
  },
];

const mockTasks: Task[] = [
  {
    id: 't1',
    title: 'Task 1',
    description: '',
    status: 'Done',
    priority: 'High',
    projectId: 'proj-1',
    storyPoints: 3,
    tags: [],
    subtasks: [],
    acceptanceCriteria: [],
    order: 0,
    createdAt: '',
    updatedAt: '',
  },
  {
    id: 't2',
    title: 'Task 2',
    description: '',
    status: 'In Progress',
    priority: 'Medium',
    projectId: 'proj-1',
    storyPoints: 2,
    tags: [],
    subtasks: [],
    acceptanceCriteria: [],
    order: 1,
    createdAt: '',
    updatedAt: '',
  },
  {
    id: 't3',
    title: 'Task 3',
    description: '',
    status: 'To Do',
    priority: 'Low',
    projectId: 'proj-2',
    storyPoints: 5,
    tags: [],
    subtasks: [],
    acceptanceCriteria: [],
    order: 0,
    createdAt: '',
    updatedAt: '',
  },
];

const mockFeatures: Feature[] = [
  {
    id: 'f1',
    title: 'Auth Feature',
    description: '',
    category: 'Security',
    status: 'Backlog',
    projectId: 'proj-1',
    color: '#6366f1',
    createdAt: '',
  },
  {
    id: 'f2',
    title: 'Biometric Feature',
    description: '',
    category: 'Mobile',
    status: 'Backlog',
    projectId: 'proj-2',
    color: '#10b981',
    createdAt: '',
  },
];

test('createProject appends a valid new project with ID and timestamps', () => {
  const result = createProject(mockProjects, 'AI Agent Assistant', 'Autonomous agent workflows', '#8b5cf6', '🤖');
  assert.equal(result.projects.length, 3);
  assert.equal(result.newProject.name, 'AI Agent Assistant');
  assert.equal(result.newProject.color, '#8b5cf6');
  assert.ok(result.newProject.id.startsWith('proj-'));
});

test('deleteProject removes targeted project and resolves next active ID', () => {
  const result = deleteProject(mockProjects, 'proj-1', 'proj-1');
  assert.equal(result.projects.length, 1);
  assert.equal(result.projects[0].id, 'proj-2');
  assert.equal(result.nextActiveId, 'proj-2');

  // Deleting non-active project retains active ID
  const result2 = deleteProject(mockProjects, 'proj-2', 'proj-1');
  assert.equal(result2.nextActiveId, 'proj-1');
  assert.equal(deleteProject(mockProjects, 'proj-2', ALL_PROJECTS).nextActiveId, ALL_PROJECTS);
});

test('calculateProjectStats computes scoped completion rates', () => {
  const statsProj1 = calculateProjectStats('proj-1', mockTasks, mockFeatures);
  assert.equal(statsProj1.totalTasks, 2);
  assert.equal(statsProj1.doneTasks, 1);
  assert.equal(statsProj1.inProgressTasks, 1);
  assert.equal(statsProj1.completionRate, 50);
  assert.equal(statsProj1.totalFeatures, 1);

  const statsProj2 = calculateProjectStats('proj-2', mockTasks, mockFeatures);
  assert.equal(statsProj2.totalTasks, 1);
  assert.equal(statsProj2.doneTasks, 0);
  assert.equal(statsProj2.completionRate, 0);
});

test('filterByProject correctly isolates items by project', () => {
  const proj1Tasks = filterByProject(mockTasks, 'proj-1');
  assert.equal(proj1Tasks.length, 2);
  assert.equal(proj1Tasks[0].id, 't1');
  assert.equal(proj1Tasks[1].id, 't2');

  const proj2Tasks = filterByProject(mockTasks, 'proj-2');
  assert.equal(proj2Tasks.length, 1);
  assert.equal(proj2Tasks[0].id, 't3');
  assert.deepEqual(filterByProject(mockTasks, ALL_PROJECTS), mockTasks);
  assert.deepEqual(filterByProject(mockFeatures, ALL_PROJECTS), mockFeatures);
});
