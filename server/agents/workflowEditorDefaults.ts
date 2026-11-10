import { readFile } from 'node:fs/promises';
import { parse as parseYaml } from 'yaml';
import { workflowDocumentSchema, WORKFLOW_SCOPE_NAMES, type WorkflowScope } from '../../shared/types/workflowEditor';

const skillNames = ['ticket-framing', 'ticket-writing', 'ticket-decomposition', 'ticket-quality', 'ticket-graphify', 'assistant-planning'];

export async function workflowEditorDefault(scope: WorkflowScope) {
  const skills = await loadWorkflowSkills(scope === 'ticket-authoring' ? skillNames
    : scope === 'ticket-processing' ? ['ticket-graphify'] : scope === 'wiki' ? ['assistant-planning'] : []);
  return workflowDocumentSchema.parse({
    schemaVersion: 1, name: WORKFLOW_SCOPE_NAMES[scope],
    description: 'Editable design template. Not a complete representation of the current runtime.',
    skills,
    prompts: [{ id: 'main-prompt', name: 'Main prompt', template: 'Process {{request}} within the approved scope. Report evidence and unresolved decisions.', variables: ['request'] }],
    agents: [{ id: 'main-agent', name: 'Main agent', role: 'Work within the requested application scope.',
      promptId: 'main-prompt', skillIds: skills.map((skill) => skill.id), provider: 'inherit', model: '',
      autonomy: 'semi', tools: [], maxIterations: 5 }],
    hooks: [{ id: 'review-hook', name: 'Validate output', event: 'after-agent', action: 'validate',
      script: '', timeoutMs: 5000, approvalRequired: true }],
    nodes: [
      { id: 'agent-step', kind: 'agent', label: 'Main agent', referenceId: 'main-agent', x: 80, y: 120 },
      { id: 'validate-step', kind: 'hook', label: 'Validate output', referenceId: 'review-hook', x: 370, y: 120 },
      { id: 'approval-step', kind: 'approval', label: 'Human review', referenceId: '', x: 660, y: 120 },
    ],
    edges: [{ from: 'agent-step', to: 'validate-step' }, { from: 'validate-step', to: 'approval-step' }],
  });
}

export async function loadWorkflowSkills(names: string[]) {
  return Promise.all(names.map(async (id) => {
    const text = await readFile(new URL(`../skills/${id}/SKILL.md`, import.meta.url), 'utf8');
    const match = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!match) throw new Error(`Invalid bundled skill: ${id}`);
    const metadata: unknown = parseYaml(match[1]);
    if (!metadata || typeof metadata !== 'object' || !('description' in metadata) || typeof metadata.description !== 'string') {
      throw new Error(`Missing bundled skill description: ${id}`);
    }
    return { id, name: id, description: metadata.description, instructions: match[2].trim() };
  }));
}
