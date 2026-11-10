import test from 'node:test';
import assert from 'node:assert/strict';
import { CopilotClient, type MessageOptions, type SessionConfig } from '@github/copilot-sdk';
import { taskDraftInputSchema, taskDraftResultSchema } from '../../shared/types/taskDraft';
import { boardApi } from '../../src/data/boardApi';
import { CodeGraph } from './codeGraph';
import { GRAPHIFY_SKILL_DIRECTORY, GRAPHIFY_SKILL_INSTRUCTION } from './graphifySkill';
import { TaskAssistant, taskDraftMessage, TICKET_AUTHORING_SKILLS } from './taskAssistant';
import { ASSISTANT_PLANNING_SKILL, AUTO_ASSISTANT_AGENT, PLAN_ASSISTANT_AGENT } from './assistantModes';
import { readFile } from 'node:fs/promises';
import { parse as parseYaml } from 'yaml';

const input = taskDraftInputSchema.parse({
  title: 'Add export', currentDescription: 'Keep the existing format', priority: 'High',
  agentModel: 'ticket-model', acceptanceCriteria: ['Preserve ordering'], subtasks: ['Read the exporter'],
  contextFiles: [
    { id: '83b55352-1a04-4fb7-9ec0-72cd6ca7269b', name: 'requirements.md', mimeType: 'text/markdown', size: 4, data: 'dGVzdA==' },
    { id: 'aeebafcd-f014-481b-9659-e3951be21488', name: 'design.pdf', mimeType: 'application/pdf', size: 3, data: 'AP8K' },
  ],
});
const project = { id: 'project', name: 'Exports', description: 'The project being edited' };
const proposal = {
  title: 'Add export', description: 'Preserve the current export format.',
  acceptanceCriteria: ['Existing rows retain their order.'], subtasks: ['Extend the exporter.'],
  suggestedWorkflow: 'Test the exporter.', estimatedStoryPoints: 3,
  suggestedTags: ['export'], impactAnalysis: 'Inspect src/export.ts; graph limitations are noted.',
};

test('ticket authoring skills are discoverable and technology-neutral', async () => {
  for (const name of TICKET_AUTHORING_SKILLS) {
    const text = await readFile(new URL(`../skills/${name}/SKILL.md`, import.meta.url), 'utf8');
    const frontmatter = text.match(/^---\n([\s\S]*?)\n---/);
    assert.ok(frontmatter);
    const metadata = parseYaml(frontmatter[1]);
    assert.equal(metadata.name, name);
    assert.ok(metadata.description.length > 30);
    assert.doesNotMatch(text, /Symfony|PHPUnit|PHPStan/);
  }
});

test('feature breakdown applies the authoring skills, returns validated dependencies and keeps read-only permissions', async (t) => {
  t.mock.method(CopilotClient.prototype, 'start', async () => {});
  t.mock.method(CopilotClient.prototype, 'stop', async () => []);
  t.mock.method(CopilotClient.prototype, 'getAuthStatus', async () => ({ isAuthenticated: true }));
  const draft = { summary: 'Two slices', impactAnalysis: 'Unverified without a repository', openQuestions: ['Confirm format'],
    tasks: [{ ...proposal, id: 'first', priority: 'Medium', dependsOn: [] },
      { ...proposal, id: 'second', priority: 'Low', dependsOn: ['first'] }] };
  let content = JSON.stringify(draft);
  const create = t.mock.method(CopilotClient.prototype, 'createSession', async (_config: SessionConfig) => ({
    sendAndWait: async (message: MessageOptions) => {
      assert.equal(JSON.parse(message.prompt).purpose, 'breakdown');
      return { data: { content } };
    },
  }));
  const assistant = new TaskAssistant();
  const request = { input, project, signal: new AbortController().signal };
  const result = await assistant.generateBreakdown(request);
  assert.deepEqual(result, { kind: 'proposal', ...draft, graphAvailable: false });
  const configuration = create.mock.calls[0].arguments[0];
  assert.deepEqual(configuration.availableTools, ['skill']);
  assert.match(configuration.systemMessage?.content ?? '', /ticket-decomposition/);
  const hook = configuration.hooks?.onPreToolUse;
  assert.ok(hook);
  // The host rejects unrelated skills even though discovery uses a shared directory.
  assert.equal((await hook({
    toolName: 'skill', toolArgs: { skill: 'untrusted' }, timestamp: new Date(),
    sessionId: 'fixture', workingDirectory: '/fixture',
  }, { sessionId: 'fixture' }))?.permissionDecision, 'deny');
  content = JSON.stringify({ ...draft, tasks: [{ ...draft.tasks[0], dependsOn: ['missing'] }] });
  await assert.rejects(assistant.generateBreakdown(request), { status: 502 });
  content = JSON.stringify({ kind: 'plan', plan: 'Confirm scope, then draft slices.', reason: 'Product decision' });
  assert.equal((await assistant.generateBreakdown(request)).kind, 'plan');
  await assert.rejects(assistant.generateBreakdown({ ...request, input: { ...input, approvedPlan: 'Confirmed' } }), { status: 502 });
});

