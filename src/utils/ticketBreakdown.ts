import type { TaskBreakdownTicket } from '../../shared/types/taskBreakdown';

export function selectedBreakdownTasks(tasks: (TaskBreakdownTicket & { selected: boolean })[]) {
  const selected = tasks.filter((task) => task.selected);
  if (!selected.length) throw new Error('Please select at least one task to add to the board.');
  const ids = new Set(selected.map((task) => task.id));
  for (const task of selected) {
    if (task.dependsOn.some((id) => !ids.has(id))) {
      throw new Error(`Select all prerequisites of "${task.title}" before saving.`);
    }
  }
  return selected.map((task) => ({
    ...task,
    description: [
      task.description,
      `## Code impact\n\n${task.impactAnalysis}`,
      ...(task.dependsOn.length ? [`## Prerequisites\n\n${task.dependsOn.map((id) =>
        `- ${selected.find((candidate) => candidate.id === id)!.title}`).join('\n')}`] : []),
    ].join('\n\n'),
  }));
}
