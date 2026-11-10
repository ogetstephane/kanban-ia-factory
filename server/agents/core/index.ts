import { z } from 'zod';
import { immutable, snapshotId, type DeepReadonly } from './snapshot';

const definitionIdSchema = z.string().regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/);
const sourceSchema = z.object({
  uri: z.string().min(1),
  sha256: z.string().regex(/^[a-f\d]{64}$/i),
  trust: z.enum(['managed', 'project']),
});
const metadataSchema = z.object({
  schemaVersion: z.literal(1),
  id: definitionIdSchema,
  version: z.string().min(1),
  description: z.string().min(1),
  source: sourceSchema,
});
const conditionsSchema = z.object({
  paths: z.array(z.string().min(1)).optional(),
  taskKinds: z.array(z.string().min(1)).optional(),
  agentIds: z.array(definitionIdSchema).optional(),
});

export const instructionDefinitionSchema = metadataSchema.extend({
  scope: z.enum(['global', 'project', 'agent']),
  content: z.string().min(1),
  priority: z.number().int(),
  appliesWhen: conditionsSchema.optional(),
  conflictKey: z.string().min(1).optional(),
  replaces: z.array(definitionIdSchema).optional(),
}).superRefine((definition, context) => {
  if (definition.scope === 'agent' && !definition.appliesWhen?.agentIds?.length) {
    context.addIssue({
      code: 'custom',
      path: ['appliesWhen', 'agentIds'],
      message: 'Agent-scoped instructions must name at least one agent.',
    });
  }
});

const skillResourceSchema = z.object({
  path: z.string().min(1).refine(
    (resourcePath) => !resourcePath.startsWith('/')
      && !/^[a-z]:/i.test(resourcePath)
      && !resourcePath.split(/[\\/]/).includes('..'),
    'Skill resource paths must stay inside their skill directory.',
  ),
  kind: z.enum(['reference', 'script', 'asset']),
  sha256: z.string().regex(/^[a-f\d]{64}$/i),
});
export const skillDefinitionSchema = metadataSchema.extend({
  name: z.string().min(1).max(64).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  description: z.string().min(1).max(1024),
  entrypoint: z.literal('SKILL.md'),
  instructions: z.string().min(1),
  resources: z.array(skillResourceSchema),
  activation: z.object({
    mode: z.enum(['required', 'on-demand']),
    taskKinds: z.array(z.string().min(1)).optional(),
  }),
  dependencies: z.array(definitionIdSchema),
  requiredTools: z.array(z.string().min(1)),
});

const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() => z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
  z.null(),
  z.array(jsonValueSchema),
  z.record(z.string(), jsonValueSchema),
]));
const outputContractSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text') }),
  z.object({ kind: z.literal('json'), schema: z.record(z.string(), jsonValueSchema) }),
]);
export const promptDefinitionSchema = metadataSchema.extend({
  template: z.string().min(1),
  variablesSchema: z.record(z.string(), jsonValueSchema),
  output: outputContractSchema,
});

const budgetLimitsSchema = z.object({
  maxInputTokens: z.number().int().positive().optional(),
  maxOutputTokens: z.number().int().positive().optional(),
  maxCost: z.object({
    currency: z.literal('USD'),
    micros: z.number().int().positive(),
  }).optional(),
  maxToolCalls: z.number().int().nonnegative(),
  maxDurationMs: z.number().int().positive(),
  maxAgentTurns: z.number().int().positive().optional(),
  maxAttempts: z.number().int().positive(),
});
const budgetSchema = z.object({
  limits: budgetLimitsSchema,
  enforcement: z.enum(['strict', 'best-effort']),
});
export const agentDefinitionSchema = metadataSchema.extend({
  name: z.string().min(1),
  role: z.string().min(1),
  instructionIds: z.array(definitionIdSchema),
  skillIds: z.array(definitionIdSchema),
  promptId: definitionIdSchema,
  tools: z.array(z.string().min(1)),
  autonomy: z.enum(['manual', 'semi', 'autonomous']),
  policyId: definitionIdSchema,
  executionProfileId: definitionIdSchema,
  budget: budgetSchema,
});

const permissionRuleSchema = z.object({
  id: z.string().min(1),
  tools: z.array(z.string().min(1)).min(1),
  effect: z.enum(['allow', 'deny', 'approval']),
  resources: z.array(z.string().min(1)).optional(),
});
export const policyDefinitionSchema = metadataSchema.extend({
  defaultEffect: z.literal('deny'),
  rules: z.array(permissionRuleSchema),
  workspace: z.object({
    readablePaths: z.array(z.string().min(1)),
    writablePaths: z.array(z.string().min(1)),
    network: z.enum(['deny', 'allowlist']),
    allowedHosts: z.array(z.string().min(1)),
  }),
});

