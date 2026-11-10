import test from 'node:test';
import assert from 'node:assert/strict';
import { assessTicketBreakdown, assessTicketProposal } from './ticketProposalQuality';
import { taskDraftProposalSchema } from '../types/taskDraft';

const ticket = {
  title: 'Export selected records', description: 'Export the selection without changing its order.',
  acceptanceCriteria: ['Rows retain selection order.', 'An empty selection produces only the header.'],
  subtasks: ['Cover ordering and empty selection', 'Implement export', 'Document the format'],
  suggestedWorkflow: 'Run the existing exporter tests.', estimatedStoryPoints: 3,
  suggestedTags: ['export'], impactAnalysis: 'Source inspection is still required.', openQuestions: [],
};
const first = { ...ticket, id: 'format', priority: 'Medium', dependsOn: [] };
const second = { ...first, id: 'download', title: 'Download the export',
  description: 'Allow downloading the prepared export.', dependsOn: ['format'] };
const breakdown = {
  summary: 'Format then download', impactAnalysis: 'Candidate impacts, not verified evidence.',
  openQuestions: [], tasks: [first, second],
};

test('offline scenarios distinguish declared ambiguity from reviewable bug and bounded feature proposals', () => {
  const scenarios = [
    { need: 'Improve exports', proposal: { ...ticket, openQuestions: ['Which format and users are in scope?'] },
      expected: 'needs-clarification' },
    { need: 'Empty selection crashes export', proposal: { ...ticket, title: 'Fix empty export',
      description: 'Return the documented header rather than throwing for an empty selection.' },
      expected: 'ready-for-review' },
    { need: 'Export selected rows in selection order', proposal: ticket, expected: 'ready-for-review' },
  ];
  for (const scenario of scenarios) {
    assert.equal(assessTicketProposal(scenario.proposal).status, scenario.expected, scenario.need);
  }
  assert.deepEqual(assessTicketBreakdown(breakdown), { status: 'ready-for-review', issues: [] });
});

test('required fields and dependency validation reuse the canonical proposal schemas', () => {
  for (const invalid of [
    null, {}, { ...ticket, title: ' ' }, { ...ticket, description: '' },
    { ...ticket, acceptanceCriteria: [] }, { ...ticket, subtasks: [' '] },
    { ...ticket, suggestedWorkflow: '' }, { ...ticket, impactAnalysis: '' },
    { ...ticket, estimatedStoryPoints: 13 },
  ]) {
    const report = assessTicketProposal(invalid);
    assert.equal(report.status, 'needs-clarification');
    assert.ok(report.issues.every((issue) => issue.code === 'invalid-structure'));
  }
  for (const tasks of [
    [], [first, first], [second], [{ ...first, dependsOn: ['format'] }],
    [{ ...first, dependsOn: ['download'] }, second],
    [first, { ...second, dependsOn: ['format', 'format'] }],
    Array.from({ length: 21 }, (_, index) => ({ ...first, id: `ticket-${index}` })),
  ]) {
    const report = assessTicketBreakdown({ ...breakdown, tasks });
    assert.equal(report.status, 'needs-clarification');
    assert.ok(report.issues.some((issue) => issue.code === 'invalid-structure'));
  }
});

test('exact repeated text is reported with field paths, without rejecting the draft or guessing semantic duplicates', () => {
  const repeated = { ...ticket, acceptanceCriteria: ['Rows retain order', '  ROWS  retain\norder '],
    subtasks: ['Check export', 'Check export'] };
  assert.equal(taskDraftProposalSchema.safeParse(repeated).success, true);
  const report = assessTicketProposal(repeated);
  assert.deepEqual(report.issues.map((issue) => [issue.code, issue.path]),
    [['duplicate', 'acceptanceCriteria.1'], ['duplicate', 'subtasks.1']]);
  const split = assessTicketBreakdown({ ...breakdown, tasks: [first, { ...second, title: first.title, description: first.description }] });
  assert.deepEqual(split.issues.map((issue) => issue.path), ['tasks.1.title', 'tasks.1.description']);
  assert.equal(assessTicketProposal({ ...ticket, acceptanceCriteria: ['Rows retain order', 'The selection order is preserved'] }).status,
    'ready-for-review', 'Semantic equivalence requires human review');
});

test('open decisions are explicit at proposal and ticket level; review readiness is not execution approval', () => {
  const report = assessTicketBreakdown({
    ...breakdown, openQuestions: ['Confirm the limit'],
    tasks: [first, { ...second, openQuestions: ['Which filename?'] }],
  });
  assert.deepEqual(report.issues.map((issue) => [issue.path, issue.message]),
    [['openQuestions.0', 'Confirm the limit'], ['tasks.1.openQuestions.0', 'Which filename?']]);
  const { openQuestions, ...legacy } = ticket;
  assert.equal(assessTicketProposal(legacy).status, 'ready-for-review');
  assert.equal(assessTicketProposal({ ...ticket, graphAvailable: false }).status, 'ready-for-review',
    'Graph availability is not proof of source evidence or a quality gate');
  assert.equal(assessTicketProposal({ ...ticket, title: 'Improve things', description: 'Make it better.',
    acceptanceCriteria: ['Works correctly'] }).status, 'ready-for-review',
  'Structural checks deliberately cannot establish business completeness or measurable outcomes');
});

test('breakdown reports enforce exact ticket and serialized proposal limits', () => {
  const maximumTickets = {
    ...breakdown, tasks: Array.from({ length: 20 }, (_, index) => ({
      ...first, id: `ticket-${index}`, title: `Slice ${index}`, description: `Outcome ${index}`,
    })),
  };
  assert.equal(assessTicketBreakdown(maximumTickets).status, 'ready-for-review');
  const maximumSize = {
    ...breakdown, tasks: Array.from({ length: 4 }, (_, index) => ({
      ...first, id: `ticket-${index}`, title: `Slice ${index}`,
      description: index === 3 ? 'D' : String(index).repeat(40_000),
    })),
  };
  maximumSize.tasks[3].description = 'D'.repeat(150_000 - JSON.stringify(maximumSize).length + 1);
  assert.equal(JSON.stringify(maximumSize).length, 150_000);
  assert.equal(assessTicketBreakdown(maximumSize).status, 'ready-for-review');
  maximumSize.tasks[3].description += 'D';
  const oversized = assessTicketBreakdown(maximumSize);
  assert.equal(oversized.status, 'needs-clarification');
  assert.ok(oversized.issues.some((issue) => /150,000/.test(issue.message)));
});
