import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDefinitionCatalog, type AgentExecutionResult, type DefinitionCatalogInput,
  type ExecutionEvent, runWorkflow,
} from './core/index';
import {
  prepareAnalysis, runAnalysis, type AnalysisHost, type AnalysisResult,
  type AnalysisStore, type AnalysisTask, type AnalysisWorkspace,
} from './core/analysis';
import { FakeAIProvider, type FakeExecution } from './core/testing/fakeProvider';
import { contentHash, immutable, type DeepReadonly } from './core/snapshot';
import { renderPrompt, validateJsonValue } from './core/prompt';
import { loadDefinitionContext } from './core/definitionLoader';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const report = {
  summary: 'The service is read-only.',
  observations: [{ description: 'A service class exists.', evidence: [{ path: 'src/service.ts', line: 1 }] }],
  limitations: ['Semantic correctness still requires review.'],
};
const reply = (output: unknown = report): AgentExecutionResult & { status: 'succeeded' } => ({
  status: 'succeeded',
  output: JSON.stringify(output),
  usage: { basis: 'unavailable' },
  artifacts: [],
});
const source = { uri: 'managed/definitions', sha256: contentHash('fixture'), trust: 'managed' as const };
const input = (): DefinitionCatalogInput => ({
  instructions: [{
    id: 'common', schemaVersion: 1, version: '1', description: 'Common rules', source,
    scope: 'global', priority: 0, content: 'Report only sourced observations.',
  }, {
    id: 'another-agent', schemaVersion: 1, version: '1', description: 'Other agent', source,
    scope: 'agent', priority: 0, content: 'UNRELATED_AGENT_INSTRUCTION',
    appliesWhen: { agentIds: ['reviewer'] },
  }],
  skills: [{
    id: 'analysis', name: 'analysis', schemaVersion: 1, version: '1', description: 'Analysis skill',
    source, entrypoint: 'SKILL.md', instructions: 'READ_ONLY_ANALYSIS_SKILL',
    activation: { mode: 'required' }, dependencies: [], requiredTools: ['repository.read'],
    resources: [{ path: 'references/checklist.md', kind: 'reference', sha256: contentHash('checklist') }],
  }],
  prompts: [{
    id: 'analyze', schemaVersion: 1, version: '1', description: 'Analysis prompt', source,
    template: 'Analyze {{question}}',
    variablesSchema: { type: 'object', properties: { question: { type: 'string' } },
      required: ['question'], additionalProperties: false },
    output: { kind: 'json', schema: { type: 'object' } },
  }],
  agents: [{
    id: 'analyst', schemaVersion: 1, version: '1', description: 'Analyst', source, name: 'Analyst',
    role: 'Repository analysis', instructionIds: ['common'], skillIds: ['analysis'], promptId: 'analyze',
    tools: ['repository.list', 'repository.read', 'repository.search', 'skill.load'],
    autonomy: 'semi', policyId: 'readonly', executionProfileId: 'default',
    budget: { enforcement: 'strict', limits: { maxToolCalls: 5, maxDurationMs: 5000, maxAttempts: 1 } },
  }],
  policies: [{
    id: 'readonly', schemaVersion: 1, version: '1', description: 'Read only', source,
    defaultEffect: 'deny',
    rules: [{ id: 'read-tools', tools: ['repository.list', 'repository.read', 'repository.search', 'skill.load'], effect: 'allow' }],
    workspace: { readablePaths: ['src'], writablePaths: [], network: 'deny', allowedHosts: [] },
  }],
  executionProfiles: [{
    id: 'default', schemaVersion: 1, version: '1', description: 'Fake profile', source,
    fallback: 'disabled', targets: [{ providerId: 'fake', modelId: 'fake-model' }],
  }],
  workflows: [],
});
const task: AnalysisTask = {
  id: 'task-1', agentId: 'analyst', executionProfileId: 'default',
  paths: ['src'], variables: { question: 'the service' },
};
const workspace: AnalysisWorkspace = {
  id: 'workspace-1', root: 'memory://workspace', baseRevision: 'fixture',
  files: { 'src/service.ts': 'export class Service {}\n// fixture', '.env': 'EXCLUDED_HOST_FILE' },
};
const script: FakeExecution = async (_request, controls) => {
  assert.equal(await controls.invokeTool?.('repository.read', {
    path: 'src/service.ts', startLine: 1, endLine: 1,
  }), 'export class Service {}');
  return reply();
};
function host(provider: FakeAIProvider): AnalysisHost {
  return {
    providers: [provider],
    qualifications: [{ providerId: 'fake', modelId: 'fake-model', sdkVersion: 'test',
      evidenceId: 'offline-fake-broker-test', exclusiveToolBroker: true }],
    resourceContents: { [contentHash('checklist')]: Buffer.from('checklist').toString('base64') },
  };
}
class MemoryStore implements AnalysisStore {
  prepared: DeepReadonly<Parameters<AnalysisStore['savePrepared']>[0]>[] = [];
  events: ExecutionEvent[] = [];
  results: AnalysisResult[] = [];
  async savePrepared(value: Parameters<AnalysisStore['savePrepared']>[0]) { this.prepared.push(immutable(value)); }
  async appendEvent(event: ExecutionEvent) { this.events.push(structuredClone(event)); }
  async saveResult(_id: string, result: AnalysisResult) { this.results.push(structuredClone(result)); }
}
const run = (provider = new FakeAIProvider([script]), definitions = input(), store = new MemoryStore(), signal = new AbortController().signal) =>
  runAnalysis(task, buildDefinitionCatalog(definitions), workspace, host(provider), store, signal);

