import type { Feature, KanbanFilters, Project, Task } from '../../types/kanban';
import type { AgentSession } from '../../types/agent';
import type { Release } from '../../types/release';

export const project: Project = {
  id: 'storybook-project',
  name: 'Atlas',
  description: 'A sample project for component stories.',
  color: '#6366f1',
  repositoryUrl: 'https://github.com/example/atlas',
  repositoryBranch: 'main',
  createdAt: '2026-01-01T10:00:00.000Z',
  updatedAt: '2026-01-01T10:00:00.000Z',
};

export const feature: Feature = {
  id: 'storybook-feature',
  title: 'Workspace improvements',
  description: 'Make the planning workspace easier to navigate.',
  category: 'Product',
  status: 'In Progress',
  projectId: project.id,
  color: '#6366f1',
  createdAt: '2026-01-01T10:00:00.000Z',
};

export const tasks: Task[] = [
  {
    id: 'storybook-task-1',
    title: 'Add keyboard shortcuts',
    description: 'Support common board actions from the keyboard.',
    status: 'In Progress',
    priority: 'High',
    projectId: project.id,
    featureId: feature.id,
    storyPoints: 5,
    tags: ['accessibility', 'ux'],
    subtasks: [
      { id: 'shortcut-1', text: 'Document available shortcuts', completed: true },
      { id: 'shortcut-2', text: 'Add shortcut handling', completed: false },
    ],
    acceptanceCriteria: ['Shortcuts are discoverable', 'Inputs keep their normal behavior'],
    order: 1,
    createdAt: '2026-01-01T10:00:00.000Z',
    updatedAt: '2026-01-02T10:00:00.000Z',
  },
  {
    id: 'storybook-task-2',
    title: 'Polish empty states',
    description: 'Provide useful guidance when a list has no items.',
    status: 'To Do',
    priority: 'Medium',
    projectId: project.id,
    featureId: feature.id,
    storyPoints: 3,
    tags: ['design'],
    subtasks: [],
    acceptanceCriteria: ['Empty states explain the next step'],
    order: 2,
    createdAt: '2026-01-02T10:00:00.000Z',
    updatedAt: '2026-01-02T10:00:00.000Z',
  },
];

export const filters: KanbanFilters = {
  search: '',
  featureId: 'All',
  priority: 'All',
  status: 'All',
  tag: '',
};

export const release: Release = {
  id: 'storybook-release',
  projectId: project.id,
  version: '1.2.0',
  status: 'in_progress',
  revision: 1,
  publishing: false,
  targetBranch: 'main',
  targetCommit: null,
  remoteUrl: null,
  tagHash: null,
  error: '',
  publishedAt: null,
  createdAt: '2026-01-03T10:00:00.000Z',
  updatedAt: '2026-01-03T10:00:00.000Z',
  ticketCount: 2,
  deliveredCount: 1,
};

export const agentSession: AgentSession = {
  id: 'storybook-session',
  taskId: tasks[0].id,
  projectId: project.id,
  releaseId: release.id,
  provider: 'copilot',
  status: 'completed',
  autoExecute: false,
  taskRevision: 1,
  workspace: '/workspace/atlas',
  branch: 'story/keyboard-shortcuts',
  baseCommit: '0123456789abcdef',
  providerSessionId: null,
  plan: 'Implement and verify keyboard shortcuts.',
  output: 'The keyboard shortcut handlers are ready for review.',
  error: '',
  createdAt: '2026-01-04T10:00:00.000Z',
  updatedAt: '2026-01-04T11:00:00.000Z',
  questions: [],
  attempt: 1,
  feedback: '',
  reviewStatus: 'pending',
  reviewToken: '',
  checks: [],
  attempts: [],
  delivery: null,
  publication: null,
};

export const agentQuestion = {
  id: 'storybook-question',
  question: 'Which shortcut should open the command palette?',
  choices: ['Ctrl+K', 'Ctrl+Shift+P'],
  allowFreeform: true,
  answer: null,
  createdAt: '2026-01-04T10:30:00.000Z',
  answeredAt: null,
};
