import type { WorkflowDocument, WorkflowNode, WorkflowPhase, WorkflowScope } from '../types/workflowEditor';

export const workflowPhases = (scope: WorkflowScope): WorkflowPhase[] =>
  scope === 'ticket-processing' ? ['plan', 'execute', 'review'] : scope === 'releases' ? ['release'] : ['author', 'plan'];

export function orderedWorkflowNodes(document: WorkflowDocument): WorkflowNode[] {
  const pending = new Map(document.nodes.map((node) => [node.id, node]));
  const completed = new Set<string>();
  const ordered: WorkflowNode[] = [];
  while (pending.size) {
    const ready = [...pending.values()].filter((node) =>
      document.edges.filter((edge) => edge.to === node.id).every((edge) => completed.has(edge.from)));
    if (!ready.length) throw new Error('Workflow contains a cycle or a missing predecessor.');
    for (const node of ready) {
      ordered.push(node); completed.add(node.id); pending.delete(node.id);
    }
  }
  return ordered;
}

export function workflowGraphErrors(document: WorkflowDocument, scope: WorkflowScope): string[] {
  if (!document.execution || document.execution.scope !== scope || document.runtimeReference) return ['An executable workflow must match its application scope.'];
  const errors: string[] = [];
  let ordered: WorkflowNode[];
  try { ordered = orderedWorkflowNodes(document); } catch (error) { return [error instanceof Error ? error.message : 'Invalid graph.']; }
  const ancestors = new Map<string, Set<string>>();
  for (const node of ordered) {
    const parents = document.edges.filter((edge) => edge.to === node.id).map((edge) => edge.from);
    ancestors.set(node.id, new Set(parents.flatMap((id) => [id, ...ancestors.get(id) ?? []])));
    if (!node.run) errors.push(`Step "${node.label}" needs execution settings.`);
    if (node.run?.output === 'context' && node.run.access !== 'read-only') errors.push(`Context step "${node.label}" must be read-only; only the execution result step may write.`);
    if (node.run?.phases.some((phase) => !workflowPhases(scope).includes(phase))) errors.push(`Step "${node.label}" uses an unsupported phase.`);
    if (scope === 'releases') {
      if (node.run?.access !== 'read-only') errors.push('Release host operations must retain their registered permission policy.');
      if (node.kind !== 'host' || !['create-tag', 'push-tag', 'record-publication', 'release-checkpoint'].includes(node.referenceId)) {
        errors.push('Release graphs accept only registered release host operations.');
      }
    } else if (node.kind !== 'agent') {
      errors.push('Agent graphs accept agent steps only; human approvals and persistence stay enforced by the host.');
    }
  }
  for (const phase of workflowPhases(scope)) {
    const nodes = ordered.filter((node) => node.run?.phases.includes(phase));
    const results = nodes.filter((node) => node.run?.output === 'result');
    if (results.length !== 1) { errors.push(`${phase}: choose exactly one result step.`); continue; }
    const result = results[0];
    if (nodes.some((node) => node.id !== result.id && !ancestors.get(result.id)?.has(node.id))) {
      errors.push(`${phase}: every step must feed the result step through connections.`);
    }
    if (scope === 'ticket-processing' && phase === 'execute' && result.run?.access !== 'phase') {
      errors.push('The execution result step must use phase tools to allow implementation.');
    }
  }
  for (const agent of document.agents) {
    if (agent.promptVariants?.length) errors.push(`Agent "${agent.name}" must use separate workflow steps instead of legacy prompt variants.`);
    if (scope === 'ticket-processing' ? agent.provider !== 'inherit' : !['inherit', 'copilot'].includes(agent.provider)) errors.push(`Agent "${agent.name}" uses an unsupported provider.`);
    if (agent.autonomy !== 'semi' || agent.maxIterations !== 'runtime-managed') errors.push(`Agent "${agent.name}" must retain host-managed autonomy and iteration limits.`);
    if (agent.tools.length) errors.push(`Agent "${agent.name}" must use the phase tool policy, not a custom tool list.`);
  }
  if (document.prompts.some((prompt) => prompt.variables.length)) errors.push('Executable prompts receive request and predecessor data from the host; template variables are not supported.');
  if (scope === 'releases') {
    let previous: WorkflowNode | undefined;
    for (const operation of ['create-tag', 'push-tag', 'record-publication']) {
      const matches = ordered.filter((node) => node.referenceId === operation);
      if (matches.length !== 1) { errors.push(`Release graphs require exactly one ${operation} step.`); continue; }
      if (previous && !ancestors.get(matches[0].id)?.has(previous.id)) errors.push('Release operations must connect create-tag → push-tag → record-publication.');
      previous = matches[0];
    }
    const record = ordered.find((node) => node.referenceId === 'record-publication');
    if (record?.run?.output !== 'result') errors.push('Record publication must be the release result step.');
  }
  return [...new Set(errors)];
}