test('read-only analysis prepares, invokes a bounded tool, verifies and stores the report', async () => {
  const provider = new FakeAIProvider([script]);
  const store = new MemoryStore();
  const result = await run(provider, input(), store);
  assert.equal(result.status, 'succeeded');
  assert.deepEqual(result.report, report);
  assert.equal(store.prepared.length, 1);
  assert.equal(store.results.length, 1);
  assert.deepEqual(store.events.map(({ sequence }) => sequence), [0, 1, 2]);
  assert.equal(provider.requests[0].prompt.includes('READ_ONLY_ANALYSIS_SKILL'), true);
  assert.equal(provider.requests[0].prompt.includes('UNRELATED_AGENT_INSTRUCTION'), false);
  assert.equal(store.prepared[0].workspace.files['.env'], undefined);
  assert.equal(store.prepared[0].capabilityPlan.structuredOutput, 'validated-json');
});

test('preparation freezes resource contents, variables and snapshots', async () => {
  const provider = new FakeAIProvider();
  const mutableHost = host(provider);
  const mutableWorkspace = structuredClone(workspace);
  const first = await prepareAnalysis(task, buildDefinitionCatalog(input()), mutableWorkspace, mutableHost, new AbortController().signal);
  const second = await prepareAnalysis(task, buildDefinitionCatalog(input()), workspace, host(provider), new AbortController().signal);
  assert.equal(first.request.snapshotId, second.request.snapshotId);
  mutableWorkspace.files['src/service.ts'] = 'changed';
  assert.equal(first.workspace.files['src/service.ts'], workspace.files['src/service.ts']);
  assert.equal(Object.isFrozen(first.bundle.skills[0].resources), true);
  const changed = input();
  changed.skills[0].resources[0].sha256 = contentHash('new-checklist');
  const third = await prepareAnalysis(task, buildDefinitionCatalog(changed), workspace, {
    ...host(provider), resourceContents: { [contentHash('new-checklist')]: Buffer.from('new-checklist').toString('base64') },
  }, new AbortController().signal);
  assert.notEqual(first.request.snapshotId, third.request.snapshotId);
  assert.equal(first.bundle.skills[0].resources[0].base64, Buffer.from('checklist').toString('base64'));
});

