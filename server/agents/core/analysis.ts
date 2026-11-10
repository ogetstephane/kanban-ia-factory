import { z } from 'zod';
import { createHash } from 'node:crypto';
import {
  evaluateToolPermission, instructionDefinitionSchema, policyDefinitionSchema, resolveInstructions,
  type AIProvider, type AgentExecutionResult, type Artifact, type DefinitionCatalog,
  type ExecutionEvent, type ExecutionTarget, type JsonValue, type PreparedExecutionRequest,
  type ProviderCapabilities,
} from './index';
import { renderPrompt, validateJsonSchema, validateJsonValue } from './prompt';
import { immutable, snapshotId, type DeepReadonly } from './snapshot';
import { agentExecutionResultSchema, artifactSchema, executionEventSchema, usageMeasurementSchema } from './executionValidation';

const MAX_SNAPSHOT_BYTES = 5_000_000;
const MAX_CONTEXT_BYTES = 1_000_000;
const TOOL_IDS = ['repository.list', 'repository.read', 'repository.search', 'skill.load'] as const;

const taskSchema = z.object({
  id: z.string().min(1),
  agentId: z.string().min(1),
  executionProfileId: z.string().min(1),
  paths: z.array(z.string().min(1)).min(1),
  variables: z.record(z.string(), z.json()),
}).strict();

export type AnalysisTask = z.infer<typeof taskSchema>;
export interface AnalysisWorkspace {
  id: string;
  root: string;
  baseRevision: string;
  files: Record<string, string>;
}
export interface ProviderQualification {
  providerId: string;
  modelId?: string;
  sdkVersion: string;
  runtimeVersion?: string;
  evidenceId: string;
  exclusiveToolBroker: boolean;
}
export interface AnalysisHost {
  providers: readonly AIProvider[];
  qualifications: readonly ProviderQualification[];
  resourceContents: Readonly<Record<string, string>>; // base64 bytes keyed by SHA-256
}

export interface AnalysisBundle {
  id: string;
  instructions: PreparedExecutionRequest['instructionBlocks'];
  skills: {
    id: string;
    mode: 'required' | 'on-demand';
    content: string;
    resources: { path: string; sha256: string; base64: string }[];
  }[];
  workspaceSnapshotId: string;
}
export interface CapabilityPlan {
  target: ExecutionTarget;
  capabilities: ProviderCapabilities;
  isolationEvidenceId: string;
  skills: 'controlled-skill-injection';
  structuredOutput: 'native' | 'validated-json';
  tools: 'host-tool-broker';
}
export interface PreparedAnalysis {
  request: DeepReadonly<AnalysisExecutionRequest>;
  bundle: DeepReadonly<AnalysisBundle>;
  capabilityPlan: DeepReadonly<CapabilityPlan>;
  workspace: DeepReadonly<AnalysisWorkspace>;
  paths: readonly string[];
}
export interface AnalysisExecutionRequest extends PreparedExecutionRequest {
  contextBundle: AnalysisBundle;
  capabilityPlan: CapabilityPlan;
  catalogSnapshotId: string;
  variables: Record<string, JsonValue>;
  paths: string[];
}

function canonicalPath(input: string): string {
  if (input === '.') return input;
  if (!input || input.startsWith('/') || input.includes('\\') || input.includes(':')
    || input.split('/').some((part) => !part || part === '.' || part === '..')
    || /[*?]/.test(input)) throw new Error(`Invalid relative workspace path: ${input}`);
  return input;
}

function within(file: string, scope: string): boolean {
  return scope === '.' || file === scope || file.startsWith(`${scope}/`);
}

