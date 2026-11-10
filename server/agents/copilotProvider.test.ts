import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { agentContextSchema, type AgentCheckScript, type AgentRuntime } from '../../shared/types/agent';
import type { SessionConfig } from '@github/copilot-sdk';
import { CodeGraph } from './codeGraph';
import { GRAPHIFY_SKILL_DIRECTORY, GRAPHIFY_SKILL_INSTRUCTION } from './graphifySkill';

test('Copilot telemetry captures creation events, ephemeral usage and the actual prompt and configuration', async (t) => {
  const { CopilotClient } = await import('@github/copilot-sdk');
  const { CopilotProvider } = await import('./copilotProvider');
  const writes: AgentRuntime[] = [];
  const selectedModels: Array<string | undefined> = [];
  const previousModel = process.env.COPILOT_MODEL;
  process.env.COPILOT_MODEL = 'server-default-model';
  t.after(() => {
    if (previousModel === undefined) delete process.env.COPILOT_MODEL;
    else process.env.COPILOT_MODEL = previousModel;
  });
  const now = '2026-11-03T10:00:00Z';
  t.mock.method(CopilotClient.prototype, 'start', async () => undefined);
  t.mock.method(CopilotClient.prototype, 'stop', async () => []);
  t.mock.method(CopilotClient.prototype, 'getAuthStatus', async () => ({ isAuthenticated: true }));
  t.mock.method(CopilotClient.prototype, 'createSession', async (configuration: SessionConfig) => {
    selectedModels.push(configuration.model);
    assert.ok(configuration.systemMessage?.content?.includes(GRAPHIFY_SKILL_INSTRUCTION));
    assert.equal(configuration.enableSkills, true);
    assert.deepEqual(configuration.skillDirectories, [GRAPHIFY_SKILL_DIRECTORY]);
    assert.ok(Array.isArray(configuration.availableTools));
    assert.ok(configuration.availableTools?.includes('skill'));
    assert.ok(configuration.onEvent, 'capture must be registered before session creation');
    configuration.onEvent({
      id: 'early-start', parentId: null, timestamp: now, type: 'session.start',
      data: { sessionId: 'sdk-fixture', startTime: now, version: 1, producer: 'fixture', copilotVersion: 'test-version', selectedModel: 'fixture-model' },
    });
    return {
      sessionId: 'sdk-fixture',
      on: () => () => undefined,
      sendAndWait: async () => {
        configuration.onEvent?.({
          id: 'ephemeral-usage', parentId: 'early-start', timestamp: now, type: 'assistant.usage', ephemeral: true,
          data: { model: 'fixture-model', inputTokens: 40, outputTokens: 10, cost: 0.25 },
        });
        return { data: { content: 'Read-only plan ready.' } };
      },
    };
  });
  const context = agentContextSchema.parse({
    project: null, feature: null,
    task: { id: 'sdk-fixture', title: 'Inspect telemetry', description: 'Read only',
      agentProvider: 'copilot', agentModel: 'ticket-selected-model',
      status: 'In Progress', priority: 'Medium', tags: [], acceptanceCriteria: [], subtasks: [],
      order: 0, storyPoints: 1, createdAt: now, updatedAt: now },
  });
  const output = await new CopilotProvider().run({
    context, workspace: '/fixture', phase: 'plan', plan: '', answers: [],
    onSession: async (id) => assert.equal(id, 'sdk-fixture'),
    onRuntime: async (runtime) => { writes.push(runtime); },
    ask: async () => 'answer',
  });
  assert.equal(output, 'Read-only plan ready.');
  const final = writes.at(-1)!;
  assert.equal(final.status, 'completed');
  assert.equal(final.metadata.requestedModel, 'ticket-selected-model');
  assert.equal(selectedModels[0], 'ticket-selected-model');
  assert.equal(final.providerSessionId, 'sdk-fixture');
  assert.deepEqual(final.events.map((event) => event.type), ['session.start', 'assistant.usage']);
  assert.equal(final.events[1].ephemeral, true);
  const metadata = JSON.stringify(final.metadata);
  assert.ok(metadata.includes('READ ONLY:'));
  assert.ok(metadata.includes('ticket_read_file'));
  assert.ok(metadata.includes('Inspect telemetry'));
  for (const phase of ['execute', 'review'] as const) {
    await new CopilotProvider().run({
      context, workspace: '/fixture', phase, plan: '', answers: [],
      onSession: async () => undefined, ask: async () => 'answer',
    });
  }
  assert.deepEqual(selectedModels, ['ticket-selected-model', 'ticket-selected-model', 'ticket-selected-model']);
  const defaults = { ...context, task: { ...context.task, agentModel: undefined } };
  await new CopilotProvider().run({
    context: defaults, workspace: '/fixture', phase: 'plan', plan: '', answers: [],
    onSession: async () => undefined, ask: async () => 'answer',
  });
  assert.equal(selectedModels.at(-1), 'server-default-model');
  delete process.env.COPILOT_MODEL;
  await new CopilotProvider().run({
    context: defaults, workspace: '/fixture', phase: 'plan', plan: '', answers: [],
    onSession: async () => undefined, ask: async () => 'answer',
  });
  assert.equal(selectedModels.at(-1), undefined);
  await new CopilotProvider().run({
    context: defaults, resolvedModel: 'orchestrator-default-model', workspace: '/fixture', phase: 'plan', plan: '', answers: [],
    onRuntime: async (runtime) => { writes.push(runtime); },
    onSession: async () => undefined, ask: async () => 'answer',
  });
  assert.equal(selectedModels.at(-1), 'orchestrator-default-model');
  assert.equal(writes.at(-1)?.metadata.requestedModel, 'orchestrator-default-model');
  t.mock.method(CopilotClient.prototype, 'createSession', async () => {
    throw new Error('Model "orchestrator-default-model" is not available');
  });
  await assert.rejects(new CopilotProvider().run({
    context: defaults, resolvedModel: 'orchestrator-default-model', workspace: '/fixture', phase: 'plan', plan: '', answers: [],
    onSession: async () => undefined, ask: async () => 'answer',
  }), /Server default model.*COPILOT_MODEL/);
});