test('invalid variables, unqualified runtimes, bad resources and strict token limits fail before launch', async () => {
  const provider = new FakeAIProvider([script]);
  const catalog = buildDefinitionCatalog(input());
  const signal = new AbortController().signal;
  await assert.rejects(prepareAnalysis({ ...task, variables: {} }, catalog, workspace, host(provider), signal), /required/);
  await assert.rejects(prepareAnalysis(task, catalog, workspace, { ...host(provider), qualifications: [] }, signal), /qualified/);
  await assert.rejects(prepareAnalysis(task, catalog, workspace, {
    ...host(provider), resourceContents: { [contentHash('checklist')]: Buffer.from('wrong').toString('base64') },
  }, signal), /hash mismatch/);
  const strict = input();
  strict.agents[0].budget.limits.maxInputTokens = 100;
  assert.equal((await run(provider, strict)).status, 'failed');
  assert.equal(provider.requests.length, 0);
});

test('broker refuses escapes, writing, command tools, invalid arguments and excessive reads', async () => {
  for (const [toolId, args] of [
    ['repository.read', { path: '../.env', startLine: 1, endLine: 1 }],
    ['repository.read', { path: '.env', startLine: 1, endLine: 1 }],
    ['repository.write', { path: 'src/service.ts', content: 'changed' }],
    ['shell', { command: 'echo changed' }],
    ['repository.read', { path: 'src/service.ts', startLine: 1, endLine: 501 }],
    ['repository.list', { extra: true }],
  ] as const) {
    const provider = new FakeAIProvider([async (_request, controls) => {
      await assert.rejects(controls.invokeTool!(toolId, { ...args }));
      return reply();
    }]);
    const store = new MemoryStore();
    assert.equal((await run(provider, input(), store)).status, 'failed');
    assert.equal(store.events.some(({ payload }) => payload.type === 'tool_denied'), true);
    assert.equal(workspace.files['src/service.ts'], 'export class Service {}\n// fixture');
  }
});

test('malformed reports and nonexistent evidence never succeed', async () => {
  for (const output of [
    'not-json',
    { ...report, extra: true },
    { ...report, observations: [{ description: 'No evidence', evidence: [] }] },
    { ...report, observations: [{ description: 'Wrong line', evidence: [{ path: 'src/service.ts', line: 99 }] }] },
    { ...report, observations: [{ description: 'Secret', evidence: [{ path: '.env', line: 1 }] }] },
  ]) {
    const provider = new FakeAIProvider([typeof output === 'string'
      ? { ...reply(), output }
      : reply(output)]);
    assert.equal((await run(provider)).status, 'failed');
  }
  assert.equal((await run(new FakeAIProvider([reply()]))).status, 'failed', 'An unobserved citation is not verified evidence.');
});

test('pre-aborted analysis does not invoke providers or store preparation', async () => {
  const provider = new FakeAIProvider([script]);
  const store = new MemoryStore();
  const controller = new AbortController();
  controller.abort();
  assert.equal((await run(provider, input(), store, controller.signal)).status, 'cancelled');
  assert.equal(provider.requests.length, 0);
  assert.equal(store.prepared.length, 0);
});

test('cancellation requires confirmation and ignored cancellation becomes interrupted', async () => {
  for (const confirms of [true, false]) {
    const controller = new AbortController();
    const provider = new FakeAIProvider([async (_request, controls) => {
      controller.abort();
      if (!confirms) return new Promise(() => {});
      return { status: 'cancelled', reason: 'Confirmed', artifacts: [], usage: { basis: 'unavailable' } };
    }]);
    const result = await run(provider, input(), new MemoryStore(), controller.signal);
    assert.equal(result.status, confirms ? 'cancelled' : 'interrupted');
  }
});

