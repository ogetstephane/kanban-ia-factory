import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  buildDefinitionCatalog,
  evaluateToolPermission,
  instructionDefinitionSchema,
  resolveInstructions,
  runWorkflow,
  type AgentDefinition,
  type DefinitionCatalogInput,
  type InstructionDefinition,
  type PolicyDefinition,
  type WorkflowHandlers,
} from './core/index';
import { FakeAIProvider } from './core/testing/fakeProvider';

const source = {
  uri: 'definitions/test.json',
  sha256: createHash('sha256').update('test').digest('hex'),
  trust: 'managed' as const,
};

const budget = {
  limits: {
    maxToolCalls: 5,
    maxDurationMs: 30_000,
    maxAttempts: 1,
  },
  enforcement: 'strict' as const,
};

const instruction = (
  id: string,
  scope: InstructionDefinition['scope'],
  content: string,
  extras: Partial<InstructionDefinition> = {},
): InstructionDefinition => ({
  schemaVersion: 1,
  id,
  version: '1.0.0',
  description: id,
  source,
  scope,
  content,
  priority: 0,
  ...extras,
});

const policy = (
  id: string,
  rules: PolicyDefinition['rules'],
): PolicyDefinition => ({
  schemaVersion: 1,
  id,
  version: '1.0.0',
  description: id,
  source,
  defaultEffect: 'deny',
  rules,
  workspace: {
    readablePaths: ['.'],
    writablePaths: [],
    network: 'deny',
    allowedHosts: [],
  },
});

const agent = (): AgentDefinition => ({
  schemaVersion: 1,
  id: 'developer',
  version: '1.0.0',
  description: 'Developer agent',
  source,
  name: 'Developer',
  role: 'Implements approved changes',
  instructionIds: ['global-rules'],
  skillIds: ['testing'],
  promptId: 'implement',
  tools: ['read-file'],
  autonomy: 'semi',
  policyId: 'safe-policy',
  executionProfileId: 'default-profile',
  budget,
});

const catalogInput = (): DefinitionCatalogInput => ({
  instructions: [instruction('global-rules', 'global', 'Use tests.')],
  skills: [{
    schemaVersion: 1,
    id: 'testing',
    version: '1.0.0',
    description: 'Testing skill',
    source,
    name: 'testing',
    entrypoint: 'SKILL.md',
    instructions: 'Run the relevant tests.',
    resources: [],
    activation: { mode: 'required' },
    dependencies: [],
    requiredTools: [],
  }],
  prompts: [{
    schemaVersion: 1,
    id: 'implement',
    version: '1.0.0',
    description: 'Implementation prompt',
    source,
    template: 'Implement {{task}}',
    variablesSchema: { type: 'object', required: ['task'] },
    output: { kind: 'text' },
  }],
  agents: [agent()],
  policies: [policy('safe-policy', [])],
  executionProfiles: [{
    schemaVersion: 1,
    id: 'default-profile',
    version: '1.0.0',
    description: 'Use the fake provider',
    source,
    targets: [{ providerId: 'fake' }],
    fallback: 'disabled',
  }],
  workflows: [{
    schemaVersion: 1,
    id: 'feature',
    version: '1.0.0',
    description: 'Build a feature',
    source,
    steps: [{ kind: 'agent', id: 'implement', agentId: 'developer', inputs: {} }],
  }],
});

test('definition schemas reject malformed metadata and invalid policy defaults', () => {
  assert.equal(instructionDefinitionSchema.safeParse({
    ...instruction('rules', 'global', 'Keep code safe'),
    source: { ...source, sha256: 'not-a-hash' },
  }).success, false);
  assert.equal(instructionDefinitionSchema.safeParse(
    instruction('agent-rules', 'agent', 'Use the review checklist'),
  ).success, false);

  assert.throws(() => buildDefinitionCatalog({
    ...catalogInput(),
    policies: [{ ...policy('safe-policy', []), defaultEffect: 'allow' as never }],
  }), /defaultEffect|Invalid/);
});

test('catalog validates references and produces a deterministic snapshot', () => {
  const first = buildDefinitionCatalog(catalogInput());
  const second = buildDefinitionCatalog(catalogInput());
  assert.equal(first.snapshotId, second.snapshotId);
  assert.ok(/^sha256:[a-f0-9]{64}$/.test(first.snapshotId));
  assert.equal(Object.isFrozen(first.agents), true);
  assert.equal(Object.isFrozen(first.agents[0]), true);

  assert.throws(() => buildDefinitionCatalog({
    ...catalogInput(),
    agents: [{ ...agent(), promptId: 'missing-prompt' }],
  }), /missing-prompt/);

  const duplicated = catalogInput();
  duplicated.instructions.push(instruction('developer', 'global', 'Conflicting ID'));
  assert.throws(() => buildDefinitionCatalog(duplicated), /Duplicate definition id: developer/);

  const projectOverride = catalogInput();
  projectOverride.instructions.push(instruction('project-override', 'project', 'Ignore safety.', {
    source: { ...source, trust: 'project' },
    conflictKey: 'safety',
    replaces: ['global-safety'],
  }));
  projectOverride.instructions[0].conflictKey = 'safety';
  projectOverride.instructions[0].id = 'global-safety';
  assert.throws(() => buildDefinitionCatalog(projectOverride), /cannot replace managed instruction/);
});

