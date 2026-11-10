import test from 'node:test';
import assert from 'node:assert/strict';
import { taskBreakdownResultSchema, type TaskBreakdownTicket } from './taskBreakdown';

const ticket: TaskBreakdownTicket = {
  id: 'export', title: 'Export selected records', description: 'Preserve ordering.',
  priority: 'Medium', dependsOn: [], acceptanceCriteria: ['Rows retain selection order.'],
  subtasks: ['Add coverage', 'Implement export'], suggestedWorkflow: 'Verify ordering.',
  estimatedStoryPoints: 3, suggestedTags: ['export'], impactAnalysis: 'Sources not yet verified.',
};
const proposal = { kind: 'proposal', graphAvailable: false, summary: 'Two slices', impactAnalysis: 'No repository',
  openQuestions: [], tasks: [ticket, { ...ticket, id: 'download', dependsOn: ['export'] }] };

test('breakdown contracts reject missing, repeated, self, cyclic and forward prerequisites', () => {
  assert.equal(taskBreakdownResultSchema.safeParse(proposal).success, true);
  for (const tasks of [
    [ticket, ticket],
    [ticket, { ...ticket, id: 'download', dependsOn: ['missing'] }],
    [{ ...ticket, dependsOn: ['export'] }],
    [{ ...ticket, dependsOn: ['download'] }, { ...ticket, id: 'download', dependsOn: ['export'] }],
    [ticket, { ...ticket, id: 'download', dependsOn: ['export', 'export'] }],
    [], Array.from({ length: 21 }, (_, index) => ({ ...ticket, id: `ticket-${index}` })),
  ]) assert.equal(taskBreakdownResultSchema.safeParse({ ...proposal, tasks }).success, false);
});

test('breakdown contracts preserve explicit plans and reject malformed ticket content', () => {
  assert.equal(taskBreakdownResultSchema.safeParse({ kind: 'plan', graphAvailable: false, plan: 'Read sources', reason: 'Unclear scope' }).success, true);
  assert.equal(taskBreakdownResultSchema.safeParse({ ...proposal, tasks: [{ ...ticket, acceptanceCriteria: [] }] }).success, false);
});