test('tool-call and duration budgets are enforced by the host', async () => {
  const limited = input();
  limited.agents[0].budget.limits.maxToolCalls = 0;
  const exceeds = new FakeAIProvider([script]);
  assert.equal((await run(exceeds, limited)).status, 'budget_exceeded');
  const timed = input();
  timed.agents[0].budget.limits.maxDurationMs = 10;
  const interrupted = await run(new FakeAIProvider([async () => new Promise(() => {})]), timed);
  assert.equal(interrupted.status, 'interrupted');
  assert.match(interrupted.reason!, /duration budget exceeded/);
});

test('storage failure requests runtime cancellation and prevents publication', async () => {
  const store = new MemoryStore();
  store.appendEvent = async () => { throw new Error('Event storage unavailable'); };
  let providerSignal: AbortSignal | undefined;
  const provider = new FakeAIProvider([async (_request, controls) => {
    providerSignal = controls.signal;
    return reply();
  }]);
  const result = await run(provider, input(), store);
  assert.equal(result.status, 'failed');
  assert.match(result.reason!, /storage unavailable/);
  assert.equal(store.results[0].report, undefined);
  assert.equal(provider.requests.length, 1);
  // The fake cannot even start its script when its start event cannot be persisted.
  assert.equal(providerSignal, undefined);
});

test('prompt schema subset rejects unsupported keywords and templates do not re-evaluate variables', () => {
  assert.throws(() => validateJsonValue({ type: 'string', pattern: '.*' }, 'text'), /Unrecognized/);
  assert.throws(() => validateJsonValue({ type: 'integer' }, 1.5), /integer/);
  assert.throws(() => validateJsonValue({ required: ['question'] }, {}), /required/);
  assert.throws(() => renderPrompt('{{question.toUpperCase()}}', { question: 'text' }, { type: 'object' }), /only support/);
  assert.equal(renderPrompt('{{question}}', { question: '{{other}}' }, { type: 'object' }), '{{other}}');
  assert.equal(renderPrompt('JSON: {"value": "{{question}}"}', { question: 'text' }, { type: 'object' }), 'JSON: {"value": "text"}');
});

test('list, search and on-demand skill tools expose only the frozen bundle and approved files', async () => {
  const definitions = input();
  definitions.skills[0].activation.mode = 'on-demand';
  const provider = new FakeAIProvider([async (request, controls) => {
    assert.equal(request.prompt.includes('READ_ONLY_ANALYSIS_SKILL'), false);
    assert.deepEqual(await controls.invokeTool!('repository.list', {}), ['src/service.ts']);
    assert.deepEqual(await controls.invokeTool!('repository.search', { text: 'export class' }), [
      { path: 'src/service.ts', line: 1, text: 'export class Service {}' },
    ]);
    const skill = await controls.invokeTool!('skill.load', { id: 'analysis' });
    assert.deepEqual(skill, {
      content: 'READ_ONLY_ANALYSIS_SKILL',
      resources: [{ path: 'references/checklist.md', kind: 'reference',
        sha256: contentHash('checklist'), base64: Buffer.from('checklist').toString('base64') }],
    });
    return reply();
  }]);
  assert.equal((await run(provider, definitions)).status, 'succeeded');
});

