import type { ContextFile } from './contextFile';
import type { AgentProviderId } from './agentProvider';

export type KanbanStatus = 'Backlog' | 'To Do' | 'In Progress' | 'Review' | 'Done';

export type TaskPriority = 'Critical' | 'High' | 'Medium' | 'Low';

export interface Project {
  id: string;
  revision?: number;
  name: string;
  description: string;
  color: string;
  icon?: string;
  category?: string;
  repositoryUrl?: string;
  repositoryBranch?: string;
  repositoryCommit?: string;
  docsPath?: string;
  stats?: {
    totalTasks: number;
    completedTasks: number;
    inProgressTasks: number;
    completionRate: number;
    totalFeatures: number;
  };
  createdAt: string;
  updatedAt: string;
}

export interface Subtask {
  id: string;
  text: string;
  completed: boolean;
}

export interface Feature {
  id: string;
  revision?: number;
  title: string;
  description: string;
  category: string;
  status: KanbanStatus;
  projectId?: string; // Belongs to a project
  targetDate?: string;
  color: string; // Tailwind hex or class prefix
  createdAt: string;
}

export interface Task {
  id: string;
  revision?: number;
  title: string;
  description: string;
  status: KanbanStatus;
  priority: TaskPriority;
  projectId?: string; // Belongs to a project
  featureId?: string; // Links task to a feature
  releaseId?: string;
  storyPoints: number;
  tags: string[];
  subtasks: Subtask[];
  acceptanceCriteria: string[];
  suggestedWorkflow?: string;
  blockedReason?: string;
  contextFiles?: ContextFile[];
  agentProvider?: AgentProviderId;
  agentModel?: string;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface KanbanFilters {
  search: string;
  featureId: string | 'All';
  priority: TaskPriority | 'All';
  status: KanbanStatus | 'All';
  tag: string;
}

export interface WorkflowMetrics {
  totalTasks: number;
  completedTasks: number;
  donePercentage: number;
  wipCount: number;
  reviewQueueCount: number;
  bottlenecks: string[];
  priorityCounts: Record<TaskPriority, number>;
  statusCounts: Record<KanbanStatus, number>;
}