export async function prepareAnalysis(
  taskInput: AnalysisTask,
  catalog: DefinitionCatalog,
  workspaceInput: AnalysisWorkspace,
  host: AnalysisHost,
  signal: AbortSignal,
): Promise<DeepReadonly<PreparedAnalysis>> {
  signal.throwIfAborted();
  const task = taskSchema.parse(taskInput);
  const paths = [...new Set(task.paths.map(canonicalPath))].sort();
  const workspace = structuredClone(workspaceInput);
  let snapshotBytes = 0;
  for (const [file, content] of Object.entries(workspace.files)) {
    canonicalPath(file);
    if (file === '.') throw new Error('A snapshot file cannot be named ".".');
    snapshotBytes += Buffer.byteLength(content);
  }
  if (snapshotBytes > MAX_SNAPSHOT_BYTES) throw new Error('Workspace text snapshot exceeds 5 MB.');
  const agent = catalog.agents.find(({ id }) => id === task.agentId);
  if (!agent) throw new Error(`Unknown analysis agent: ${task.agentId}`);
  const profile = catalog.executionProfiles.find(({ id }) => id === task.executionProfileId);
  if (!profile) throw new Error(`Unknown execution profile: ${task.executionProfileId}`);
  const policy = catalog.policies.find(({ id }) => id === agent.policyId);
  const prompt = catalog.prompts.find(({ id }) => id === agent.promptId);
  if (!policy || !prompt) throw new Error('Analysis agent is missing its policy or prompt.');
  if (policy.workspace.writablePaths.length || policy.workspace.network !== 'deny') {
    throw new Error('Analysis requires a read-only policy without tool network access.');
  }
  if (agent.tools.some((tool) => !TOOL_IDS.some((id) => id === tool))) {
    throw new Error('Analysis agent requests an unknown or non-read-only tool.');
  }
  for (const scope of policy.workspace.readablePaths) canonicalPath(scope);
  for (const scope of paths) {
    if (!policy.workspace.readablePaths.some((allowed) => within(scope, allowed))) {
      throw new Error(`Analysis path is outside the readable policy: ${scope}`);
    }
  }
  // Only approved files reach the provider or broker, even if the host snapshot contains more.
  workspace.files = Object.fromEntries(Object.entries(workspace.files)
    .filter(([file]) => paths.some((scope) => within(file, scope))));
  if (!Object.keys(workspace.files).length) throw new Error('Analysis paths contain no snapshot files.');

  const selectedInstructions = catalog.instructions.filter((instruction) =>
    instruction.scope !== 'agent' || agent.instructionIds.includes(instruction.id));
  const mutableInstructions = selectedInstructions.map((item) => instructionDefinitionSchema.parse(item));
  const effective = new Map<string, PreparedExecutionRequest['instructionBlocks'][number]>();
  for (const file of Object.keys(workspace.files).sort()) {
    const resolved = resolveInstructions(mutableInstructions, {
      agentId: agent.id, taskKind: 'analysis', projectPath: file,
    });
    for (const instruction of resolved) {
      effective.set(instruction.id, { id: instruction.id, content: instruction.content, source: instruction.source });
    }
  }
  // Conflicting conventions across zones require separate analyses, not arbitrary ordering.
  const keys = new Map<string, string>();
  for (const instruction of selectedInstructions.filter(({ id }) => effective.has(id))) {
    if (!instruction.conflictKey) continue;
    const previous = keys.get(instruction.conflictKey);
    if (previous && previous !== instruction.content) throw new Error(`Cross-zone instruction conflict: ${instruction.conflictKey}`);
    keys.set(instruction.conflictKey, instruction.content);
  }

  const skills: AnalysisBundle['skills'] = [];
  const visited = new Set<string>();
  const loadSkill = (id: string, required = false) => {
    const skill = catalog.skills.find((item) => item.id === id);
    if (!skill) throw new Error(`Unknown skill: ${id}`);
    const mode = required || skill.activation.mode === 'required' ? 'required' : 'on-demand';
    if (visited.has(id)) {
      const existing = skills.find((item) => item.id === id);
      if (existing && existing.mode !== mode && mode === 'required') {
        existing.mode = mode;
        for (const dependency of skill.dependencies) loadSkill(dependency, true);
      }
      return;
    }
    visited.add(id);
    if (skill.activation.taskKinds && !skill.activation.taskKinds.includes('analysis')) {
      throw new Error(`Skill ${id} does not apply to analysis tasks.`);
    }
    if (skill.requiredTools.some((tool) => !agent.tools.includes(tool))) throw new Error(`Skill ${id} requires an unavailable tool.`);
    for (const dependency of skill.dependencies) loadSkill(dependency, mode === 'required');
    const resources = skill.resources.map((resource) => {
      const base64 = host.resourceContents[resource.sha256];
      if (base64 === undefined) throw new Error(`Missing frozen resource for skill ${id}: ${resource.path}`);
      const bytes = Buffer.from(base64, 'base64');
      if (bytes.toString('base64') !== base64) throw new Error(`Invalid base64 resource: ${resource.path}`);
      // Hash original bytes, not their UTF-8 rendering.
      if (snapshotResourceHash(bytes) !== resource.sha256) throw new Error(`Resource hash mismatch: ${resource.path}`);
      return { ...resource, base64 };
    });
    skills.push({ id, mode, content: skill.instructions, resources });
  };
  for (const id of agent.skillIds) loadSkill(id);
  if (skills.some(({ mode }) => mode === 'on-demand') && !agent.tools.includes('skill.load')) {
    throw new Error('On-demand skills require the allowed skill.load tool.');
  }
  const rendered = renderPrompt(prompt.template, task.variables, prompt.variablesSchema);
  if (prompt.output.kind !== 'json') throw new Error('Analysis requires a JSON output contract.');
  validateJsonSchema(prompt.output.schema);
  const bundleData = {
    instructions: [...effective.values()],
    skills,
    workspaceSnapshotId: snapshotId(workspace),
  };
  const bundle: AnalysisBundle = { ...bundleData, id: snapshotId(bundleData) };
  const assembledPrompt = [
    rendered,
    ...bundle.instructions.map(({ id, content }) => `Instruction ${id}:\n${content}`),
    ...skills.filter(({ mode }) => mode === 'required').map(({ id, content }) => `Required skill ${id}:\n${content}`),
  ].join('\n\n');
  if (Buffer.byteLength(JSON.stringify(bundle)) + Buffer.byteLength(assembledPrompt) > MAX_CONTEXT_BYTES) {
    throw new Error('Prepared context exceeds 1 MB.');
  }
  const limits = agent.budget.limits;
  if (agent.budget.enforcement === 'strict' && (limits.maxInputTokens !== undefined
    || limits.maxOutputTokens !== undefined || limits.maxCost !== undefined || limits.maxAgentTurns !== undefined)) {
    throw new Error('Strict token, cost or native turn limits are not enforceable by this analysis host.');
  }
  const candidates = profile.fallback === 'disabled' ? profile.targets.slice(0, 1) : profile.targets;
  let plan: CapabilityPlan | undefined;
  const errors: string[] = [];
  for (const target of candidates) {
    signal.throwIfAborted();
    const provider = host.providers.find(({ id }) => id === target.providerId);
    if (!provider) { errors.push(`Provider ${target.providerId} is not registered.`); continue; }
    const health = await provider.health();
    if (!health.available || !health.authenticated) { errors.push(health.issue ?? `Provider ${provider.id} is unavailable.`); continue; }
    if (target.modelId && !(await provider.listModels()).some(({ id }) => id === target.modelId)) {
      errors.push(`Model ${target.modelId} is unavailable on ${provider.id}.`); continue;
    }
    const capabilities = await provider.getCapabilities(target);
    const qualification = host.qualifications.find((item) => item.providerId === target.providerId
      && item.modelId === target.modelId && item.sdkVersion === capabilities.sdkVersion
      && item.runtimeVersion === capabilities.runtimeVersion && item.exclusiveToolBroker && item.evidenceId);
    if (capabilities.providerId !== target.providerId || capabilities.modelId !== target.modelId
      || !qualification || capabilities.features.blockingToolPermissions !== 'native'
      || !['direct', 'mcp'].includes(capabilities.customTools)) {
      errors.push(`Provider ${provider.id} has no qualified exclusive read-only broker.`); continue;
    }
    plan = { target, capabilities, isolationEvidenceId: qualification.evidenceId,
      tools: 'host-tool-broker', skills: 'controlled-skill-injection',
      structuredOutput: capabilities.features.structuredOutput === 'native' ? 'native' : 'validated-json' };
    break;
  }
  if (!plan) throw new Error(`No acceptable analysis target: ${errors.join(' ')}`);
  signal.throwIfAborted();
  const requestData = {
    workflowRunId: task.id, attempt: 1,
    agent: { id: agent.id, version: agent.version }, target: plan.target,
    workspace: { id: workspace.id, root: workspace.root, baseRevision: workspace.baseRevision },
    instructionBlocks: bundle.instructions, skillIds: skills.map(({ id }) => id),
    prompt: assembledPrompt, output: prompt.output, tools: [...agent.tools], policy,
    budget: agent.budget, catalogSnapshotId: catalog.snapshotId,
    contextBundle: bundle, capabilityPlan: plan, variables: task.variables, paths,
  };
  const id = snapshotId(requestData);
  return immutable({
    request: { ...requestData, executionId: `${task.id}:1`, snapshotId: id },
    bundle, capabilityPlan: plan, workspace, paths,
  });
}