test('provider profile switching preserves the agent and context but changes the request snapshot', async () => {
  class SecondProvider extends FakeAIProvider { readonly id: string = 'second'; }
  const firstProvider = new FakeAIProvider([script]);
  const secondProvider = new SecondProvider([script]);
  const firstHost = host(firstProvider);
  const combinedHost: AnalysisHost = {
    ...firstHost, providers: [firstProvider, secondProvider],
    qualifications: [...firstHost.qualifications, {
      ...firstHost.qualifications[0], providerId: 'second', evidenceId: 'second-fake-qualification',
    }],
  };
  const definitions = input();
  definitions.executionProfiles.push({
    ...definitions.executionProfiles[0], id: 'second-profile',
    targets: [{ providerId: 'second', modelId: 'fake-model' }],
  });
  const catalog = buildDefinitionCatalog(definitions);
  const first = await prepareAnalysis(task, catalog, workspace, combinedHost, new AbortController().signal);
  const secondTask = { ...task, executionProfileId: 'second-profile' };
  const second = await prepareAnalysis(secondTask, catalog, workspace, combinedHost, new AbortController().signal);
  assert.deepEqual(first.request.agent, second.request.agent);
  assert.deepEqual(first.request.tools, second.request.tools);
  assert.equal(first.request.prompt, second.request.prompt);
  assert.equal(first.bundle.id, second.bundle.id);
  assert.notEqual(first.request.snapshotId, second.request.snapshotId);
  assert.equal((await runAnalysis(secondTask, catalog, workspace, combinedHost, new MemoryStore(), new AbortController().signal)).status, 'succeeded');
});

test('the same canonical workflow executes verified analysis through either fake profile', async () => {
  class SecondProvider extends FakeAIProvider { readonly id: string = 'second'; }
  const first = new FakeAIProvider([script]);
  const second = new SecondProvider([script]);
  const firstHost = host(first);
  const combinedHost: AnalysisHost = {
    ...firstHost, providers: [first, second],
    qualifications: [...firstHost.qualifications, { ...firstHost.qualifications[0], providerId: 'second' }],
  };
  const definitions = input();
  definitions.executionProfiles.push({
    ...definitions.executionProfiles[0], id: 'alternative',
    targets: [{ providerId: 'second', modelId: 'fake-model' }],
  });
  definitions.workflows.push({
    schemaVersion: 1, id: 'analyze-flow', version: '1', description: 'Read-only analysis', source,
    steps: [{ kind: 'agent', id: 'analyze-step', agentId: 'analyst', inputs: {} }],
  });
  const catalog = buildDefinitionCatalog(definitions);
  for (const profile of ['default', 'alternative']) {
    const store = new MemoryStore();
    const controller = new AbortController();
    const result = await runWorkflow(catalog.workflows[0], {
      agent: async (step) => {
        assert.equal(step.kind, 'agent');
        const analysis = await runAnalysis({ ...task, executionProfileId: profile }, catalog, workspace,
          combinedHost, store, controller.signal);
        return analysis.status === 'succeeded'
          ? { status: 'succeeded', artifacts: analysis.artifacts }
          : { status: 'failed', reason: analysis.reason ?? analysis.status };
      },
      verification: async () => { throw new Error('No separate verifier in this one-step workflow'); },
      approval: async () => { throw new Error('No approval in a read-only workflow'); },
    }, { signal: controller.signal });
    assert.equal(result.status, 'succeeded');
    assert.deepEqual(store.results[0].report, report);
  }
});

test('dependencies of required skills are injected and unknown runtime permissions are refused', async () => {
  const definitions = input();
  definitions.skills.push({
    ...definitions.skills[0], id: 'dependency', name: 'dependency', instructions: 'DEPENDENCY_SKILL',
    resources: [], activation: { mode: 'on-demand' },
  });
  definitions.skills[0].dependencies = ['dependency'];
  const prepared = await prepareAnalysis(task, buildDefinitionCatalog(definitions), workspace, host(new FakeAIProvider()), new AbortController().signal);
  assert.equal(prepared.request.prompt.includes('DEPENDENCY_SKILL'), true);
  class UnknownPermissions extends FakeAIProvider {
    async getCapabilities(target?: Parameters<FakeAIProvider['getCapabilities']>[0]) {
      const capabilities = await super.getCapabilities(target);
      capabilities.features.blockingToolPermissions = 'unknown';
      return capabilities;
    }
  }
  await assert.rejects(prepareAnalysis(task, buildDefinitionCatalog(input()), workspace,
    host(new UnknownPermissions()), new AbortController().signal), /no qualified/);
});