const executionTargetSchema = z.object({
  providerId: z.string().min(1),
  modelId: z.string().min(1).optional(),
});
export const executionProfileSchema = metadataSchema.extend({
  targets: z.array(executionTargetSchema).min(1),
  fallback: z.enum(['disabled', 'before-side-effects']),
});

const artifactBindingSchema = z.object({
  stepId: definitionIdSchema,
  artifactName: z.string().min(1),
});
const workflowStepSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('agent'),
    id: definitionIdSchema,
    agentId: definitionIdSchema,
    inputs: z.record(z.string(), artifactBindingSchema),
  }),
  z.object({
    kind: z.literal('verification'),
    id: definitionIdSchema,
    verifierId: definitionIdSchema,
    inputs: z.record(z.string(), artifactBindingSchema),
  }),
  z.object({
    kind: z.literal('approval'),
    id: definitionIdSchema,
    actionId: definitionIdSchema,
    inputs: z.record(z.string(), artifactBindingSchema),
  }),
]);
export const workflowDefinitionSchema = metadataSchema.extend({
  steps: z.array(workflowStepSchema).min(1),
});

export type DefinitionId = z.infer<typeof definitionIdSchema>;
export type DefinitionSource = z.infer<typeof sourceSchema>;
export type InstructionDefinition = z.infer<typeof instructionDefinitionSchema>;
export type SkillDefinition = z.infer<typeof skillDefinitionSchema>;
export type PromptDefinition = z.infer<typeof promptDefinitionSchema>;
export type BudgetLimits = z.infer<typeof budgetLimitsSchema>;
export type AgentBudget = z.infer<typeof budgetSchema>;
export type AgentDefinition = z.infer<typeof agentDefinitionSchema>;
export type PolicyDefinition = z.infer<typeof policyDefinitionSchema>;
export type ExecutionTarget = z.infer<typeof executionTargetSchema>;
export type ExecutionProfile = z.infer<typeof executionProfileSchema>;
export type WorkflowDefinition = z.infer<typeof workflowDefinitionSchema>;
export type WorkflowStep = z.infer<typeof workflowStepSchema>;
export type ReadonlyWorkflowDefinition = DeepReadonly<WorkflowDefinition>;
export type ReadonlyWorkflowStep = DeepReadonly<WorkflowStep>;

const definitionCatalogInputSchema = z.object({
  instructions: z.array(instructionDefinitionSchema),
  skills: z.array(skillDefinitionSchema),
  prompts: z.array(promptDefinitionSchema),
  agents: z.array(agentDefinitionSchema),
  policies: z.array(policyDefinitionSchema),
  executionProfiles: z.array(executionProfileSchema),
  workflows: z.array(workflowDefinitionSchema),
});
export type DefinitionCatalogInput = z.input<typeof definitionCatalogInputSchema>;
type ParsedDefinitionCatalog = z.output<typeof definitionCatalogInputSchema>;
export type DefinitionCatalog = DeepReadonly<ParsedDefinitionCatalog> & {
  snapshotId: string;
};

function assertUniqueDefinitionIds(catalog: ParsedDefinitionCatalog): void {
  const definitions = [
    ...catalog.instructions,
    ...catalog.skills,
    ...catalog.prompts,
    ...catalog.agents,
    ...catalog.policies,
    ...catalog.executionProfiles,
    ...catalog.workflows,
  ];
  const ids = new Set<string>();
  for (const definition of definitions) {
    if (ids.has(definition.id)) throw new Error(`Duplicate definition id: ${definition.id}`);
    ids.add(definition.id);
  }
}

