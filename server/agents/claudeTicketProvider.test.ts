import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Options, McpServerConfig, SpawnedProcess } from '@anthropic-ai/claude-agent-sdk';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { agentContextSchema, type AgentRuntime } from '../../shared/types/agent';
import { ClaudeTicketProvider } from './claudeTicketProvider';
import { CLAUDE_ANALYSIS_RUNTIME_VERSION } from './adapters/claudeAnalysisProvider';
import type { AgentRequest } from './provider';

async function fixture(t: TestContext, phase: AgentRequest['phase'] = 'execute',
  respond: (client: Client, options: Options) => Promise<void> = async () => {},
  extraMessages: ({ type: string } & Record<string, unknown>)[] = []) {
  const workspace = await mkdtemp(path.join(tmpdir(), 'claude-ticket-test-'));
  await writeFile(path.join(workspace, 'service.ts'), 'original');
  const children: SpawnedProcess[] = [];
  const directories: string[] = [];
  const runtimes: AgentRuntime[] = [];
  let prompts = 0;
  let options: Options | undefined;
  t.after(async () => {
    for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    for (const directory of [workspace, ...directories]) await rm(directory, { recursive: true, force: true });
  });
  const provider = new ClaudeTicketProvider({
    enabled: true, apiKey: 'offline-ticket-placeholder',
    createQuery: (input) => {
      options = input.options!;
      assert.ok(options.cwd && options.spawnClaudeCodeProcess);
      directories.push(options.cwd);
      const child = options.spawnClaudeCodeProcess({
        command: process.execPath, args: ['-e', 'process.stdin.resume()'],
        cwd: options.cwd, env: options.env!, signal: options.abortController!.signal,
      });
      children.push(child);
      child.on('error', () => {});
      return {
        close: () => { child.kill('SIGTERM'); },
        accountInfo: async () => ({ apiKeySource: 'env' }),
        supportedModels: async () => [{ value: 'fixture', displayName: 'Fixture', description: 'Offline' }],
        initializationResult: async () => ({ hooks_applied: true, hook_on_failure_supported: true, agents: [] }),
        mcpServerStatus: async () => [{
          name: 'analysis', source: 'sdk', status: 'connected',
          tools: Object.keys(options!.mcpServers ?? {}).length ? await toolNames(options!) : [],
        }],
        [Symbol.asyncIterator]: async function* () {
          assert.notEqual(typeof input.prompt, 'string');
          if (typeof input.prompt === 'string') throw new Error('Expected gated input.');
          for await (const _message of input.prompt) {
            prompts++;
            const config: McpServerConfig = options!.mcpServers!.analysis;
            assert.equal(config.type, 'sdk');
            if (config.type !== 'sdk') throw new Error('Expected SDK MCP server.');
            const client = new Client({ name: 'offline', version: '1' });
            const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
            await config.instance.connect(serverTransport);
            await client.connect(clientTransport);
            try {
              const { tools } = await client.listTools();
              yield {
                type: 'system', subtype: 'init', session_id: 'ticket-session', claude_code_version: CLAUDE_ANALYSIS_RUNTIME_VERSION,
                cwd: options!.cwd, model: 'fixture', permissionMode: 'default',
                skills: [], plugins: [], agents: ['Explore'],
                tools: tools.map(({ name }) => `mcp__analysis__${name}`),
                mcp_servers: [{ name: 'analysis', source: 'sdk', status: 'connected' }],
              };
              yield* extraMessages;
              await respond(client, options!);
              yield {
                type: 'result', subtype: 'success', is_error: false, permission_denials: [],
                result: 'Ticket complete', session_id: 'ticket-session',
              };
            } finally { await client.close(); }
          }
        },
      };
    },
  });
  // Metadata is obtained without connecting twice to the same in-process MCP server.
  async function toolNames(configuration: Options) {
    const config = configuration.mcpServers!.analysis;
    assert.equal(config.type, 'sdk');
    if (config.type !== 'sdk') throw new Error('Expected SDK server.');
    const captured: string[] = [];
    const system = String(configuration.systemPrompt);
    for (const match of system.matchAll(/ -> mcp__analysis__(ticket_[a-z_]+)/g)) captured.push(match[1]);
    return captured.map((name) => ({ name }));
  }
  const now = new Date().toISOString();
  const request: AgentRequest = {
    context: agentContextSchema.parse({ project: null, feature: null, task: {
      id: 'ticket-fixture', title: 'Implement service', description: '', agentProvider: 'claude-code', agentModel: 'fixture',
      status: 'In Progress', priority: 'Medium', tags: [], acceptanceCriteria: [], subtasks: [], storyPoints: 1,
      order: 0, createdAt: now, updatedAt: now,
    } }),
    workspace, phase, plan: 'Approved implementation', answers: [],
    onSession: async (id) => assert.equal(id, 'ticket-session'),
    onRuntime: async (runtime) => { runtimes.push(runtime); }, ask: async () => 'Confirmed',
  };
  return { provider, request, workspace, runtimes, children, directories, prompts: () => prompts, options: () => options };
}

