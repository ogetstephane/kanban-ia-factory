import { KanbanStatus, TaskPriority, Task, Feature, KanbanFilters, WorkflowMetrics } from '../types/kanban';

export const KANBAN_STATUSES: KanbanStatus[] = [
  'Backlog',
  'To Do',
  'In Progress',
  'Review',
  'Done'
];

export const TASK_PRIORITIES: TaskPriority[] = ['Critical', 'High', 'Medium', 'Low'];

/** Review may request another implementation cycle. */
export const WORKFLOW_TRANSITIONS: Record<KanbanStatus, readonly KanbanStatus[]> = {
  Backlog: ['To Do'],
  'To Do': ['Backlog', 'In Progress'],
  'In Progress': ['Review'],
  Review: ['In Progress', 'Done'],
  Done: [],
};

/** Stages in which a new task can be created. */
export const CREATION_STATUSES: readonly KanbanStatus[] = ['Backlog', 'To Do'];

/** Staying in the same column (reordering) is always allowed. */
export const canMoveTask = (from: KanbanStatus, to: KanbanStatus) =>
  from === to || WORKFLOW_TRANSITIONS[from].includes(to);

export const canCreateTaskIn = (status: KanbanStatus) => CREATION_STATUSES.includes(status);

/** Current stage plus the stages reachable from it, in board order. */
export const reachableStatuses = (from: KanbanStatus) => KANBAN_STATUSES.filter((status) => canMoveTask(from, status));

export const transitionError = (from: KanbanStatus, to: KanbanStatus, entity = 'task') => {
  const allowed = WORKFLOW_TRANSITIONS[from];
  const article = entity === 'epic' ? 'An' : 'A';
  return `${article} ${entity} cannot move from ${from} to ${to}. ${allowed.length ? `Allowed: ${allowed.join(', ')}.` : `${from} is final.`}`;
};

/**
 * Calculates completion and breakdown metrics for a specific feature
 */
export function calculateFeatureProgress(featureId: string, tasks: Task[]) {
  const featureTasks = tasks.filter(t => t.featureId === featureId);
  const total = featureTasks.length;
  if (total === 0) {
    return { total: 0, done: 0, inProgress: 0, percentage: 0 };
  }
  const done = featureTasks.filter(t => t.status === 'Done').length;
  const inProgress = featureTasks.filter(t => t.status === 'In Progress' || t.status === 'Review').length;
  const percentage = Math.round((done / total) * 100);

  return { total, done, inProgress, percentage };
}

/**
 * Moves a task to a new status and optionally inserts at a specific position.
 * Re-indexes tasks deterministically.
 */
export function moveTask(
  tasks: Task[],
  taskId: string,
  targetStatus: KanbanStatus,
  targetIndex?: number
): Task[] {
  const taskToMove = tasks.find(t => t.id === taskId);
  if (!taskToMove) return tasks;

  // Filter out the moving task
  const otherTasks = tasks.filter(t => t.id !== taskId);

  // Separate tasks in the target status column from others
  const columnTasks = otherTasks
    .filter(t => t.status === targetStatus)
    .sort((a, b) => a.order - b.order);

  const updatedTask: Task = {
    ...taskToMove,
    status: targetStatus,
    updatedAt: new Date().toISOString()
  };

  // Determine insertion index
  let insertAt = typeof targetIndex === 'number' ? targetIndex : columnTasks.length;
  if (insertAt < 0) insertAt = 0;
  if (insertAt > columnTasks.length) insertAt = columnTasks.length;

  columnTasks.splice(insertAt, 0, updatedTask);

  // Re-assign sequential order for tasks in this column
  const reorderedColumnTasks = columnTasks.map((t, index) => ({
    ...t,
    order: index
  }));

  // Rebuild whole array
  const remainingTasks = otherTasks.filter(t => t.status !== targetStatus);
  return [...remainingTasks, ...reorderedColumnTasks];
}

/**
 * Filters tasks according to search, feature, priority, and status criteria
 */
export function filterTasks(tasks: Task[], filters: KanbanFilters): Task[] {
  return tasks.filter(task => {
    // Search match
    if (filters.search.trim()) {
      const q = filters.search.toLowerCase().trim();
      const matchTitle = task.title.toLowerCase().includes(q);
      const matchDesc = task.description.toLowerCase().includes(q);
      const matchTags = task.tags.some(tag => tag.toLowerCase().includes(q));
      if (!matchTitle && !matchDesc && !matchTags) return false;
    }

    // Feature filter
    if (filters.featureId !== 'All' && task.featureId !== filters.featureId) {
      return false;
    }

    // Priority filter
    if (filters.priority !== 'All' && task.priority !== filters.priority) {
      return false;
    }

    // Status filter
    if (filters.status !== 'All' && task.status !== filters.status) {
      return false;
    }

    // Tag filter
    if (filters.tag && !task.tags.includes(filters.tag)) {
      return false;
    }

    return true;
  });
}

/**
 * Computes diagnostic workflow metrics, detects bottlenecks and WIP limits
 */
export function calculateWorkflowMetrics(tasks: Task[]): WorkflowMetrics {
  const totalTasks = tasks.length;
  const completedTasks = tasks.filter(t => t.status === 'Done').length;
  const donePercentage = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
  const wipCount = tasks.filter(t => t.status === 'In Progress').length;
  const reviewQueueCount = tasks.filter(t => t.status === 'Review').length;

  const priorityCounts: Record<TaskPriority, number> = {
    Critical: 0,
    High: 0,
    Medium: 0,
    Low: 0
  };

  const statusCounts: Record<KanbanStatus, number> = {
    Backlog: 0,
    'To Do': 0,
    'In Progress': 0,
    Review: 0,
    Done: 0
  };

  for (const t of tasks) {
    if (priorityCounts[t.priority] !== undefined) {
      priorityCounts[t.priority]++;
    }
    if (statusCounts[t.status] !== undefined) {
      statusCounts[t.status]++;
    }
  }

  const bottlenecks: string[] = [];
  if (reviewQueueCount >= 4) {
    bottlenecks.push(`Review column is congested (${reviewQueueCount} tasks awaiting code review/QA).`);
  }
  if (wipCount >= 5) {
    bottlenecks.push(`High Work-in-Progress limit reached (${wipCount} active items). Consider finishing before starting new tasks.`);
  }
  if (priorityCounts.Critical > 0 && tasks.some(t => t.priority === 'Critical' && t.status === 'Backlog')) {
    bottlenecks.push(`There are Critical priority tasks idling in the Backlog.`);
  }

  return {
    totalTasks,
    completedTasks,
    donePercentage,
    wipCount,
    reviewQueueCount,
    bottlenecks,
    priorityCounts,
    statusCounts
  };
}

/**
 * Extracts JSON payload cleanly from LLM response text, accounting for markdown blocks.
 */
export function parseCopilotResponse<T>(rawText: string, fallback: T): T {
  if (!rawText) return fallback;
  try {
    // Check if wrapped in ```json ... ``` or ``` ... ```
    const codeBlockMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    const cleaned = codeBlockMatch ? codeBlockMatch[1] : rawText.trim();
    return JSON.parse(cleaned) as T;
  } catch {
    // Attempt relaxed regex search for first array or object
    try {
      const jsonCandidate = rawText.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
      if (jsonCandidate) {
        return JSON.parse(jsonCandidate[0]) as T;
      }
    } catch {
      // Fallback
    }
    return fallback;
  }
}
