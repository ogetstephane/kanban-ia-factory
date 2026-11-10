import test from 'node:test';
import assert from 'node:assert/strict';
import { selectedBreakdownTasks } from './ticketBreakdown';
import type { TaskBreakdownTicket } from '../../shared/types/taskBreakdown';

test('saving a breakdown preserves dependency order and evidence, and refuses excluded prerequisites', () => {
  const first: TaskBreakdownTicket & { selected: boolean } = {
    id: 'first', title: 'First slice', description: 'Scoped work', selected: true,
    priority: 'Medium', dependsOn: [], acceptanceCriteria: ['Observable outcome'],
    subtasks: ['Add tests'], suggestedWorkflow: 'Verify', estimatedStoryPoints: 3,
    suggestedTags: [], impactAnalysis: 'Verified source reference',
  };
  const second = { ...first, id: 'second', title: 'Second slice', dependsOn: ['first'] };
  const selected = selectedBreakdownTasks([first, second]);
  assert.deepEqual(selected.map(({ id }) => id), ['first', 'second']);
  assert.match(selected[1].description, /## Prerequisites\n\n- First slice/);
  assert.match(selected[1].description, /Verified source reference/);
  assert.throws(() => selectedBreakdownTasks([{ ...first, selected: false }, second]), /all prerequisites/);
  assert.throws(() => selectedBreakdownTasks([{ ...first, selected: false }]), /at least one/);
});
