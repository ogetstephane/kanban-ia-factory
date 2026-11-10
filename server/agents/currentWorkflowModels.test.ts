import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { builtInWorkflow, currentWorkflowModel, protectedRuntimeShape } from './currentWorkflowModels';
import { workflowDocumentSchema, type RuntimeWorkflowScope } from '../../shared/types/workflowEditor';
import { taskAuthoringInstructions } from './taskAssistant';
import { wikiAuthoringInstructions } from '../wiki/wikiAssistant';
import { ticketSessionInstructions } from './ticketSession';
import { workflowGraphErrors } from '../../shared/utils/workflowGraph';

test('current orchestration models cover actual routing, waits and host policies with verified source evidence', async () => {
  for (const scope of ['ticket-authoring', 'ticket-processing', 'wiki'] satisfies RuntimeWorkflowScope[]) {
    const doc = await currentWorkflowModel(scope);
    assert.ok(workflowDocumentSchema.safeParse(doc).success);
    assert.equal(doc.runtimeReference?.scope, scope);
    assert.equal(doc.runtimeReference?.execution, 'reference-only');
    assert.ok(doc.operations!.every((operation) => operation.policy && operation.sources.length));
    for (const operation of doc.operations!) {
      for (const source of operation.sources) {
        const [file, symbol] = source.split('#');
        await access(file);
        assert.ok((await readFile(file, 'utf8')).includes(symbol), source);
      }
    }
    assert.ok(doc.agents.every((agent) => agent.maxIterations === 'runtime-managed'));
    assert.ok(doc.edges.every((edge) => edge.label));
    assert.equal(doc.hooks.length, 0, 'Host actions must not be presented as inert/custom scripts');
    const edited = structuredClone(doc);
    edited.nodes[0].x += 10;
    edited.nodes[0].label = 'Custom label';
    edited.prompts[0].template = 'Proposed instruction change';
    edited.agents[0].model = 'proposed-model';
    assert.equal(protectedRuntimeShape(edited), protectedRuntimeShape(doc));
    edited.agents[0].tools.push('arbitrary_shell');
    assert.notEqual(protectedRuntimeShape(edited), protectedRuntimeShape(doc));
  }
});

test('assistant reference prompts are assembled from the same functions as production, including variants', async () => {
  const authoring = await currentWorkflowModel('ticket-authoring');
  assert.ok(authoring.prompts[0].template.startsWith(taskAuthoringInstructions(false)));
  assert.ok(authoring.prompts.find((item) => item.id === 'auto-breakdown-prompt')!.template.startsWith(taskAuthoringInstructions(true)));
  assert.deepEqual(authoring.agents[0].promptVariants, [{ when: 'Feature breakdown request', promptId: 'auto-breakdown-prompt' }]);
  assert.ok(authoring.edges.some((edge) => edge.from === 'clarification' && edge.to === 'request'));
  const wiki = await currentWorkflowModel('wiki');
  assert.ok(wiki.prompts[0].template.startsWith(wikiAuthoringInstructions()));
  assert.ok(wiki.agents.every((agent) => agent.tools.length === 0));
  assert.ok(!wiki.nodes.some((node) => node.id === 'clarification'));
  const processing = await currentWorkflowModel('ticket-processing');
  assert.equal(processing.prompts.find((item) => item.id === 'planner-prompt')!.template.split('\n').slice(0, -1).join('\n'),
    ticketSessionInstructions('plan', false, '<host-resolved required ticket documentation path>').join('\n'));
  assert.ok(processing.edges.some((edge) => edge.from === 'plan-gate' && edge.to === 'executor'));
  assert.ok(processing.edges.some((edge) => edge.from === 'retry' && edge.to === 'queue'));
  assert.ok(processing.nodes.some((node) => node.id === 'delivery'));
});

test('all four scopes have executable prebuilt graphs; releases contain no invented AI agent', async () => {
  for (const scope of ['ticket-authoring', 'ticket-processing', 'wiki', 'releases'] as const) {
    const base = await builtInWorkflow(scope);
    assert.equal(base.runtimeReference, undefined);
    assert.equal(base.execution?.scope, scope);
    assert.deepEqual(workflowGraphErrors(base, scope), []);
    assert.ok(workflowDocumentSchema.safeParse(base).success);
  }
  const release = await builtInWorkflow('releases');
  assert.equal(release.agents.length, 0);
  assert.ok(release.nodes.every((node) => node.kind === 'host'));
  assert.ok(release.nodes.some((node) => node.id === 'record-publication'));
  const authoring = await builtInWorkflow('ticket-authoring');
  assert.deepEqual(authoring.agents.flatMap((agent) => agent.skillIds), [
    'assistant-planning', 'ticket-framing', 'ticket-graphify', 'ticket-writing', 'ticket-decomposition', 'ticket-quality', 'assistant-planning', 'ticket-framing',
  ]);
});