function assertReferences(catalog: ParsedDefinitionCatalog): void {
  const ids = new Set([
    ...catalog.instructions.map(({ id }) => id),
    ...catalog.skills.map(({ id }) => id),
    ...catalog.prompts.map(({ id }) => id),
    ...catalog.agents.map(({ id }) => id),
    ...catalog.policies.map(({ id }) => id),
    ...catalog.executionProfiles.map(({ id }) => id),
    ...catalog.workflows.map(({ id }) => id),
  ]);
  const skills = new Map(catalog.skills.map((skill) => [skill.id, skill]));
  const instructions = new Map(catalog.instructions.map((item) => [item.id, item]));
  const agents = new Set(catalog.agents.map(({ id }) => id));

  for (const item of catalog.instructions) {
    for (const replacedId of item.replaces ?? []) {
      if (!ids.has(replacedId)) throw new Error(`Instruction ${item.id} replaces missing definition ${replacedId}`);
      const replaced = instructions.get(replacedId);
      if (!item.conflictKey || replaced?.conflictKey !== item.conflictKey) {
        throw new Error(`Instruction ${item.id} can only replace an instruction with the same conflictKey`);
      }
      if (item.source.trust === 'project' && replaced.source.trust === 'managed') {
        throw new Error(`Project instruction ${item.id} cannot replace managed instruction ${replacedId}`);
      }
    }
  }
  const visitedInstructions = new Set<string>();
  const activeInstructions = new Set<string>();
  const visitInstruction = (id: string) => {
    if (activeInstructions.has(id)) throw new Error(`Instruction replacement cycle includes ${id}`);
    if (visitedInstructions.has(id)) return;
    activeInstructions.add(id);
    for (const replacedId of instructions.get(id)?.replaces ?? []) visitInstruction(replacedId);
    activeInstructions.delete(id);
    visitedInstructions.add(id);
  };
  for (const id of instructions.keys()) visitInstruction(id);

  for (const skill of catalog.skills) {
    for (const dependency of skill.dependencies) {
      if (!skills.has(dependency)) throw new Error(`Skill ${skill.id} has missing dependency ${dependency}`);
    }
  }
  const visited = new Set<string>();
  const active = new Set<string>();
  const visitSkill = (id: string) => {
    if (active.has(id)) throw new Error(`Skill dependency cycle includes ${id}`);
    if (visited.has(id)) return;
    active.add(id);
    for (const dependency of skills.get(id)?.dependencies ?? []) visitSkill(dependency);
    active.delete(id);
    visited.add(id);
  };
  for (const id of skills.keys()) visitSkill(id);

  for (const agent of catalog.agents) {
    for (const id of agent.instructionIds) {
      if (!instructions.has(id)) throw new Error(`Agent ${agent.id} has missing instruction ${id}`);
    }
    for (const id of agent.skillIds) {
      if (!skills.has(id)) throw new Error(`Agent ${agent.id} has missing skill ${id}`);
    }
    if (!catalog.prompts.some(({ id }) => id === agent.promptId)) {
      throw new Error(`Agent ${agent.id} has missing prompt ${agent.promptId}`);
    }
    if (!catalog.policies.some(({ id }) => id === agent.policyId)) {
      throw new Error(`Agent ${agent.id} has missing policy ${agent.policyId}`);
    }
    if (!catalog.executionProfiles.some(({ id }) => id === agent.executionProfileId)) {
      throw new Error(`Agent ${agent.id} has missing execution profile ${agent.executionProfileId}`);
    }
  }

  for (const workflow of catalog.workflows) {
    const earlierSteps = new Set<string>();
    for (const step of workflow.steps) {
      if (step.kind === 'agent' && !agents.has(step.agentId)) {
        throw new Error(`Workflow ${workflow.id} has missing agent ${step.agentId}`);
      }
      for (const binding of Object.values(step.inputs)) {
        if (!earlierSteps.has(binding.stepId)) {
          throw new Error(`Workflow ${workflow.id} input must reference an earlier step: ${binding.stepId}`);
        }
      }
      earlierSteps.add(step.id);
    }
  }
}

export function buildDefinitionCatalog(input: unknown): DefinitionCatalog {
  // The trusted filesystem adapter must replace definition-supplied provenance before calling this.
  const parsed = definitionCatalogInputSchema.parse(input);
  assertUniqueDefinitionIds(parsed);
  assertReferences(parsed);
  return immutable({ ...parsed, snapshotId: snapshotId(parsed) });
}

export interface InstructionResolutionContext {
  projectPath?: string;
  taskKind?: string;
  agentId?: string;
}