test('experimental Claude ticket execution uses the host MCP tools and persists telemetry without credentials', async (t) => {
  const runtime = await fixture(t, 'execute', async (client) => {
    assert.equal((await client.callTool({ name: 'ticket_write_file', arguments: { path: 'service.ts', content: 'implemented' } })).isError, undefined);
    const question = await client.callTool({ name: 'ticket_ask_user', arguments: { question: 'Confirm?', choices: [] } });
    assert.ok(JSON.stringify(question).includes('Confirmed'));
  });
  assert.equal(await runtime.provider.run(runtime.request), 'Ticket complete');
  assert.equal(await readFile(path.join(runtime.workspace, 'service.ts'), 'utf8'), 'implemented');
  assert.equal(runtime.prompts(), 1);
  assert.notEqual(runtime.options()?.cwd, runtime.workspace);
  assert.deepEqual(runtime.options()?.tools, []);
  assert.equal(runtime.runtimes.at(-1)?.status, 'completed');
  assert.equal(runtime.runtimes.at(-1)?.metadata.provider, 'claude-code');
  assert.ok(runtime.runtimes.at(-1)?.events.some((event) => event.type === 'tool.execution_complete' && event.data.success === true));
  assert.ok(!JSON.stringify(runtime.runtimes).includes('offline-ticket-placeholder'));
  for (const directory of runtime.directories) await assert.rejects(access(directory), { code: 'ENOENT' });
  assert.ok(runtime.children.every((child) => child.exitCode !== null || child.signalCode !== null));
});

for (const phase of ['plan', 'review'] as const) {
  test(`Claude ${phase} exposes no write or command tools`, async (t) => {
    const runtime = await fixture(t, phase, async (client) => {
      const { tools } = await client.listTools();
      assert.ok(!tools.some(({ name }) => /write|delete|directory|checks|approval/.test(name)));
      assert.equal(tools.some(({ name }) => name === 'ticket_ask_user'), phase === 'plan');
    });
    await runtime.provider.run(runtime.request);
    assert.equal(await readFile(path.join(runtime.workspace, 'service.ts'), 'utf8'), 'original');
  });
}

test('Claude adaptive approval prevents all later writes in that run', async (t) => {
  let requested = false;
  const runtime = await fixture(t, 'execute', async (client) => {
    await client.callTool({ name: 'ticket_request_plan_approval', arguments: { plan: 'Concrete plan', reason: 'Shared API change' } });
    const result = await client.callTool({ name: 'ticket_write_file', arguments: { path: 'service.ts', content: 'not allowed' } });
    assert.equal(result.isError, true);
  });
  runtime.request.adaptive = true;
  runtime.request.requestPlanApproval = async () => { requested = true; };
  await runtime.provider.run(runtime.request);
  assert.equal(requested, true);
  assert.equal(await readFile(path.join(runtime.workspace, 'service.ts'), 'utf8'), 'original');
  assert.equal(runtime.runtimes.at(-1)?.phase, 'plan');
});

