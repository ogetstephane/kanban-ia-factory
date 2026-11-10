import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clarificationContext, ticketClarificationSchema, ticketClarificationAnswersSchema,
} from './ticketClarification';
import { taskDraftInputSchema, taskDraftResultSchema } from './taskDraft';
import { taskBreakdownResultSchema } from './taskBreakdown';

const clarification = { kind: 'clarification', reason: 'Missing scope', questions: ['Which format?'], graphAvailable: false };

test('single-ticket and breakdown contracts accept bounded clarification responses', () => {
  for (const schema of [taskDraftResultSchema, taskBreakdownResultSchema]) {
    assert.deepEqual(schema.parse(clarification), clarification);
    for (const questions of [[], [' '], ['Format?', 'format?'], Array(6).fill('Which format?'), ['x'.repeat(2001)]]) {
      assert.equal(schema.safeParse({ ...clarification, questions }).success, false);
    }
    assert.equal(schema.safeParse({ ...clarification, reason: ' ' }).success, false);
  }
  assert.equal(ticketClarificationSchema.safeParse({
    ...clarification, questions: Array.from({ length: 5 }, (_, i) => `${i}${'x'.repeat(1999)}`), reason: 'x'.repeat(2000),
  }).success, true);
});

test('answers are bounded, trimmed structured reference data, not a plan approval', () => {
  const answers = [{ question: ' Which format? ', answer: ' CSV ' }];
  const input = taskDraftInputSchema.parse({ title: 'Export', clarificationAnswers: answers });
  assert.deepEqual(input.clarificationAnswers, [{ question: 'Which format?', answer: 'CSV' }]);
  assert.equal(input.approvedPlan, undefined);
  for (const invalid of [[], [{ question: '', answer: 'CSV' }], [{ question: 'Format?', answer: ' ' }],
    [{ question: 'Format?', answer: 'x'.repeat(4001) }], Array(6).fill(answers[0])]) {
    assert.equal(ticketClarificationAnswersSchema.safeParse(invalid).success, false);
  }
  assert.equal(ticketClarificationAnswersSchema.safeParse([{ question: 'Format?', answer: 'x'.repeat(4000) }]).success, true);
  assert.equal(clarificationContext(input.clarificationAnswers), '## Clarifications\n\n### Which format?\n\nCSV');
  assert.equal(clarificationContext(), '');
});