test('preparation rejects oversized context and policy scope mismatches', async () => {
  await assert.rejects(prepareAnalysis({ ...task, paths: ['.'] }, buildDefinitionCatalog(input()), workspace,
    host(new FakeAIProvider()), new AbortController().signal), /outside the readable policy/);
  await assert.rejects(prepareAnalysis({ ...task, variables: { question: 'x'.repeat(1_000_001) } },
    buildDefinitionCatalog(input()), workspace, host(new FakeAIProvider()), new AbortController().signal), /context exceeds/);
});

test('broker accepts exactly 500 lines and caps serialized read results at 100 KB', async () => {
  const controller = new AbortController();
  const lines = Array.from({ length: 500 }, (_, index) => `line ${index + 1}`).join('\n');
  const provider = new FakeAIProvider([async (_request, controls) => {
    assert.equal(await controls.invokeTool!('repository.read', {
      path: 'src/service.ts', startLine: 1, endLine: 500,
    }), lines);
    return reply();
  }]);
  assert.equal((await runAnalysis(task, buildDefinitionCatalog(input()),
    { ...workspace, files: { 'src/service.ts': lines } }, host(provider), new MemoryStore(), controller.signal)).status, 'succeeded');
  for (const length of [99_998, 99_999]) {
    const bounded = new FakeAIProvider([async (_request, controls) => {
      const read = controls.invokeTool!('repository.read', { path: 'src/service.ts', startLine: 1, endLine: 1 });
      if (length === 99_998) {
        const content = await read;
        assert.ok(typeof content === 'string');
        assert.equal(content.length, length);
      }
      else await assert.rejects(read, /100 KB/);
      return reply();
    }]);
    const result = await runAnalysis(task, buildDefinitionCatalog(input()),
      { ...workspace, files: { 'src/service.ts': 'x'.repeat(length) } }, host(bounded),
      new MemoryStore(), new AbortController().signal);
    assert.equal(result.status, length === 99_998 ? 'succeeded' : 'failed');
  }
});

test('best-effort reported usage exceeds limits without treating unknown usage as zero', async () => {
  const definitions = input();
  definitions.agents[0].budget.enforcement = 'best-effort';
  definitions.agents[0].budget.limits.maxInputTokens = 10;
  const store = new MemoryStore();
  const provider = new FakeAIProvider([async (request, controls) => {
    await controls.onEvent({
      executionId: request.executionId, sequence: 1, occurredAt: new Date(0).toISOString(),
      payload: { type: 'usage', usage: { inputTokens: 11, basis: 'reported' } },
    });
    return { status: 'cancelled', reason: 'Stopped', usage: { basis: 'unavailable' }, artifacts: [] };
  }]);
  assert.equal((await run(provider, definitions, store)).status, 'budget_exceeded');
  assert.equal(store.events[0].payload.type, 'budget_warning');
});

test('final storage failure rejects exactly once instead of returning successful analysis', async () => {
  const store = new MemoryStore();
  let writes = 0;
  store.saveResult = async () => { writes++; throw new Error('Report storage failed'); };
  await assert.rejects(run(new FakeAIProvider([script]), input(), store), /Report storage failed/);
  assert.equal(writes, 1);
});

test('invalid provider events cannot be ignored to obtain a successful report', async () => {
  const provider = new FakeAIProvider([async (request, controls) => {
    await assert.rejects(controls.onEvent({
      executionId: request.executionId, sequence: 1, occurredAt: new Date(0).toISOString(),
      payload: { type: 'usage', usage: { basis: 'reported', inputTokens: -1 } },
    }));
    return reply();
  }]);
  assert.equal((await run(provider)).status, 'failed');
});

test('artifacts emitted as events and final results are preserved only once', async () => {
  const artifact = { id: 'partial-plan', name: 'plan', kind: 'plan' as const,
    uri: 'memory://plan', sha256: contentHash('plan') };
  const provider = new FakeAIProvider([async (request, controls) => {
    await controls.onEvent({ executionId: request.executionId, sequence: 1, occurredAt: new Date(0).toISOString(),
      payload: { type: 'artifact', artifact } });
    const response = await script(request, controls);
    return { ...response, artifacts: [artifact] };
  }]);
  const result = await run(provider);
  assert.equal(result.status, 'succeeded');
  assert.deepEqual(result.artifacts, [artifact]);
});