test('Claude native tool attempts remain failures even if followed by a successful result', async (t) => {
  const runtime = await fixture(t, 'execute', undefined, [{
    type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'tool_use', name: 'Bash', id: 'forbidden' }] },
  }]);
  await assert.rejects(runtime.provider.run(runtime.request), /Non-broker tool requested: Bash/);
  assert.equal(runtime.runtimes.at(-1)?.status, 'failed');
});

test('Claude persistence failures cannot be swallowed by MCP into a successful ticket', async (t) => {
  const runtime = await fixture(t, 'execute', async (client) => {
    await client.callTool({ name: 'ticket_ask_user', arguments: { question: 'Confirm?', choices: [] } });
  });
  runtime.request.ask = async () => { throw new Error('Question database unavailable'); };
  await assert.rejects(runtime.provider.run(runtime.request), /Question database unavailable/);
});

test('Claude is disabled without explicit activation and does not start a runtime', async () => {
  let started = false;
  const provider = new ClaudeTicketProvider({ enabled: false, createQuery: () => { started = true; throw new Error('Must not start'); } });
  await assert.rejects(provider.models(), /disabled/);
  await assert.rejects(provider.health(), /disabled/);
  assert.equal(started, false);
});

test('Claude requires a dedicated key before inspecting models or starting a runtime', async () => {
  let started = false;
  const provider = new ClaudeTicketProvider({
    enabled: true, createQuery: () => { started = true; throw new Error('Must not start'); },
  });
  await assert.rejects(provider.models(), /KANBAN_CLAUDE_API_KEY/);
  await assert.rejects(provider.health(), /KANBAN_CLAUDE_API_KEY/);
  assert.equal(started, false);
});

test('Claude refuses a missing model and binary attachments before starting a runtime', async (t) => {
  const runtime = await fixture(t);
  runtime.request.context.task.agentModel = undefined;
  await assert.rejects(runtime.provider.run(runtime.request), /explicit Claude model/);
  runtime.request.context.task.agentModel = 'fixture';
  runtime.request.context.task.contextFiles = [{
    id: '550e8400-e29b-41d4-a716-446655440000', name: 'image.png',
    mimeType: 'image/png', size: 1, data: 'AA==',
  }];
  await assert.rejects(runtime.provider.run(runtime.request), /UTF-8 text context only/);
  assert.equal(runtime.children.length, 0);
  assert.equal(runtime.prompts(), 0);
});

test('Claude accepts its resolved server default without changing the saved ticket selection', async (t) => {
  const runtime = await fixture(t);
  runtime.request.context.task.agentModel = undefined;
  runtime.request.resolvedModel = 'fixture';
  assert.equal(await runtime.provider.run(runtime.request), 'Ticket complete');
  assert.equal(runtime.request.context.task.agentModel, undefined);
  assert.equal(runtime.runtimes.at(-1)?.metadata.requestedModel, 'fixture');
});

test('Claude cancellation while persisting the final response cannot publish completed telemetry', async (t) => {
  const runtime = await fixture(t);
  const controller = new AbortController();
  runtime.request.signal = controller.signal;
  runtime.request.onContent = async () => { controller.abort(new Error('Cancelled final response')); };
  await assert.rejects(runtime.provider.run(runtime.request), /Cancelled final response/);
  assert.equal(runtime.runtimes.at(-1)?.status, 'cancelled');
  assert.ok(runtime.children.every((child) => child.exitCode !== null || child.signalCode !== null));
});

test('Claude stream cancellation propagates to the child and does not publish success', async (t) => {
  const runtime = await fixture(t, 'execute', undefined, [{
    type: 'stream_event', parent_tool_use_id: null,
    event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Partial response' } },
  }]);
  const controller = new AbortController();
  runtime.request.signal = controller.signal;
  runtime.request.onContent = async () => { controller.abort(new Error('User cancelled')); };
  await assert.rejects(runtime.provider.run(runtime.request), /User cancelled/);
  assert.equal(runtime.runtimes.at(-1)?.status, 'cancelled');
  for (const directory of runtime.directories) await assert.rejects(access(directory), { code: 'ENOENT' });
  assert.ok(runtime.children.every((child) => child.exitCode !== null || child.signalCode !== null));
});
