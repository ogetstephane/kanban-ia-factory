import test from 'node:test';
import assert from 'node:assert/strict';
import type { Subtask } from '../../shared/types/kanban';
import type { TaskDraftResult } from '../../shared/types/taskDraft';
import { applyTaskSpec } from './useTaskAutoSpec';

test('a generated specification fills the task form and leaves fields it does not propose untouched', () => {
  const applied: Record<string, unknown> = {};
  const fields = {
    setDescription: (value: string) => { applied.description = value; },
    setAcceptanceCriteria: (value: string[]) => { applied.acceptanceCriteria = value; },
    setSubtasks: (value: Subtask[]) => { applied.subtasks = value; },
    setSuggestedWorkflow: (value: string) => { applied.suggestedWorkflow = value; },
    setStoryPoints: (value: number) => { applied.storyPoints = value; },
    setTagsInput: (value: string) => { applied.tagsInput = value; },
  };
  const result: TaskDraftResult = {
    title: 'Add token revocation',
    description: 'Revoke tokens on logout.',
    acceptanceCriteria: ['Revoked tokens are rejected'],
    subtasks: ['Add endpoint', 'Add tests'],
    suggestedWorkflow: 'TDD',
    estimatedStoryPoints: 5,
    suggestedTags: ['auth', 'api'],
    impactAnalysis: 'Touches the auth router.',
    graphAvailable: true,
  };

  applyTaskSpec(result, fields);
  assert.equal(applied.description, 'Revoke tokens on logout.');
  assert.deepEqual(applied.acceptanceCriteria, ['Revoked tokens are rejected']);
  const subtasks = applied.subtasks as Subtask[];
  assert.deepEqual(subtasks.map(({ text, completed }) => ({ text, completed })), [
    { text: 'Add endpoint', completed: false },
    { text: 'Add tests', completed: false },
  ]);
  assert.ok(subtasks.every((subtask) => subtask.id.startsWith('copilot-st-')));
  assert.equal(new Set(subtasks.map((subtask) => subtask.id)).size, subtasks.length);
  assert.equal(applied.suggestedWorkflow, 'TDD');
  assert.equal(applied.storyPoints, 5);
  assert.equal(applied.tagsInput, 'auth, api');

  delete applied.tagsInput;
  applyTaskSpec({ ...result, suggestedTags: [] }, fields);
  assert.equal('tagsInput' in applied, false);
});
