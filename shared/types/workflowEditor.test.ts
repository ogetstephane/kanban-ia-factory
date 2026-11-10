import test from 'node:test';
import assert from 'node:assert/strict';
import { workflowDocumentSchema } from './workflowEditor';
import { documentFixture } from './workflowEditor.fixture';

test('workflow documents validate connected graphs and resource relationships', () => {
  assert.equal(workflowDocumentSchema.safeParse(documentFixture()).success, true);
  const invalid = [
    { nodes: [] },
    { edges: [{ from: 'writer', to: 'missing' }] },
    { edges: [] },
    { edges: [...documentFixture().edges, { from: 'review', to: 'writer' }] },
    { edges: [...documentFixture().edges, { from: 'writer', to: 'writer' }] },
    { edges: [...documentFixture().edges, documentFixture().edges[0]] },
    { agents: [{ ...documentFixture().agents[0], promptId: 'missing' }] },
    { agents: [{ ...documentFixture().agents[0], skillIds: ['missing'] }] },
    { skills: [documentFixture().skills[0], documentFixture().skills[0]] },
    { prompts: [{ ...documentFixture().prompts[0], variables: [] }] },
    { hooks: [{ ...documentFixture().hooks[0], approvalRequired: false }] },
    { hooks: [{ ...documentFixture().hooks[0], script: '' }] },
    { hooks: [{ ...documentFixture().hooks[0], action: 'log' }] },
    { nodes: [{ ...documentFixture().nodes[0], x: Infinity }] },
  ];
  for (const change of invalid) assert.equal(workflowDocumentSchema.safeParse({ ...documentFixture(), ...change }).success, false, JSON.stringify(change));
});

test('workflow documents enforce exact resource and script limits', () => {
  const document = documentFixture();
  const script = 'x'.repeat(20_000);
  const hooks = [{ ...document.hooks[0], script, timeoutMs: 60_000 }];
  assert.equal(workflowDocumentSchema.safeParse({ ...document, hooks }).success, true);
  assert.equal(workflowDocumentSchema.safeParse({ ...document, hooks: [{ ...hooks[0], script: `${script}x` }] }).success, false);
  assert.equal(workflowDocumentSchema.safeParse({ ...document, hooks: [{ ...hooks[0], timeoutMs: 60_001 }] }).success, false);
  const skills = Array.from({ length: 50 }, (_, index) => ({ ...document.skills[0], id: index ? `skill-${index}` : 'skill' }));
  assert.equal(workflowDocumentSchema.safeParse({ ...document, skills }).success, true);
  assert.equal(workflowDocumentSchema.safeParse({ ...document, skills: [...skills, { ...skills[0], id: 'one-more' }] }).success, false);
  assert.equal(workflowDocumentSchema.safeParse({ ...document, skills: skills.map((skill) => ({ ...skill, instructions: 'x'.repeat(50_000) })) }).success, false);
  const nodes = document.nodes.map((node) => node.kind === 'approval' ? { ...node, referenceId: 'hook' } : node);
  assert.equal(workflowDocumentSchema.safeParse({ ...document, nodes }).success, false);
});

test('host operations and labelled resumption cycles require an explicit reference model', () => {
  const original = documentFixture();
  const reference = {
    ...original, hooks: [], runtimeReference: { scope: 'wiki', revision: 1, execution: 'reference-only' },
    operations: [{ id: 'wait', name: 'Wait', category: 'wait', responsibility: 'Wait for approval',
      policy: 'Explicit user action', sources: ['server/wiki/wikiAssistant.ts#WikiAssistant'] }],
    nodes: [original.nodes[0], { ...original.nodes[1], kind: 'host', referenceId: 'wait' }],
    edges: [{ from: 'writer', to: 'check', label: 'Plan ready' }, { from: 'check', to: 'writer', label: 'Explicit approved resubmit' }],
  };
  assert.ok(workflowDocumentSchema.safeParse(reference).success);
  assert.equal(workflowDocumentSchema.safeParse({ ...reference, runtimeReference: undefined }).success, false);
  assert.equal(workflowDocumentSchema.safeParse({ ...reference, operations: [] }).success, false);
  assert.equal(workflowDocumentSchema.safeParse({ ...reference, nodes: original.nodes }).success, false);
  assert.equal(workflowDocumentSchema.safeParse({ ...reference, operations: [...reference.operations, ...reference.operations] }).success, false);
  assert.equal(workflowDocumentSchema.safeParse({ ...reference, operations: [{ ...reference.operations[0], sources: ['https://untrusted.invalid'] }] }).success, false);
  assert.equal(workflowDocumentSchema.safeParse({ ...original, agents: [{ ...original.agents[0], promptVariants: [{ when: 'alternate', promptId: 'missing' }] }] }).success, false);
});
