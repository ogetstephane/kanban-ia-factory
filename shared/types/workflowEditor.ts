import { z } from 'zod';

export const WORKFLOW_SCOPES = ['ticket-authoring', 'ticket-processing', 'wiki', 'releases'] as const;
export const workflowScopeSchema = z.enum(WORKFLOW_SCOPES);
export type WorkflowScope = z.infer<typeof workflowScopeSchema>;
export const WORKFLOW_SCOPE_NAMES: Record<WorkflowScope, string> = {
  'ticket-authoring': 'Ticket authoring', 'ticket-processing': 'Ticket processing', wiki: 'Wiki', releases: 'Releases',
};

const id = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
const name = z.string().trim().min(1).max(200);
const content = z.string().trim().min(1).max(50_000);
const ids = z.array(id).max(50).refine((values) => new Set(values).size === values.length, 'References must be unique');
export const workflowPromptSchema = z.object({
  id, name, template: content, variables: z.array(z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]*$/)).max(30),
}).strict();
export const workflowSkillSchema = z.object({
  id, name, description: z.string().trim().min(1).max(1024), instructions: content,
}).strict();
export const workflowAgentSchema = z.object({
  id, name, role: content, promptId: id, skillIds: ids,
  provider: z.enum(['inherit', 'copilot', 'claude-code', 'codex']),
  model: z.string().trim().max(200),
  autonomy: z.enum(['manual', 'semi', 'autonomous']),
  tools: z.array(z.string().trim().min(1).max(100)).max(50),
  maxIterations: z.number().int().min(1).max(100),
}).strict();
export const workflowHookSchema = z.object({
  id, name,
  event: z.enum(['before-workflow', 'before-agent', 'after-agent', 'after-workflow', 'on-error']),
  action: z.enum(['validate', 'approval', 'log', 'script']),
  script: z.string().max(20_000),
  timeoutMs: z.number().int().min(100).max(60_000),
  approvalRequired: z.literal(true),
}).strict().superRefine((hook, ctx) => {
  if (hook.action === 'script' && !hook.script.trim()) ctx.addIssue({ code: 'custom', path: ['script'], message: 'A script hook needs a script' });
  if (hook.action !== 'script' && hook.script) ctx.addIssue({ code: 'custom', path: ['script'], message: 'Only script hooks may contain a script' });
});
export const workflowNodeSchema = z.object({
  id, kind: z.enum(['agent', 'hook', 'approval']), label: name, referenceId: z.string().max(64),
  x: z.number().finite().min(0).max(3000), y: z.number().finite().min(0).max(2000),
}).strict();
export const workflowDocumentSchema = z.object({
  schemaVersion: z.literal(1), name, description: z.string().max(5000),
  prompts: z.array(workflowPromptSchema).max(50),
  skills: z.array(workflowSkillSchema).max(50),
  agents: z.array(workflowAgentSchema).max(50),
  hooks: z.array(workflowHookSchema).max(50),
  nodes: z.array(workflowNodeSchema).min(1).max(100),
  edges: z.array(z.object({ from: id, to: id }).strict()).max(200),
}).strict().superRefine((doc, ctx) => {
  for (const key of ['prompts', 'skills', 'agents', 'hooks', 'nodes'] as const) {
    if (new Set(doc[key].map((item) => item.id)).size !== doc[key].length) {
      ctx.addIssue({ code: 'custom', path: [key], message: 'IDs must be unique within each collection' });
    }
  }
  const check = (found: boolean, path: (string | number)[]) => {
    if (!found) ctx.addIssue({ code: 'custom', path, message: 'Referenced definition does not exist' });
  };
  for (const [i, agent] of doc.agents.entries()) {
    check(doc.prompts.some((prompt) => prompt.id === agent.promptId), ['agents', i, 'promptId']);
    agent.skillIds.forEach((skillId, j) => check(doc.skills.some((skill) => skill.id === skillId), ['agents', i, 'skillIds', j]));
  }
  for (const [i, prompt] of doc.prompts.entries()) {
    const variables = [...prompt.template.matchAll(/\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g)].map((match) => match[1]);
    if (new Set(prompt.variables).size !== prompt.variables.length || variables.some((variable) => !prompt.variables.includes(variable))) {
      ctx.addIssue({ code: 'custom', path: ['prompts', i, 'variables'], message: 'Declare each template variable once' });
    }
  }
  doc.nodes.forEach((node, i) => {
    if (node.kind === 'agent') check(doc.agents.some((agent) => agent.id === node.referenceId), ['nodes', i, 'referenceId']);
    if (node.kind === 'hook') check(doc.hooks.some((hook) => hook.id === node.referenceId), ['nodes', i, 'referenceId']);
    if (node.kind === 'approval' && node.referenceId) ctx.addIssue({ code: 'custom', path: ['nodes', i, 'referenceId'], message: 'Approval nodes have no definition reference' });
  });
  const nodes = new Set(doc.nodes.map((node) => node.id));
  const edges = new Set<string>();
  const adjacency = new Map(doc.nodes.map((node) => [node.id, [] as string[]]));
  doc.edges.forEach((edge, i) => {
    check(nodes.has(edge.from) && nodes.has(edge.to), ['edges', i]);
    const key = `${edge.from}:${edge.to}`;
    if (edges.has(key) || edge.from === edge.to) ctx.addIssue({ code: 'custom', path: ['edges', i], message: 'Duplicate or self edge' });
    edges.add(key);
    adjacency.get(edge.from)?.push(edge.to);
  });
  const visiting = new Set<string>(), visited = new Set<string>();
  const cycle = (node: string): boolean => {
    if (visiting.has(node)) return true;
    if (visited.has(node)) return false;
    visiting.add(node);
    if ((adjacency.get(node) ?? []).some(cycle)) return true;
    visiting.delete(node); visited.add(node);
    return false;
  };
  if ([...nodes].some(cycle)) ctx.addIssue({ code: 'custom', path: ['edges'], message: 'Workflow cycles are not supported' });
  if (doc.nodes.length > 1) {
    const reached = new Set<string>();
    const walk = (node: string) => {
      if (reached.has(node)) return;
      reached.add(node);
      doc.edges.filter((edge) => edge.from === node || edge.to === node).forEach((edge) => walk(edge.from === node ? edge.to : edge.from));
    };
    walk(doc.nodes[0].id);
    if (reached.size !== nodes.size) ctx.addIssue({ code: 'custom', path: ['edges'], message: 'All workflow nodes must be connected' });
  }
  if (JSON.stringify(doc).length > 500_000) ctx.addIssue({ code: 'custom', message: 'Workflow exceeds 500,000 characters' });
});

export type WorkflowDocument = z.infer<typeof workflowDocumentSchema>;
export type WorkflowNode = z.infer<typeof workflowNodeSchema>;
export type WorkflowAgent = z.infer<typeof workflowAgentSchema>;
export type WorkflowHook = z.infer<typeof workflowHookSchema>;
export const workflowVersionSchema = z.object({
  id: z.string(), number: z.number().int(), createdAt: z.string(), document: workflowDocumentSchema,
});
export const workflowEditorStateSchema = z.object({
  scope: workflowScopeSchema, revision: z.number().int().nonnegative(),
  draft: workflowDocumentSchema, selectedVersionId: z.string().nullable(),
  versions: z.array(workflowVersionSchema),
});
export type WorkflowEditorState = z.infer<typeof workflowEditorStateSchema>;