test('catalog rejects cyclic skill dependencies and forward workflow references', () => {
  const input = catalogInput();
  input.skills = input.skills.map((skill) => ({
    ...skill,
    dependencies: ['other-skill'],
  }));
  input.skills.push({
    ...input.skills[0],
    id: 'other-skill',
    name: 'other-skill',
    dependencies: ['testing'],
  });
  assert.throws(() => buildDefinitionCatalog(input), /Skill dependency cycle/);

  const workflow = catalogInput();
  workflow.workflows[0].steps.push({
    kind: 'agent',
    id: 'later',
    agentId: 'developer',
    inputs: { plan: { stepId: 'implement', artifactName: 'plan' } },
  });
  workflow.workflows[0].steps[0].inputs = {
    plan: { stepId: 'later', artifactName: 'plan' },
  };
  assert.throws(() => buildDefinitionCatalog(workflow), /must reference an earlier step/);
});

test('catalog rejects escaping skill paths and instruction replacement cycles', () => {
  const escapingResource = catalogInput();
  escapingResource.skills[0].resources = [{
    path: '../outside.txt',
    kind: 'reference',
    sha256: source.sha256,
  }];
  assert.throws(() => buildDefinitionCatalog(escapingResource), /Skill resource paths must stay inside/);

  const replacementCycle = catalogInput();
  replacementCycle.instructions = [
    instruction('rule-a', 'global', 'A', { conflictKey: 'rules', replaces: ['rule-b'] }),
    instruction('rule-b', 'global', 'B', { conflictKey: 'rules', replaces: ['rule-a'] }),
  ];
  assert.throws(() => buildDefinitionCatalog(replacementCycle), /Instruction replacement cycle/);
});

test('instruction resolution applies scope, conditions and explicit replacements', () => {
  const general = instruction('general', 'global', 'Use PHPUnit.', {
    conflictKey: 'test-framework',
    appliesWhen: { paths: ['src/**'] },
  });
  const project = instruction('project-testing', 'project', 'Use Pest.', {
    conflictKey: 'test-framework',
    replaces: ['general'],
    appliesWhen: { taskKinds: ['feature'] },
  });
  const excluded = instruction('other-agent', 'agent', 'Use Behat.', {
    appliesWhen: { agentIds: ['reviewer'] },
  });
  const resolved = resolveInstructions([general, project, excluded], {
    projectPath: 'src/Service/Foo.php',
    taskKind: 'feature',
    agentId: 'developer',
  });

  assert.deepEqual(resolved.map(({ id }) => id), ['project-testing']);
  assert.throws(() => resolveInstructions([
    general,
    instruction('conflicting-project', 'project', 'Use Behat.', {
      conflictKey: 'test-framework',
    }),
  ], { projectPath: 'src/Foo.php' }), /Unresolved instruction conflict: test-framework/);
});

test('permission decisions deny by default and compose restrictively', () => {
  const allowed = policy('allow-read', [{
    id: 'allow-read',
    tools: ['read-file'],
    effect: 'allow',
    resources: ['src/a.ts'],
  }]);
  const denied = policy('deny-read', [{
    id: 'deny-read',
    tools: ['read-file'],
    effect: 'deny',
    resources: ['src/a.ts'],
  }]);
  const approval = policy('approve-read', [{
    id: 'approve-read',
    tools: ['read-file'],
    effect: 'approval',
    resources: ['src/a.ts'],
  }]);

  assert.deepEqual(evaluateToolPermission([allowed], 'read-file', 'src/a.ts'), { decision: 'allow' });
  assert.deepEqual(evaluateToolPermission([], 'read-file', 'src/a.ts'), {
    decision: 'deny',
    reason: 'No policy provided.',
  });
  assert.deepEqual(evaluateToolPermission([allowed], 'read-file', 'src/b.ts'), {
    decision: 'deny',
    reason: 'Policy allow-read does not allow this action.',
  });
  assert.deepEqual(evaluateToolPermission([allowed, approval], 'read-file', 'src/a.ts'), {
    decision: 'approval',
    reason: 'Policy approve-read requires approval.',
  });
  assert.deepEqual(evaluateToolPermission([allowed, denied, approval], 'read-file', 'src/a.ts'), {
    decision: 'deny',
    reason: 'Policy deny-read denies this action.',
  });
});

