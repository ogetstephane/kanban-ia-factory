import type { WorkflowNode, WorkflowPhase, WorkflowRuntimeSnapshot } from '../../shared/types/workflowEditor';
import { orderedWorkflowNodes, workflowGraphErrors } from '../../shared/utils/workflowGraph';
import { RepositoryError } from '../git/repositoryService';

export async function runWorkflowGraph(
  snapshot: WorkflowRuntimeSnapshot, phase: WorkflowPhase,
  execute: (node: WorkflowNode, inputs: Record<string, string>) => Promise<string>,
  signal?: AbortSignal,
): Promise<string> {
  const { document } = snapshot;
  const errors = workflowGraphErrors(document, snapshot.scope);
  if (errors.length) throw new RepositoryError(422, errors.join(' '));
  const outputs = new Map<string, string>();
  const inherited = new Map<string, Set<string>>();
  let result: string | undefined;
  let size = 0;
  for (const node of orderedWorkflowNodes(document)) {
    signal?.throwIfAborted();
    const parents = document.edges.filter((edge) => edge.to === node.id).map((edge) => edge.from);
    const inputIds = new Set(parents.flatMap((id) => outputs.has(id) ? [id] : [...inherited.get(id) ?? []]));
    inherited.set(node.id, inputIds);
    if (!node.run?.phases.includes(phase)) continue;
    const inputs = Object.fromEntries([...inputIds].map((id) => [id, outputs.get(id)!]));
    const output = await execute(node, inputs);
    signal?.throwIfAborted();
    if (!output.trim()) throw new RepositoryError(502, `Workflow step "${node.label}" returned no result.`);
    size += Buffer.byteLength(output);
    if (Buffer.byteLength(output) > 256_000 || size > 1_000_000) throw new RepositoryError(413, 'Workflow output exceeded its context budget. Reduce the workflow scope; no output was truncated.');
    outputs.set(node.id, output);
    if (phase === 'author' || phase === 'plan') {
      let control: unknown;
      try { control = JSON.parse(output); } catch { /* Intermediate context may be plain text. */ }
      if (control && typeof control === 'object' && 'kind' in control && ['plan', 'clarification'].includes(String(control.kind))) return output;
    }
    if (node.run.output === 'result') result = output;
  }
  if (result === undefined) throw new RepositoryError(422, `Workflow has no result for phase ${phase}.`);
  return result;
}