function snapshotResourceHash(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export const analysisReportSchema = z.object({
  summary: z.string().trim().min(1),
  observations: z.array(z.object({
    description: z.string().trim().min(1),
    evidence: z.array(z.object({
      path: z.string().min(1),
      line: z.number().int().positive(),
    }).strict()).min(1),
  }).strict()),
  limitations: z.array(z.string()),
}).strict();
export type AnalysisReport = z.infer<typeof analysisReportSchema>;

export interface AnalysisResult {
  status: 'succeeded' | 'failed' | 'cancelled' | 'interrupted' | 'budget_exceeded';
  report?: AnalysisReport;
  reason?: string;
  artifacts: Artifact[];
  providerResult?: AgentExecutionResult;
}
export interface AnalysisStore {
  savePrepared(prepared: DeepReadonly<PreparedAnalysis>): Promise<void>;
  appendEvent(event: ExecutionEvent): Promise<void>;
  saveResult(executionId: string, result: AnalysisResult, phase?: 'preparation' | 'execution'): Promise<void>;
}

const readArguments = z.object({
  path: z.string(),
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
}).strict();
const searchArguments = z.object({ text: z.string().min(1).max(200) }).strict();
const skillArguments = z.object({ id: z.string().min(1) }).strict();
const emptyArguments = z.object({}).strict();
export const analysisToolSchemas = {
  'repository.list': emptyArguments,
  'repository.read': readArguments,
  'repository.search': searchArguments,
  'skill.load': skillArguments,
};

export async function runAnalysis(
  task: AnalysisTask,
  catalog: DefinitionCatalog,
  workspace: AnalysisWorkspace,
  host: AnalysisHost,
  store: AnalysisStore,
  signal: AbortSignal,
): Promise<AnalysisResult> {
  if (signal.aborted) return { status: 'cancelled', reason: 'Analysis aborted before preparation.', artifacts: [] };
  let prepared: DeepReadonly<PreparedAnalysis>;
  try {
    prepared = await prepareAnalysis(task, catalog, workspace, host, signal);
  } catch (error) {
    const result: AnalysisResult = { status: signal.aborted ? 'cancelled' : 'failed',
      reason: error instanceof Error ? error.message : String(error), artifacts: [] };
    await store.saveResult(`${task.id}:1`, result, 'preparation');
    return result;
  }
  await store.savePrepared(prepared);
  if (signal.aborted) {
    const cancelled: AnalysisResult = { status: 'cancelled', reason: 'Analysis aborted before launch.', artifacts: [] };
    await store.saveResult(prepared.request.executionId, cancelled);
    return cancelled;
  }
  const provider = host.providers.find(({ id }) => id === prepared.request.target.providerId);
  if (!provider) throw new Error('Prepared analysis provider is no longer registered.');
  const controller = new AbortController();
  let stopped = false;
  let sequence = 0;
  let calls = 0;
  let failure: { status: 'failed' | 'budget_exceeded'; reason: string } | undefined;
  let storageError: unknown;
  const observedArtifacts: Artifact[] = [];
  const addArtifact = (artifact: Artifact) => {
    const previous = observedArtifacts.find(({ id }) => id === artifact.id);
    if (previous && snapshotId(previous) !== snapshotId(artifact)) throw new Error(`Conflicting provider artifact: ${artifact.id}`);
    if (!previous) observedArtifacts.push(artifact);
  };
  const readEvidence = new Set<string>();
  const abort = () => controller.abort(signal.reason);
  signal.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(() => {
    failure ??= { status: 'budget_exceeded', reason: 'Analysis duration budget exceeded.' };
    controller.abort();
  }, prepared.request.budget.limits.maxDurationMs);
  let eventWrites = Promise.resolve();
  const event = (payload: ExecutionEvent['payload']) => {
    if (stopped) return Promise.reject(new Error('Analysis is already stopped.'));
    const entry = { executionId: prepared.request.executionId, sequence: sequence++,
      occurredAt: new Date().toISOString(), payload };
    const write = eventWrites.then(() => {
      if (storageError) throw storageError;
      return store.appendEvent(entry);
    });
    eventWrites = write.then(() => {}, (error: unknown) => {
      storageError ??= error;
      controller.abort();
    });
    return write;
  };
  const deny = async (toolId: string, callId: string, reason: string): Promise<never> => {
    failure ??= { status: 'failed', reason };
    await event({ type: 'tool_denied', toolId, callId, reason });
    controller.abort();
    throw new Error(reason);
  };
  const validateTool = (toolId: string, args: Record<string, JsonValue>) => {
    if (!prepared.request.tools.includes(toolId)) throw new Error(`Tool ${toolId} is not allowed.`);
    if (toolId === 'repository.read') {
      const parsed = readArguments.parse(args);
      canonicalPath(parsed.path);
      if (!Object.hasOwn(prepared.workspace.files, parsed.path)) throw new Error(`File is outside the analysis snapshot: ${parsed.path}`);
      if (parsed.endLine < parsed.startLine || parsed.endLine - parsed.startLine + 1 > 500) {
        throw new Error('Repository reads require an ordered range of at most 500 lines.');
      }
      const lines = prepared.workspace.files[parsed.path].split(/\r?\n/);
      if (parsed.endLine > lines.length) throw new Error('Read range exceeds snapshot file length.');
      return { resource: parsed.path, output: lines.slice(parsed.startLine - 1, parsed.endLine).join('\n') };
    }
    if (toolId === 'repository.list') {
      emptyArguments.parse(args);
      return { resource: '.', output: Object.keys(prepared.workspace.files).sort() };
    }
    if (toolId === 'repository.search') {
      const { text } = searchArguments.parse(args);
      const matches: { path: string; line: number; text: string }[] = [];
      for (const [file, content] of Object.entries(prepared.workspace.files).sort(([left], [right]) => left.localeCompare(right))) {
        content.split(/\r?\n/).forEach((line, index) => {
          if (line.includes(text) && matches.length < 100) matches.push({ path: file, line: index + 1, text: line.slice(0, 1000) });
        });
      }
      return { resource: '.', output: matches };
    }
    if (toolId === 'skill.load') {
      const { id } = skillArguments.parse(args);
      const skill = prepared.bundle.skills.find((item) => item.id === id);
      if (!skill) throw new Error(`Skill ${id} is outside the prepared bundle.`);
      return { resource: id, output: { content: skill.content, resources: [...skill.resources] } };
    }
    throw new Error(`Unknown analysis tool: ${toolId}`);
  };
  const effectivePolicy = policyDefinitionSchema.parse(prepared.request.policy);
  const authorizeTool = (toolId: string, args: Record<string, JsonValue>) => {
    const validated = validateTool(toolId, args);
    const decision = evaluateToolPermission([effectivePolicy], toolId, validated.resource);
    if (decision.decision !== 'allow') throw new Error(decision.reason);
    if (toolId === 'repository.list' || toolId === 'repository.search') {
      for (const file of Object.keys(prepared.workspace.files)) {
        const fileDecision = evaluateToolPermission([effectivePolicy], toolId, file);
        if (fileDecision.decision !== 'allow') throw new Error(`Tool ${toolId} is not allowed for snapshot file ${file}.`);
      }
    }
    return validated.output;
  };
  const invokeTool = async (toolId: string, args: Record<string, JsonValue>): Promise<JsonValue> => {
    controller.signal.throwIfAborted();
    const callId = `${prepared.request.executionId}:tool:${++calls}`;
    await event({ type: 'tool_requested', toolId, callId });
    if (calls > prepared.request.budget.limits.maxToolCalls) {
      failure ??= { status: 'budget_exceeded', reason: 'Analysis tool-call budget exceeded.' };
      controller.abort();
      throw new Error(failure.reason);
    }
    let output: JsonValue;
    try {
      output = authorizeTool(toolId, args);
      if (Buffer.byteLength(JSON.stringify(output)) > 100_000) throw new Error('Tool result exceeds 100 KB.');
    } catch (error) {
      return deny(toolId, callId, error instanceof Error ? error.message : String(error));
    }
    await event({ type: 'tool_completed', callId, succeeded: true });
    if (toolId === 'repository.read') {
      const parsed = readArguments.parse(args);
      for (let line = parsed.startLine; line <= parsed.endLine; line++) readEvidence.add(`${parsed.path}:${line}`);
    } else if (toolId === 'repository.search' && Array.isArray(output)) {
      for (const match of output) {
        const evidence = z.object({ path: z.string(), line: z.number() }).parse(match);
        readEvidence.add(`${evidence.path}:${evidence.line}`);
      }
    }
    return output;
  };
  const budgetExceeded = (usage: AgentExecutionResult['usage']) => {
    const limits = prepared.request.budget.limits;
    return (limits.maxInputTokens !== undefined && usage.inputTokens !== undefined && usage.inputTokens > limits.maxInputTokens)
      || (limits.maxOutputTokens !== undefined && usage.outputTokens !== undefined && usage.outputTokens > limits.maxOutputTokens)
      || (limits.maxCost !== undefined && usage.cost !== undefined && usage.cost.micros > limits.maxCost.micros);
  };
  let stopTimer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  let result: AnalysisResult;
  let providerResult: AgentExecutionResult | undefined;
  let runtimeLaunched = false;
  let runtimeSettled = false;
  try {
    if (prepared.request.budget.enforcement === 'best-effort') {
      await event({ type: 'budget_warning', reason: 'Token, cost and native turn controls are best-effort; unknown usage is not zero.' });
    }
    runtimeLaunched = true;
    const execution = provider.execute(prepared.request, {
      signal: controller.signal,
      invokeTool,
      authorize: async (action) => {
        try {
          controller.signal.throwIfAborted();
          if (action.executionId !== prepared.request.executionId) throw new Error('Authorization execution ID does not match.');
          authorizeTool(action.toolId, action.arguments);
          return { decision: 'allow', authorizationId: action.callId };
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          failure ??= { status: 'failed', reason };
          await event({ type: 'tool_denied', toolId: action.toolId, callId: action.callId, reason });
          controller.abort();
          return { decision: 'deny', reason };
        }
      },
      onEvent: async (incoming) => {
        try {
          if (stopped) throw new Error('Provider event received after analysis stopped.');
          if (incoming.executionId !== prepared.request.executionId) throw new Error('Provider event execution ID does not match.');
          const payload = executionEventSchema.parse(incoming).payload;
          if (payload.type === 'tool_denied') {
            failure ??= { status: 'failed', reason: payload.reason };
            controller.abort();
          }
          if (payload.type === 'artifact') addArtifact(artifactSchema.parse(payload.artifact));
          if (payload.type === 'usage') {
            const usage = usageMeasurementSchema.parse(payload.usage);
            if (budgetExceeded(usage)) {
              failure ??= { status: 'budget_exceeded', reason: 'Reported usage exceeds the analysis budget.' };
              controller.abort();
            }
          }
          await event(payload);
        } catch (error) {
          failure ??= { status: 'failed', reason: error instanceof Error ? error.message : String(error) };
          controller.abort();
          throw error;
        }
      },
    }).then((value) => {
      runtimeSettled = true;
      return value;
    }, (error: unknown) => {
      runtimeSettled = true;
      throw error;
    });
    const stoppedWithoutResult = Symbol('stopped-without-result');
    const interruption = new Promise<typeof stoppedWithoutResult>((resolve) => {
      onAbort = () => { stopTimer = setTimeout(() => resolve(stoppedWithoutResult), 100); };
      controller.signal.addEventListener('abort', onAbort, { once: true });
      if (controller.signal.aborted) onAbort();
    });
    const rawResult = await Promise.race([execution, interruption]);
    providerResult = rawResult === stoppedWithoutResult ? undefined : agentExecutionResultSchema.parse(rawResult);
    for (const artifact of providerResult?.artifacts ?? []) addArtifact(artifact);
    await eventWrites;
    if (storageError) throw storageError;
    const artifacts = [...observedArtifacts];
    if (!providerResult) result = { status: 'interrupted',
      reason: `${failure?.reason ?? 'Analysis was aborted.'} Runtime did not confirm stopping within 100 ms.`, artifacts };
    else if (failure) result = { ...failure, artifacts, providerResult };
    else if (controller.signal.aborted) result = {
      status: providerResult.status === 'cancelled' ? 'cancelled' : 'interrupted',
      reason: 'Analysis was aborted during execution.', artifacts, providerResult,
    };
    else if (providerResult.status !== 'succeeded') result = {
      status: providerResult.status,
      reason: 'reason' in providerResult ? providerResult.reason
        : 'error' in providerResult ? providerResult.error.message : 'Provider budget exceeded.',
      artifacts, providerResult,
    };
    else if (budgetExceeded(providerResult.usage)) result = {
      status: 'budget_exceeded', reason: 'Final usage exceeds the analysis budget.', artifacts, providerResult,
    };
    else {
      if (Buffer.byteLength(JSON.stringify(providerResult.output)) > MAX_CONTEXT_BYTES) throw new Error('Analysis output exceeds 1 MB.');
      const raw: unknown = typeof providerResult.output === 'string' ? JSON.parse(providerResult.output) : providerResult.output;
      if (prepared.request.output.kind !== 'json') throw new Error('Prepared output is not JSON.');
      validateJsonValue(prepared.request.output.schema, raw);
      if (snapshotId(prepared.workspace) !== prepared.bundle.workspaceSnapshotId) throw new Error('Analysis workspace snapshot changed.');
      const report = analysisReportSchema.parse(raw);
      for (const observation of report.observations) {
        for (const evidence of observation.evidence) {
          canonicalPath(evidence.path);
          if (!Object.hasOwn(prepared.workspace.files, evidence.path)
            || evidence.line > prepared.workspace.files[evidence.path].split(/\r?\n/).length
            || !readEvidence.has(`${evidence.path}:${evidence.line}`)) {
            throw new Error(`Report evidence is missing or was not observed by an authorized tool: ${evidence.path}:${evidence.line}`);
          }
        }
      }
      result = { status: 'succeeded', report, artifacts, providerResult };
    }
  } catch (error) {
    controller.abort();
    stopped = true;
    result = { status: runtimeLaunched && !runtimeSettled ? 'interrupted' : storageError ? 'failed' : failure?.status ?? 'failed',
      reason: storageError ? (storageError instanceof Error ? storageError.message : String(storageError))
        : failure?.reason ?? (error instanceof Error ? error.message : String(error)),
      artifacts: [...observedArtifacts], providerResult };
  } finally {
    stopped = true;
    clearTimeout(timeout);
    clearTimeout(stopTimer);
    signal.removeEventListener('abort', abort);
    if (onAbort) controller.signal.removeEventListener('abort', onAbort);
  }
  // Persist exactly once; a publication failure rejects rather than returning a success.
  await store.saveResult(prepared.request.executionId, result);
  return result;
}