test('event storage failure aborts an already running fake script even if it catches the error', async () => {
  const store = new MemoryStore();
  const append = store.appendEvent.bind(store);
  store.appendEvent = async (event) => {
    if (event.payload.type !== 'started') throw new Error('Disconnected event store');
    await append(event);
  };
  const provider = new FakeAIProvider([async (request, controls) => {
    await assert.rejects(controls.onEvent({
      executionId: request.executionId, sequence: 1, occurredAt: new Date(0).toISOString(),
      payload: { type: 'text_delta', text: 'progress' },
    }), /Disconnected/);
    assert.equal(controls.signal.aborted, true);
    return reply();
  }]);
  const result = await run(provider, input(), store);
  assert.equal(result.status, 'failed');
  assert.match(result.reason!, /Disconnected/);
});

test('an event storage failure with no runtime stop confirmation remains interrupted', async () => {
  const store = new MemoryStore();
  const append = store.appendEvent.bind(store);
  store.appendEvent = async (event) => {
    if (event.payload.type !== 'started') throw new Error('Event write failed');
    await append(event);
  };
  const provider = new FakeAIProvider([async (request, controls) => {
    await assert.rejects(controls.onEvent({
      executionId: request.executionId, sequence: 1, occurredAt: new Date(0).toISOString(),
      payload: { type: 'text_delta', text: 'progress' },
    }));
    return new Promise(() => {});
  }]);
  const result = await run(provider, input(), store);
  assert.equal(result.status, 'interrupted');
  assert.match(result.reason!, /Event write failed/);
});

test('filesystem definitions feed frozen resource bytes into a complete offline analysis', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'analysis-definitions-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const definitions = input();
  definitions.instructions = definitions.instructions.slice(0, 1);
  const directories = {
    instructions: definitions.instructions, prompts: definitions.prompts, agents: definitions.agents,
    policies: definitions.policies, 'execution-profiles': definitions.executionProfiles,
  };
  for (const [directory, items] of Object.entries(directories)) {
    await mkdir(path.join(root, directory), { recursive: true });
    for (const item of items) {
      const { source: _source, ...definition } = item;
      await writeFile(path.join(root, directory, `${item.id}.json`), JSON.stringify(definition));
    }
  }
  const skillDir = path.join(root, 'skills', 'analysis');
  await mkdir(path.join(skillDir, 'references'), { recursive: true });
  await writeFile(path.join(skillDir, 'SKILL.md'), '---\nname: analysis\ndescription: Analyze source files.\n---\nREAD_ONLY_ANALYSIS_SKILL');
  await writeFile(path.join(skillDir, 'references', 'checklist.md'), 'checklist');
  const loaded = await loadDefinitionContext([{ id: 'fixture', path: root, trust: 'managed' }]);
  await writeFile(path.join(skillDir, 'references', 'checklist.md'), 'changed-after-load');
  const provider = new FakeAIProvider([async (_request, controls) => {
    const skill = await controls.invokeTool!('skill.load', { id: 'analysis' });
    assert.deepEqual(skill, {
      content: 'READ_ONLY_ANALYSIS_SKILL',
      resources: [{ path: 'references/checklist.md', kind: 'reference',
        sha256: contentHash('checklist'), base64: Buffer.from('checklist').toString('base64') }],
    });
    return script(_request, controls);
  }]);
  const result = await runAnalysis(task, loaded.catalog, workspace, {
    ...host(provider), resourceContents: loaded.resourceContents,
  }, new MemoryStore(), new AbortController().signal);
  assert.equal(result.status, 'succeeded');
});