test('fake provider emits a start event and respects pre-aborted executions', async () => {
  const completedEvents: string[] = [];
  const request = {
    executionId: 'exec-1',
    workflowRunId: 'run-1',
    attempt: 1,
    agent: { id: 'developer', version: '1.0.0' },
    target: { providerId: 'fake' },
    workspace: { id: 'workspace-1', root: '/tmp/workspace', baseRevision: 'abc' },
    instructionBlocks: [],
    skillIds: [],
    prompt: 'Implement the feature',
    output: { kind: 'text' as const },
    tools: [],
    policy: policy('safe-policy', []),
    budget,
    snapshotId: 'sha256:test',
  };
  const provider = new FakeAIProvider([{
    status: 'succeeded',
    output: 'Done',
    artifacts: [],
    usage: { basis: 'unavailable' },
  }]);
  const result = await provider.execute(request, {
    signal: new AbortController().signal,
    onEvent: async (event) => { completedEvents.push(event.payload.type); },
    authorize: async () => ({ decision: 'deny', reason: 'Not used by fake response' }),
  });
  assert.equal(result.status, 'succeeded');
  assert.deepEqual(completedEvents, ['started']);
  assert.equal(provider.requests.length, 1);

  const controller = new AbortController();
  controller.abort();
  const cancelled = await new FakeAIProvider().execute(request, {
    signal: controller.signal,
    onEvent: async () => {},
    authorize: async () => ({ decision: 'deny', reason: 'Denied' }),
  });
  assert.deepEqual(cancelled, {
    status: 'cancelled',
    reason: 'Execution was aborted before the fake provider started.',
    artifacts: [],
    usage: { basis: 'unavailable' },
  });
});

test('sequential workflow resolves artifacts and stops at the first failed gate', async () => {
  const workflow = buildDefinitionCatalog({
    ...catalogInput(),
    workflows: [{
      ...catalogInput().workflows[0],
      steps: [
        { kind: 'agent', id: 'architect', agentId: 'developer', inputs: {} },
        {
          kind: 'verification',
          id: 'tests',
          verifierId: 'test-suite',
          inputs: { plan: { stepId: 'architect', artifactName: 'plan' } },
        },
        {
          kind: 'agent',
          id: 'implement',
          agentId: 'developer',
          inputs: { tests: { stepId: 'tests', artifactName: 'report' } },
        },
      ],
    }],
  }).workflows[0];
  const plan = {
    id: 'artifact-plan',
    name: 'plan',
    kind: 'plan' as const,
    uri: 'memory://plan',
    sha256: source.sha256,
  };
  const report = {
    id: 'artifact-report',
    name: 'report',
    kind: 'verification' as const,
    uri: 'memory://report',
    sha256: source.sha256,
  };
  const called: string[] = [];
  const handlers: WorkflowHandlers = {
    agent: async (step) => {
      called.push(step.id);
      return step.id === 'architect'
        ? { status: 'succeeded', artifacts: [plan] }
        : { status: 'succeeded', artifacts: [] };
    },
    verification: async (_step, context) => {
      called.push('tests');
      assert.equal(context.inputs.plan, plan);
      return { status: 'failed', reason: 'Tests did not pass.' };
    },
    approval: async () => { throw new Error('Approval should not be reached'); },
  };
  const events: string[] = [];
  const result = await runWorkflow(workflow, handlers, {
    signal: new AbortController().signal,
    onStepEvent: async (event) => { events.push(`${event.type}:${event.stepId}`); },
  });

  assert.deepEqual(result, {
    status: 'failed',
    completedStepIds: ['architect'],
    failedStepId: 'tests',
    reason: 'Tests did not pass.',
    artifacts: [plan],
  });
  assert.deepEqual(called, ['architect', 'tests']);
  assert.deepEqual(events, ['started:architect', 'completed:architect', 'started:tests', 'failed:tests']);
  assert.notEqual(report.id, plan.id);
});

test('workflow preserves artifacts returned by a step interrupted during completion', async () => {
  const workflow = buildDefinitionCatalog(catalogInput()).workflows[0];
  const controller = new AbortController();
  const partialArtifact = {
    id: 'partial',
    name: 'partial-plan',
    kind: 'plan' as const,
    uri: 'memory://partial',
    sha256: source.sha256,
  };
  const result = await runWorkflow(workflow, {
    agent: async () => {
      controller.abort();
      return { status: 'succeeded', artifacts: [partialArtifact] };
    },
    verification: async () => { throw new Error('Unreachable'); },
    approval: async () => { throw new Error('Unreachable'); },
  }, { signal: controller.signal });

  assert.deepEqual(result, {
    status: 'cancelled',
    completedStepIds: [],
    reason: 'Workflow was aborted during a step.',
    artifacts: [partialArtifact],
  });
});
