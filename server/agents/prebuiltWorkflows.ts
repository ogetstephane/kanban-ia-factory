import { workflowDocumentSchema, WORKFLOW_SCOPE_NAMES, type WorkflowDocument, type WorkflowPhase, type WorkflowScope } from '../../shared/types/workflowEditor';
import { loadWorkflowSkills } from './workflowEditorDefaults';

export async function prebuiltWorkflow(scope: WorkflowScope): Promise<WorkflowDocument> {
  const skills = await loadWorkflowSkills(scope === 'ticket-authoring'
    ? ['ticket-framing', 'ticket-graphify', 'ticket-writing', 'ticket-decomposition', 'ticket-quality', 'assistant-planning']
    : scope === 'releases' ? [] : scope === 'wiki' ? ['assistant-planning'] : ['ticket-graphify']);
  const document: WorkflowDocument = {
    schemaVersion: 1, name: `${WORKFLOW_SCOPE_NAMES[scope]} · prebuilt workflow`,
    description: 'Editable execution graph converted from the bundled skill procedures. Connections determine order and pass predecessor results. Host security, output validation and human approvals are always enforced.',
    execution: { scope, revision: 1 }, skills, prompts: [], agents: [], hooks: [], nodes: [], edges: [],
  };
  const step = (id: string, name: string, prompt: string, skillIds: string[], phases: WorkflowPhase[], output: 'context' | 'result', access: 'read-only' | 'phase' = 'read-only') => {
    document.prompts.push({ id: `${id}-prompt`, name: `${name} prompt`, template: prompt, variables: [] });
    document.agents.push({ id, name, role: prompt, promptId: `${id}-prompt`, skillIds,
      provider: scope === 'ticket-processing' ? 'inherit' : 'copilot', model: '', autonomy: 'semi', tools: [], maxIterations: 'runtime-managed' });
    const index = document.nodes.length;
    document.nodes.push({ id, kind: 'agent', label: name, referenceId: id,
      x: 60 + (index % 5) * 290, y: 180 + Math.floor(index / 5) * 200, run: { phases, output, access } });
  };
  if (scope === 'ticket-authoring') {
    step('framing', 'Frame the ticket', 'Clarify intent, outcomes, constraints and missing decisions. Return concise framing context, or the host clarification/plan JSON when confirmation is needed.',
      ['assistant-planning', 'ticket-framing'], ['author'], 'context');
    step('impact', 'Verify code impact', 'Use read-only repository and graph tools to verify likely impact. Distinguish evidence from uncertainty. Return context for the ticket writer, not invented file references.',
      ['ticket-graphify'], ['author'], 'context');
    step('writer', 'Write ticket or breakdown', 'Apply the framing and impact results. Write the ticket or dependency-ordered breakdown requested by the host, using its structured proposal format.',
      ['ticket-writing', 'ticket-decomposition'], ['author'], 'context');
    step('quality', 'Review and return proposal', 'Review the preceding proposal against the original request and approved decisions. Correct omissions, unverifiable claims and dependencies. Return the final host proposal JSON.',
      ['ticket-quality'], ['author'], 'result');
    step('plan-agent', 'Plan ticket authoring', 'Return the host plan JSON describing how to frame, investigate, write and validate this ticket or breakdown. Do not write the proposal before approval.',
      ['assistant-planning', 'ticket-framing'], ['plan'], 'result');
  } else if (scope === 'wiki') {
    step('outline', 'Outline the page', 'Analyze the supplied page, request and attachments. Identify accurate content to preserve and outline the requested changes. Return concise context, not a final page.',
      ['assistant-planning'], ['author'], 'context');
    step('writer', 'Write the Markdown', 'Use the outline and source document to produce the complete proposed Markdown in the host proposal JSON format.',
      [], ['author'], 'context');
    step('quality', 'Verify the wiki proposal', 'Check the proposed page against the source, requested language and attachments. Correct invented facts and omissions. Return the complete final host proposal JSON.',
      [], ['author'], 'result');
    step('plan-agent', 'Plan wiki changes', 'Return only the host plan JSON for the requested page changes and wait for approval.',
      ['assistant-planning'], ['plan'], 'result');
  } else if (scope === 'ticket-processing') {
    step('impact', 'Inspect ticket impact', 'Inspect relevant code and dependencies with read-only tools. Report verified context and risks for the next agent. Do not modify files or submit a plan for approval.',
      ['ticket-graphify'], ['plan', 'execute', 'review'], 'context');
    step('planner', 'Plan implementation', 'Use the impact evidence and ticket requirements to return a concrete implementation and verification plan.',
      [], ['plan'], 'result');
    step('executor', 'Implement the ticket', 'Use the impact context. In adaptive mode decide before writing whether to request plan approval; otherwise implement only the approved plan. Write required documentation and run permitted checks.',
      [], ['execute'], 'result', 'phase');
    step('reviewer', 'Review the current diff', 'Inspect the current token-pinned diff and impact evidence. Return actionable defects only, or explicitly report none. Do not modify files or accept human review.',
      [], ['review'], 'result');
  } else {
    const operations = [
      ['create-tag', 'Create the pinned tag', 'Create the validated release tag on the pinned commit.'],
      ['push-tag', 'Push the release tag', 'Push only the pinned tag to the validated remote.'],
      ['record-publication', 'Record publication', 'Record success only after the remote push is confirmed.'],
      ['release-checkpoint', 'Release checkpoint', 'Verify that the pinned publication target is still current.'],
    ];
    document.operations = operations.map(([id, name, responsibility]) => ({ id, name, responsibility, category: 'operation',
      policy: 'Explicit publication, eligibility checks, project lock and revision/Git target guards are mandatory.',
      sources: ['server/releases/releaseService.ts#ReleaseService'] }));
    document.nodes = operations.slice(0, 3).map(([id, name], index) => ({ id, kind: 'host', label: name, referenceId: id,
      x: 80 + index * 300, y: 180, run: { phases: ['release'], output: index === 2 ? 'result' : 'context', access: 'read-only' } }));
  }
  document.edges = document.nodes.slice(1).map((node, index) => ({ from: document.nodes[index].id, to: node.id }));
  return workflowDocumentSchema.parse(document);
}