test('task drafting sends the unsaved requirements and attachments, not a graph or skill body', () => {
  const message = taskDraftMessage({ input, project });
  const prompt = JSON.parse(message.prompt);
  assert.equal(prompt.phase, 'draft');
  assert.deepEqual(prompt.project, project);
  assert.equal(prompt.task.currentDescription, input.currentDescription);
  assert.deepEqual(prompt.task.acceptanceCriteria, ['Preserve ordering']);
  assert.equal(prompt.task.contextFiles[0].content, 'test');
  assert.equal(prompt.task.contextFiles[0].data, undefined);
  assert.deepEqual(message.attachments, [{ type: 'blob', data: 'AP8K', mimeType: 'application/pdf', displayName: 'design.pdf' }]);
  assert.equal(prompt.codeGraph, undefined);
  assert.doesNotMatch(message.prompt, /## Workflow/);
});

test('ticket authoring clarifies in Auto, uses submitted answers and preserves plan contracts without further question rounds', async (t) => {
  t.mock.method(CopilotClient.prototype, 'start', async () => {});
  const stop = t.mock.method(CopilotClient.prototype, 'stop', async () => []);
  t.mock.method(CopilotClient.prototype, 'getAuthStatus', async () => ({ isAuthenticated: true }));
  let content = JSON.stringify({ kind: 'clarification', reason: 'Missing output format', questions: ['Which format?'] });
  const send = t.mock.fn(async (_message: MessageOptions) => ({ data: { content } }));
  const create = t.mock.method(CopilotClient.prototype, 'createSession', async (_config: SessionConfig) => ({ sendAndWait: send }));
  const assistant = new TaskAssistant();
  const request = { input, project, signal: new AbortController().signal };
  for (const generate of [assistant.generate.bind(assistant), assistant.generateBreakdown.bind(assistant)]) {
    assert.deepEqual(await generate(request), {
      kind: 'clarification', reason: 'Missing output format', questions: ['Which format?'], graphAvailable: false,
    });
    await assert.rejects(generate({ ...request, input: { ...input, mode: 'plan' } }), { status: 502 });
    await assert.rejects(generate({ ...request, input: { ...input, approvedPlan: 'Use CSV' } }), { status: 502 });
    await assert.rejects(generate({ ...request, input: {
      ...input, clarificationAnswers: [{ question: 'Which format?', answer: 'CSV' }],
    } }), { status: 502, message: /more clarification/ });
  }
  content = JSON.stringify(proposal);
  const answers = [{ question: 'Which format?', answer: 'CSV' }];
  const result = await assistant.generate({ ...request, input: { ...input, clarificationAnswers: answers } });
  assert.equal(result.kind, 'proposal');
  const prompt = JSON.parse(send.mock.calls.at(-1)!.arguments[0].prompt);
  assert.deepEqual(prompt.task.clarificationAnswers, answers);
  assert.equal(prompt.approvedPlan, undefined);
  assert.deepEqual(create.mock.calls[0].arguments[0].availableTools, ['skill']);
  assert.match(create.mock.calls[0].arguments[0].systemMessage?.content ?? '', /structured clarification/);
  content = JSON.stringify({ kind: 'clarification', reason: 'Missing format', questions: [] });
  await assert.rejects(assistant.generate(request), { status: 502, message: /invalid clarification/ });
  assert.equal(stop.mock.callCount(), send.mock.callCount());
});

test('task drafting uses the native skill, the selected model and read-only project tools', async (t) => {
  const graph = new CodeGraph();
  const dispose = t.mock.fn(async () => undefined);
  const query = t.mock.fn(async () => 'export dependencies');
  const prepare = t.mock.method(graph, 'prepare', async () => ({
    report: 'GRAPH_REPORT_NOT_IN_PROMPT', query, explain: query, path: query, affected: query, dispose,
  }));
  t.mock.method(CopilotClient.prototype, 'start', async () => {});
  const stop = t.mock.method(CopilotClient.prototype, 'stop', async () => []);
  t.mock.method(CopilotClient.prototype, 'getAuthStatus', async () => ({ isAuthenticated: true }));
  let configuration: SessionConfig | undefined;
  const send = t.mock.fn(async (_message: MessageOptions) => ({ data: { content: JSON.stringify(proposal) } }));
  t.mock.method(CopilotClient.prototype, 'createSession', async (config: SessionConfig) => {
    configuration = config;
    return { sendAndWait: send };
  });
  const signal = new AbortController().signal;
  const result = await new TaskAssistant(graph).generate({ input, project, workspace: '/project-clone', signal });
  assert.deepEqual(result, { kind: 'proposal', ...proposal, graphAvailable: true });
  assert.equal(configuration?.agent, AUTO_ASSISTANT_AGENT);
  assert.deepEqual(configuration?.customAgents?.map((agent) => [agent.name, agent.skills, agent.infer]), [
    [AUTO_ASSISTANT_AGENT, [ASSISTANT_PLANNING_SKILL, ...TICKET_AUTHORING_SKILLS], false],
    [PLAN_ASSISTANT_AGENT, [ASSISTANT_PLANNING_SKILL, ...TICKET_AUTHORING_SKILLS], false],
  ]);
  assert.equal(JSON.parse(send.mock.calls[0].arguments[0].prompt).mode, 'auto');
  assert.deepEqual(prepare.mock.calls[0].arguments, ['/project-clone', signal]);
  assert.equal(configuration?.model, 'ticket-model');
  assert.equal(configuration?.workingDirectory, '/project-clone');
  assert.equal(configuration?.enableSkills, true);
  assert.deepEqual(configuration?.skillDirectories, [GRAPHIFY_SKILL_DIRECTORY]);
  assert.ok(configuration?.systemMessage?.content?.includes(GRAPHIFY_SKILL_INSTRUCTION));
  assert.doesNotMatch(JSON.stringify(configuration) + JSON.stringify(send.mock.calls), /GRAPH_REPORT_NOT_IN_PROMPT|## Workflow/);
  assert.deepEqual(configuration?.availableTools, [
    'skill', 'ticket_graph_query', 'ticket_graph_explain', 'ticket_graph_path', 'ticket_graph_affected',
    'ticket_list_files', 'ticket_read_file', 'ticket_search_files',
  ]);
  assert.equal(dispose.mock.callCount(), 1);
  assert.equal(stop.mock.callCount(), 1);
});

test('plan mode returns an editable plan, and an approved plan is applied by the auto agent', async (t) => {
  t.mock.method(CopilotClient.prototype, 'start', async () => {});
  t.mock.method(CopilotClient.prototype, 'stop', async () => []);
  t.mock.method(CopilotClient.prototype, 'getAuthStatus', async () => ({ isAuthenticated: true }));
  const plan = { kind: 'plan', plan: '1. Split the export ticket.', reason: 'The scope spans two features.' };
  let content = JSON.stringify(plan);
  const send = t.mock.fn(async (_message: MessageOptions) => ({ data: { content } }));
  const create = t.mock.method(CopilotClient.prototype, 'createSession', async () => ({ sendAndWait: send }));
  const assistant = new TaskAssistant();
  const signal = new AbortController().signal;
  assert.deepEqual(await assistant.generate({ input: { ...input, mode: 'plan' }, project, signal }), { ...plan, graphAvailable: false });
  assert.equal(create.mock.calls[0].arguments[0]?.agent, PLAN_ASSISTANT_AGENT);
  assert.equal(JSON.parse(send.mock.calls[0].arguments[0].prompt).mode, 'plan');

  content = JSON.stringify(proposal);
  await assert.rejects(assistant.generate({ input: { ...input, mode: 'plan' }, project, signal }), { status: 502, message: /instead of the requested plan/ });
  const approved = { ...input, mode: 'plan' as const, approvedPlan: '1. Split the export ticket.' };
  assert.equal((await assistant.generate({ input: approved, project, signal })).kind, 'proposal');
  assert.equal(create.mock.calls[2].arguments[0]?.agent, AUTO_ASSISTANT_AGENT);
  const prompt = JSON.parse(send.mock.calls[2].arguments[0].prompt);
  assert.equal(prompt.approvedPlan, '1. Split the export ticket.');
  assert.equal(prompt.task.approvedPlan, undefined);
  content = JSON.stringify(plan);
  await assert.rejects(assistant.generate({ input: approved, project, signal }), { status: 502, message: /another plan/ });
  assert.deepEqual(await assistant.generate({ input, project, signal }), { ...plan, graphAvailable: false });
});

test('without a repository drafting still loads the skill but cannot inspect an unrelated workspace', async (t) => {
  const graph = new CodeGraph();
  const prepare = t.mock.method(graph, 'prepare', async () => { throw new Error('Must not build'); });
  t.mock.method(CopilotClient.prototype, 'start', async () => {});
  t.mock.method(CopilotClient.prototype, 'stop', async () => []);
  t.mock.method(CopilotClient.prototype, 'getAuthStatus', async () => ({ isAuthenticated: true }));
  const create = t.mock.method(CopilotClient.prototype, 'createSession', async () => ({
    sendAndWait: async () => ({ data: { content: JSON.stringify(proposal) } }),
  }));
  const result = await new TaskAssistant(graph).generate({ input, project, signal: new AbortController().signal });
  assert.equal(result.graphAvailable, false);
  assert.equal(prepare.mock.callCount(), 0);
  const config = create.mock.calls[0].arguments[0];
  assert.deepEqual(config?.availableTools, ['skill']);
  assert.equal(config?.enableHostGitOperations, false);
  assert.equal(config?.skipCustomInstructions, true);
});

test('unavailable graphs retain source tools and drafting uses server or runtime model defaults', async (t) => {
  const previousModel = process.env.COPILOT_MODEL;
  t.after(() => {
    if (previousModel === undefined) delete process.env.COPILOT_MODEL;
    else process.env.COPILOT_MODEL = previousModel;
  });
  t.mock.method(CopilotClient.prototype, 'start', async () => {});
  t.mock.method(CopilotClient.prototype, 'stop', async () => []);
  t.mock.method(CopilotClient.prototype, 'getAuthStatus', async () => ({ isAuthenticated: true }));
  const create = t.mock.method(CopilotClient.prototype, 'createSession', async () => ({
    sendAndWait: async () => ({ data: { content: JSON.stringify(proposal) } }),
  }));
  const assistant = new TaskAssistant(new CodeGraph({ enabled: false }));
  const request = { input: { ...input, agentModel: undefined }, project, workspace: '/project', signal: new AbortController().signal };
  process.env.COPILOT_MODEL = 'server-model';
  assert.equal((await assistant.generate(request)).graphAvailable, false);
  const config = create.mock.calls[0].arguments[0];
  assert.equal(config?.model, 'server-model');
  assert.deepEqual(config?.availableTools, ['skill', 'ticket_list_files', 'ticket_read_file', 'ticket_search_files']);
  delete process.env.COPILOT_MODEL;
  await assistant.generate(request);
  assert.equal(create.mock.calls[1].arguments[0]?.model, undefined);
});

test('invalid input, unauthenticated runs and malformed proposals fail explicitly', async (t) => {
  const start = t.mock.method(CopilotClient.prototype, 'start', async () => {});
  const stop = t.mock.method(CopilotClient.prototype, 'stop', async () => []);
  const auth = t.mock.method(CopilotClient.prototype, 'getAuthStatus', async () => ({ isAuthenticated: false }));
  const assistant = new TaskAssistant();
  const request = { input, project, signal: new AbortController().signal };
  await assert.rejects(assistant.generate({ ...request, input: { ...input, title: ' ' } }), { status: 400 });
  assert.equal(start.mock.callCount(), 0);
  await assert.rejects(assistant.generate(request), { status: 503, message: /not authenticated/ });
  auth.mock.mockImplementation(async () => ({ isAuthenticated: true }));
  for (const content of ['', 'not JSON', JSON.stringify({ ...proposal, impactAnalysis: '' }), JSON.stringify({ ...proposal, estimatedStoryPoints: 13 })]) {
    t.mock.method(CopilotClient.prototype, 'createSession', async () => ({ sendAndWait: async () => ({ data: { content } }) }));
    await assert.rejects(assistant.generate(request), { status: 502 });
  }
  assert.equal(stop.mock.callCount(), 5);
});

test('timeouts and cancellation release the draft graph and do not return a fake specification', async (t) => {
  const graph = new CodeGraph();
  const dispose = t.mock.fn(async () => undefined);
  t.mock.method(graph, 'prepare', async () => ({
    report: '', query: async () => '', explain: async () => '', path: async () => '', affected: async () => '', dispose,
  }));
  t.mock.method(CopilotClient.prototype, 'start', async () => {});
  const stop = t.mock.method(CopilotClient.prototype, 'stop', async () => []);
  const forceStop = t.mock.method(CopilotClient.prototype, 'forceStop', async () => []);
  t.mock.method(CopilotClient.prototype, 'getAuthStatus', async () => ({ isAuthenticated: true }));
  const controller = new AbortController();
  const assistant = new TaskAssistant(graph);
  const request = { input, project, workspace: '/project', signal: controller.signal };
  t.mock.method(CopilotClient.prototype, 'createSession', async () => ({
    sendAndWait: async () => { throw new Error('Timed out waiting for response'); },
  }));
  await assert.rejects(assistant.generate(request), { status: 502, message: /Timed out/ });
  t.mock.method(CopilotClient.prototype, 'createSession', async () => ({
    sendAndWait: async () => { controller.abort(); return { data: { content: JSON.stringify(proposal) } }; },
  }));
  await assert.rejects(assistant.generate(request), { name: 'AbortError' });
  assert.equal(forceStop.mock.callCount(), 1);
  assert.equal(dispose.mock.callCount(), 2);
  assert.equal(stop.mock.callCount(), 2);
});

test('the browser uses the project-scoped SDK endpoint with validated drafts, results and cancellation', async (t) => {
  const result = taskDraftResultSchema.parse({ kind: 'proposal', ...proposal, graphAvailable: true });
  const fetch = t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(result), {
    headers: { 'Content-Type': 'application/json' },
  }));
  const signal = new AbortController().signal;
  assert.deepEqual(await boardApi.assistTask('a/b', input, signal), result);
  assert.equal(fetch.mock.calls[0].arguments[0], '/api/board/projects/a%2Fb/tasks/assistant');
  assert.equal(fetch.mock.calls[0].arguments[1]?.signal, signal);
  await assert.rejects(boardApi.assistTask('project', { ...input, title: ' ' }), { status: 400 });
  assert.equal(fetch.mock.callCount(), 1);
  fetch.mock.mockImplementation(async () => new Response(JSON.stringify({ error: 'Copilot is not authenticated.' }), {
    status: 503, headers: { 'Content-Type': 'application/json' },
  }));
  await assert.rejects(boardApi.assistTask('project', input), { status: 503, message: 'Copilot is not authenticated.' });
});