function pathConditionMatches(pattern: string, value: string): boolean {
  const normalizedPattern = pattern.replaceAll('\\', '/').replace(/^\.\//, '');
  const normalizedValue = value.replaceAll('\\', '/').replace(/^\.\//, '');
  if (normalizedPattern.endsWith('/**')) {
    const prefix = normalizedPattern.slice(0, -3).replace(/\/$/, '');
    return normalizedValue === prefix || normalizedValue.startsWith(`${prefix}/`);
  }
  return normalizedPattern === normalizedValue;
}

function appliesTo(instruction: InstructionDefinition, context: InstructionResolutionContext): boolean {
  if (instruction.scope === 'project' && !context.projectPath) return false;
  if (instruction.scope === 'agent' && !context.agentId) return false;
  const conditions = instruction.appliesWhen;
  if (instruction.scope === 'agent'
    && (!conditions?.agentIds || !context.agentId || !conditions.agentIds.includes(context.agentId))) return false;
  if (conditions?.paths && (!context.projectPath
    || !conditions.paths.some((pattern) => pathConditionMatches(pattern, context.projectPath!)))) return false;
  if (conditions?.taskKinds && (!context.taskKind || !conditions.taskKinds.includes(context.taskKind))) return false;
  if (conditions?.agentIds && (!context.agentId || !conditions.agentIds.includes(context.agentId))) return false;
  return true;
}

const scopeRank: Record<InstructionDefinition['scope'], number> = {
  global: 0,
  project: 1,
  agent: 2,
};

function compareInstructionPrecedence(left: InstructionDefinition, right: InstructionDefinition): number {
  return scopeRank[left.scope] - scopeRank[right.scope]
    || left.priority - right.priority
    || left.id.localeCompare(right.id);
}

export function resolveInstructions(
  definitions: InstructionDefinition[],
  context: InstructionResolutionContext,
): InstructionDefinition[] {
  const applicable = definitions.filter((item) => appliesTo(item, context));
  const withoutConflictKey = applicable.filter((item) => !item.conflictKey);
  const groups = new Map<string, InstructionDefinition[]>();
  for (const item of applicable) {
    if (!item.conflictKey) continue;
    const group = groups.get(item.conflictKey) ?? [];
    group.push(item);
    groups.set(item.conflictKey, group);
  }

  const winners: InstructionDefinition[] = [...withoutConflictKey];
  for (const [conflictKey, group] of groups) {
    const groupIds = new Set(group.map(({ id }) => id));
    for (const item of group) {
      for (const replacedId of item.replaces ?? []) {
        const replaced = group.find(({ id }) => id === replacedId);
        if (replaced && item.source.trust === 'project' && replaced.source.trust === 'managed') {
          throw new Error(`Project instruction ${item.id} cannot replace managed instruction ${replacedId}`);
        }
      }
    }
    const replacedIds = new Set(group.flatMap((item) => (item.replaces ?? []).filter((id) => groupIds.has(id))));
    const remaining = group.filter((item) => !replacedIds.has(item.id));
    if (!remaining.length) throw new Error(`Instruction replacement cycle: ${conflictKey}`);
    const contentGroups = new Map<string, InstructionDefinition[]>();
    for (const item of remaining) {
      const sameContent = contentGroups.get(item.content) ?? [];
      sameContent.push(item);
      contentGroups.set(item.content, sameContent);
    }
    if (contentGroups.size > 1) throw new Error(`Unresolved instruction conflict: ${conflictKey}`);
    const identicalContent = [...contentGroups.values()][0];
    if (identicalContent?.length) {
      winners.push(identicalContent.sort(compareInstructionPrecedence).at(-1)!);
    }
  }

  return winners.sort(compareInstructionPrecedence);
}

export type PermissionDecision =
  | { decision: 'allow' }
  | { decision: 'approval'; reason: string }
  | { decision: 'deny'; reason: string };

/** Tool rules only; the host must separately enforce workspace paths and network policy. */
export function evaluateToolPermission(
  policies: PolicyDefinition[],
  toolId: string,
  resource: string,
): PermissionDecision {
  if (!policies.length) return { decision: 'deny', reason: 'No policy provided.' };
  let approvalPolicy: string | undefined;
  for (const policy of policies) {
    const matches = policy.rules.filter((rule) =>
      rule.tools.includes(toolId) && (!rule.resources || rule.resources.includes(resource)));
    if (matches.some(({ effect }) => effect === 'deny')) {
      return { decision: 'deny', reason: `Policy ${policy.id} denies this action.` };
    }
    if (matches.some(({ effect }) => effect === 'approval')) approvalPolicy ??= policy.id;
    if (!matches.some(({ effect }) => effect === 'allow' || effect === 'approval')) {
      return { decision: 'deny', reason: `Policy ${policy.id} does not allow this action.` };
    }
  }
  if (approvalPolicy) return { decision: 'approval', reason: `Policy ${approvalPolicy} requires approval.` };
  return { decision: 'allow' };
}

export type ProviderFeature =
  | 'nativeAgents'
  | 'nativeSkills'
  | 'delegation'
  | 'structuredOutput'
  | 'textStreaming'
  | 'sessionResume'
  | 'blockingToolPermissions'
  | 'toolHooks'
  | 'parallelSessions';
export type FeatureSupport = 'native' | 'unsupported' | 'unknown';

export interface ProviderCapabilities {
  providerId: string;
  modelId?: string;
  sdkVersion: string;
  runtimeVersion?: string;
  observedAt: string;
  features: Partial<Record<ProviderFeature, FeatureSupport>>;
  customTools: 'direct' | 'mcp' | 'unsupported' | 'unknown';
  usageReporting: 'reported' | 'estimated' | 'unavailable';
  maxConcurrentSessions?: number;
}

export interface ModelDescriptor {
  id: string;
  name: string;
}

export type OutputContract = z.infer<typeof outputContractSchema>;
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export interface PreparedExecutionRequest {
  executionId: string;
  workflowRunId: string;
  attempt: number;
  agent: { id: DefinitionId; version: string };
  target: ExecutionTarget;
  workspace: { id: string; root: string; baseRevision: string };
  instructionBlocks: { id: DefinitionId; content: string; source: DefinitionSource }[];
  skillIds: DefinitionId[];
  prompt: string;
  output: OutputContract;
  tools: string[];
  policy: PolicyDefinition;
  budget: AgentBudget;
  snapshotId: string;
  nativeSessionId?: string;
}

export interface UsageMeasurement {
  inputTokens?: number;
  outputTokens?: number;
  cost?: { currency: 'USD'; micros: number };
  basis: 'reported' | 'estimated' | 'unavailable';
}

export interface Artifact {
  id: string;
  name: string;
  kind: 'plan' | 'patch' | 'report' | 'verification';
  uri: string;
  sha256: string;
}

export type ExecutionErrorCode =
  | 'AUTHENTICATION'
  | 'CAPABILITY_UNSUPPORTED'
  | 'POLICY_DENIED'
  | 'INVALID_OUTPUT'
  | 'RATE_LIMITED'
  | 'RUNTIME_FAILURE';

export interface ExecutionError {
  code: ExecutionErrorCode;
  message: string;
  retryable: boolean;
}

export type AgentExecutionResult = {
  artifacts: Artifact[];
  usage: UsageMeasurement;
  nativeSessionId?: string;
} & (
  | { status: 'succeeded'; output: JsonValue }
  | { status: 'failed'; error: ExecutionError }
  | { status: 'cancelled'; reason: string }
  | { status: 'interrupted'; reason: string }
  | { status: 'budget_exceeded'; limit: keyof BudgetLimits }
);

export interface ExecutionEvent {
  executionId: string;
  sequence: number;
  occurredAt: string;
  payload:
    | { type: 'started'; nativeSessionId?: string }
    | { type: 'text_delta'; text: string }
    | { type: 'tool_requested'; callId: string; toolId: string }
    | { type: 'tool_completed'; callId: string; succeeded: boolean }
    | { type: 'tool_denied'; callId: string; toolId: string; reason: string }
    | { type: 'budget_warning'; reason: string }
    | { type: 'usage'; usage: UsageMeasurement }
    | { type: 'artifact'; artifact: Artifact };
}

export interface ActionRequest {
  executionId: string;
  callId: string;
  toolId: string;
  arguments: Record<string, JsonValue>;
  resources: string[];
}

export type AuthorizationDecision =
  | { decision: 'allow'; authorizationId: string }
  | { decision: 'deny'; reason: string };

export interface ExecutionControls {
  signal: AbortSignal;
  onEvent(event: ExecutionEvent): Promise<void>;
  authorize(action: ActionRequest): Promise<AuthorizationDecision>;
  invokeTool?: (toolId: string, arguments_: Record<string, JsonValue>) => Promise<JsonValue>;
}

export interface AIProvider {
  readonly id: string;
  getCapabilities(target?: ExecutionTarget): Promise<ProviderCapabilities>;
  listModels(): Promise<ModelDescriptor[]>;
  health(): Promise<{ available: boolean; authenticated: boolean; issue?: string }>;
  execute(request: DeepReadonly<PreparedExecutionRequest>, controls: ExecutionControls): Promise<AgentExecutionResult>;
}

export { runWorkflow } from './workflowRunner';
export type {
  WorkflowHandlers,
  WorkflowRunResult,
  WorkflowStepContext,
  WorkflowStepEvent,
  WorkflowStepHandler,
  WorkflowStepResult,
} from './workflowRunner';

export { prepareAnalysis, runAnalysis, analysisReportSchema } from './analysis';
export type {
  AnalysisHost, AnalysisTask, AnalysisWorkspace, AnalysisBundle, AnalysisExecutionRequest,
  PreparedAnalysis, AnalysisReport, AnalysisResult, AnalysisStore, ProviderQualification, CapabilityPlan,
} from './analysis';