test('all ticket phases discover the skill and query tools without injecting its body or a graph summary', async (t) => {
  const { CopilotClient } = await import('@github/copilot-sdk');
  const { CopilotProvider } = await import('./copilotProvider');
  const graph = new CodeGraph();
  const query = t.mock.fn(async (_question: string, _budget?: number) => 'verified dependency');
  const dispose = t.mock.fn(async () => undefined);
  t.mock.method(graph, 'prepare', async () => ({
    report: 'GRAPH_SUMMARY_MUST_NOT_BE_INJECTED',
    query, explain: async () => 'component', path: async () => 'path',
    affected: async () => 'callers', dispose,
  }));
  t.mock.method(CopilotClient.prototype, 'start', async () => undefined);
  t.mock.method(CopilotClient.prototype, 'stop', async () => []);
  t.mock.method(CopilotClient.prototype, 'getAuthStatus', async () => ({ isAuthenticated: true }));
  const configs: SessionConfig[] = [];
  t.mock.method(CopilotClient.prototype, 'createSession', async (configuration: SessionConfig) => {
    configs.push(configuration);
    return {
      sessionId: 'graph-fixture', on: () => () => undefined,
      sendAndWait: async (message: { prompt: string }) => {
        assert.equal(JSON.parse(message.prompt).codeGraph, undefined);
        assert.doesNotMatch(JSON.stringify(configuration) + message.prompt, /GRAPH_SUMMARY_MUST_NOT_BE_INJECTED/);
        return { data: { content: 'Impact report' } };
      },
    };
  });
  const now = new Date().toISOString();
  const context = agentContextSchema.parse({
    project: null, feature: null,
    task: { id: 'graph-fixture', title: 'Inspect dependencies', description: 'Analyze impact',
      tags: [], acceptanceCriteria: [], subtasks: [], status: 'In Progress',
      priority: 'Medium', order: 0, storyPoints: 1, createdAt: now, updatedAt: now },
  });
  for (const phase of ['plan', 'execute', 'review'] as const) {
    await new CopilotProvider(graph).run({
      context, workspace: '/fixture', phase, plan: '', answers: [],
      onSession: async () => undefined, ask: async () => 'answer',
    });
    const config = configs.at(-1)!;
    const instructions = config.systemMessage?.content ?? '';
    assert.ok(instructions.includes(GRAPHIFY_SKILL_INSTRUCTION));
    assert.doesNotMatch(instructions, /## Workflow|## Step 1|Ticket Graphify analysis/);
    assert.equal(config.enableSkills, true);
    assert.equal(config.enableConfigDiscovery, false);
    assert.equal(config.skipCustomInstructions, true);
    assert.deepEqual(config.skillDirectories, [GRAPHIFY_SKILL_DIRECTORY]);
    assert.ok(Array.isArray(config.availableTools));
    assert.ok(config.availableTools?.includes('skill'));
    for (const tool of ['query', 'explain', 'path', 'affected']) {
      assert.ok(config.availableTools?.includes(`ticket_graph_${tool}`));
    }
    assert.equal(config.availableTools?.includes('ticket_write_file'), phase === 'execute');
    assert.equal(config.availableTools?.includes('ticket_ask_user'), phase !== 'review');
    for (const tool of ['bash', 'view', 'edit', 'task']) assert.equal(config.availableTools?.includes(tool), false);
  }
  const queryTool = configs[0].tools?.find((tool) => tool.name === 'ticket_graph_query');
  assert.ok(queryTool?.handler);
  const args = { question: 'Find dependencies', budget: 2000 };
  await queryTool.handler(args, {
    sessionId: 'graph-fixture', toolCallId: 'query-fixture',
    toolName: 'ticket_graph_query', arguments: args,
  });
  assert.deepEqual(query.mock.calls[0].arguments, ['Find dependencies', 2000]);
  assert.equal(dispose.mock.callCount(), 3);
});

test('Copilot model catalogue excludes disabled models and releases the client even on failure', async (t) => {
  const { CopilotClient } = await import('@github/copilot-sdk');
  const { CopilotProvider } = await import('./copilotProvider');
  t.mock.method(CopilotClient.prototype, 'start', async () => undefined);
  const stop = t.mock.method(CopilotClient.prototype, 'stop', async () => []);
  const auth = t.mock.method(CopilotClient.prototype, 'getAuthStatus', async () => ({ isAuthenticated: true }));
  const capabilities = { supports: { vision: false, reasoningEffort: false }, limits: { max_context_window_tokens: 128_000 } };
  const models = t.mock.method(CopilotClient.prototype, 'listModels', async () => [
    { id: 'z', name: 'Z model', capabilities },
    { id: 'disabled', name: 'Disabled', capabilities, policy: { state: 'disabled' as const, terms: '' } },
    { id: 'a', name: 'A model', capabilities, policy: { state: 'enabled' as const, terms: '' } },
  ]);
  assert.deepEqual(await new CopilotProvider().models(), [{ id: 'a', name: 'A model' }, { id: 'z', name: 'Z model' }]);
  models.mock.mockImplementation(async () => { throw new Error('Model service unavailable'); });
  await assert.rejects(new CopilotProvider().models(), /Model service unavailable/);
  auth.mock.mockImplementation(async () => ({ isAuthenticated: false }));
  await assert.rejects(new CopilotProvider().models(), /Authenticate/);
  assert.equal(stop.mock.callCount(), 3);
});

test('unavailable Copilot models produce an actionable error naming the source', async () => {
  const { unavailableModelError } = await import('./copilotProvider');
  const cause = new Error('Request session.create failed with message: session construction failed: Model "hydrafusion" is not available.');
  assert.match(unavailableModelError(cause, 'hydrafusion', false)?.message ?? '', /Server default model "hydrafusion" \(COPILOT_MODEL\)/);
  assert.match(unavailableModelError(cause, 'x', true)?.message ?? '', /selected on this ticket.*Edit the ticket/);
  assert.equal(unavailableModelError(cause, 'x', true)?.cause, cause);
  assert.equal(unavailableModelError(new Error('network down'), 'x', true), null);
  assert.equal(unavailableModelError(cause, undefined, false), null);
});

test('Copilot can inspect a fixture and implement only with execution tools', {
  skip: process.env.COPILOT_LIVE_TEST !== '1',
  timeout: 180_000,
}, async () => {
  const { CopilotProvider } = await import('./copilotProvider');
  const workspace = await mkdtemp(path.join(tmpdir(), 'kanban-copilot-live-'));
  const marker = randomUUID();
  const now = new Date().toISOString();
  try {
    await writeFile(path.join(workspace, 'README.md'), `Verification marker: ${marker}\n`);
    await writeFile(path.join(workspace, 'package.json'), JSON.stringify({
      private: true, scripts: { test: 'node -e "console.log(\'fixture check passed\')"' },
    }));
    const context = agentContextSchema.parse({
      project: null, feature: null,
      task: {
        id: 'fixture', title: 'Read README.md, include its verification marker in the plan, then copy that marker into result.txt after approval',
        description: 'Do not write during planning. First ask the user with ticket_ask_user which output filename to use, offering result.txt and other.txt. After implementation, run npm test using ticket_run_checks. This is a throwaway fixture.',
        status: 'In Progress', priority: 'Medium', tags: [], acceptanceCriteria: ['result.txt contains the marker from README.md'],
        subtasks: [], order: 0, storyPoints: 1, createdAt: now, updatedAt: now,
      },
    });
    const ids: string[] = [];
    const provider = new CopilotProvider(CodeGraph.fromEnv());
    const onSession = async (id: string) => { ids.push(id); };
    let questions = 0;
    const ask = async () => { questions++; return 'result.txt'; };
    const plan = await provider.run({ context, workspace, phase: 'plan', plan: '', onSession, ask, answers: [] });
    assert.ok(plan.includes(marker), `Planning must read the fixture using the registered tool: ${plan}`);
    assert.ok(questions > 0, 'Copilot must route clarification through the provider-neutral ask callback');
    await assert.rejects(readFile(path.join(workspace, 'result.txt')));
    const checks: { script: AgentCheckScript; passed: boolean; output: string }[] = [];
    const output = await provider.run({
      context, workspace, phase: 'execute', plan, onSession, ask,
      answers: [{ question: 'Output filename?', answer: 'result.txt' }],
      recordCheck: async (result) => { checks.push(result); },
    });
    assert.ok(output.trim());
    assert.equal((await readFile(path.join(workspace, 'result.txt'), 'utf8')).trim(), marker);
    assert.equal(ids.length, 2);
    assert.ok(checks.some((check) => check.script === 'test' && check.passed && check.output.includes('fixture check passed')), 'Copilot must persist structured check outcomes');
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
