import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { access, rm } from 'node:fs/promises';
import type { McpServerConfig, Options, SpawnedProcess } from '@anthropic-ai/claude-agent-sdk';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import {
  ClaudeAnalysisProvider, CLAUDE_ANALYSIS_SDK_VERSION, CLAUDE_ANALYSIS_RUNTIME_VERSION,
  type ClaudeAnalysisQuery,
} from './adapters/claudeAnalysisProvider';
import { claudeAnalysisSession, validateClaudeAnalysisInitialization, type ClaudeAnalysisInventory } from './adapters/claudeAnalysisSession';
import { prepareAnalysis, runAnalysis, type AnalysisHost, type AnalysisStore } from './core/analysis';
import { analysisFixtureCatalog, fixtureTask, fixtureWorkspace, fixtureReport } from './core/testing/analysisFixture';

const qualification = {
  providerId: 'claude-code', modelId: 'fixture-model', sdkVersion: CLAUDE_ANALYSIS_SDK_VERSION,
  runtimeVersion: CLAUDE_ANALYSIS_RUNTIME_VERSION, evidenceId: 'offline-transport-only', exclusiveToolBroker: true,
};
const store: AnalysisStore = { savePrepared: async () => {}, appendEvent: async () => {}, saveResult: async () => {} };
const catalog = () => analysisFixtureCatalog('claude-code', 'fixture-model');
const host = (provider: ClaudeAnalysisProvider): AnalysisHost => ({
  providers: [provider], qualifications: [qualification], resourceContents: {},
});
type TerminalMessage = {
  type: 'result'; subtype: string; is_error: boolean; permission_denials: unknown[];
  result: string; session_id: string; errors?: string[];
};

function fixture(
  t: TestContext,
  respond: (options: Options, client: Client) => Promise<string> = async (_options, client) => {
    const read = await client.callTool({ name: 'repository_read', arguments: { path: 'src/service.ts', startLine: 1, endLine: 1 } });
    assert.deepEqual(read.content, [{ type: 'text', text: JSON.stringify(fixtureWorkspace.files['src/service.ts']) }]);
    return JSON.stringify(fixtureReport);
  },
  inventoryChange?: (inventory: ClaudeAnalysisInventory) => void,
  hooksApplied = true,
  terminalChange: Partial<TerminalMessage> = {},
  runtimeMessages: ({ type: string } & Record<string, unknown>)[] = [],
) {
  const directories: string[] = [];
  const children: SpawnedProcess[] = [];
  const calls: Options[] = [];
  const sessions: ClaudeAnalysisQuery[] = [];
  let sent = 0;
  const provider = new ClaudeAnalysisProvider({
    apiKey: 'offline-placeholder-not-a-credential', qualifications: [qualification],
    createQuery: ({ options, prompt }): ClaudeAnalysisQuery => {
      assert.ok(options?.cwd);
      assert.ok(options.spawnClaudeCodeProcess);
      calls.push(options);
      directories.push(options.cwd);
      // Only a local inert child is used: neither the native runtime nor a model starts.
      const child = options.spawnClaudeCodeProcess({
        command: process.execPath, args: ['-e', 'process.stdin.resume()'],
        cwd: options.cwd, env: options.env ?? {}, signal: options.abortController!.signal,
      });
      children.push(child);
      child.on('error', () => {});
      const session: ClaudeAnalysisQuery = {
        close: () => { child.kill('SIGTERM'); },
        accountInfo: async () => ({ apiKeySource: 'env', apiProvider: 'firstParty' }),
        supportedModels: async () => [{ value: 'fixture-model', resolvedModel: 'fixture-model', displayName: 'Fixture', description: 'Offline' }],
        mcpServerStatus: async () => [{
          name: 'analysis', source: 'sdk', status: 'connected',
          tools: [{ name: 'repository_read' }, { name: 'repository_search' }],
        }],
        initializationResult: async () => ({
          hooks_applied: hooksApplied, hook_on_failure_supported: true,
          agents: [{ name: 'Explore', description: 'Built-in registry entry, not an available tool' }],
        }),
        [Symbol.asyncIterator]: async function* () {
          assert.notEqual(typeof prompt, 'string');
          if (typeof prompt === 'string') throw new Error('Expected gated streaming input.');
          for await (const input of prompt) {
            sent++;
            assert.match(String(input.message.content), /Analyze/);
            assert.ok(options.mcpServers?.analysis);
            const server: McpServerConfig = options.mcpServers.analysis;
            assert.equal(server.type, 'sdk');
            if (server.type !== 'sdk') throw new Error('Expected in-process MCP.');
            const client = new Client({ name: 'offline-runtime', version: '1' });
            const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
            await server.instance.connect(serverTransport);
            await client.connect(clientTransport);
            try {
              const { tools } = await client.listTools();
              const inventory: ClaudeAnalysisInventory = {
                type: 'system', subtype: 'init', claude_code_version: CLAUDE_ANALYSIS_RUNTIME_VERSION,
                cwd: options.cwd!, model: 'fixture-model', session_id: 'fixture-session',
                tools: tools.map(({ name }) => `mcp__analysis__${name}`),
                mcp_servers: [{ name: 'analysis', source: 'sdk', status: 'connected' }],
                skills: [], plugins: [], agents: ['Explore'], permissionMode: 'default',
              };
              inventoryChange?.(inventory);
              yield inventory;
              yield* runtimeMessages;
              yield { type: 'result', subtype: 'success', is_error: false, permission_denials: [],
                result: await respond(options, client), session_id: 'fixture-session', ...terminalChange };
            } finally {
              await client.close();
            }
          }
        },
      };
      sessions.push(session);
      return session;
    },
  });
  t.after(async () => {
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }
    for (const directory of directories) await rm(directory, { recursive: true, force: true });
  });
  return { provider, calls, directories, children, sessions, sent: () => sent };
}

test('Claude adapter runs the canonical analysis through a real in-memory MCP exchange', async (t) => {
  const runtime = fixture(t);
  const result = await runAnalysis(fixtureTask, catalog(), fixtureWorkspace, host(runtime.provider), store, new AbortController().signal);
  assert.equal(result.status, 'succeeded', result.reason);
  assert.deepEqual(result.report, fixtureReport);
  assert.equal(runtime.sent(), 1);
  const options = runtime.calls.at(-1)!;
  assert.deepEqual(options.tools, []);
  for (const name of ['Agent', 'Task', 'Workflow', 'Skill', 'Bash']) assert.ok(options.disallowedTools?.includes(name));
  assert.deepEqual(options.allowedTools, []);
  assert.deepEqual(options.settingSources, []);
  assert.deepEqual(options.agents, {});
  assert.deepEqual(options.skills, []);
  assert.deepEqual(options.plugins, []);
  assert.equal(options.strictMcpConfig, true);
  assert.equal(options.persistSession, false);
  assert.equal(options.permissionMode, 'default');
  assert.equal(options.allowDangerouslySkipPermissions, false);
  assert.ok(typeof options.settings === 'object' && options.settings.disableBundledSkills);
  assert.ok(typeof options.settings === 'object');
  assert.deepEqual(options.settings.skillOverrides, { doctor: 'off', 'plugin-authoring': 'off' });
  assert.deepEqual(options.settings.enabledPlugins, {
    'cc-plugin-agents-md@builtin': false,
    'cc-plugin-privacy@builtin': false,
    'cc-plugin-plugin-authoring@builtin': false,
  });
  assert.equal(options.fallbackModel, undefined);
  assert.equal(options.resume, undefined);
  assert.deepEqual(Object.keys(options.env!).sort(), ['ANTHROPIC_API_KEY', 'CLAUDE_CONFIG_DIR', 'HOME', 'TMPDIR']);
  assert.notEqual(options.cwd, fixtureWorkspace.root);
  assert.match(String(options.systemPrompt), /repository.read -> mcp__analysis__repository_read/);
  for (const child of runtime.children) assert.ok(child.exitCode !== null || child.signalCode !== null);
  for (const directory of runtime.directories) await assert.rejects(access(directory), { code: 'ENOENT' });
});

test('Claude defaults reject ambient authentication and unqualified runtimes', async (t) => {
  const provider = new ClaudeAnalysisProvider();
  assert.equal((await provider.health()).authenticated, false);
  assert.equal((await provider.getCapabilities(qualification)).features.blockingToolPermissions, 'unknown');
  const runtime = fixture(t);
  const prepared = await prepareAnalysis(fixtureTask, catalog(), fixtureWorkspace, host(runtime.provider), new AbortController().signal);
  await assert.rejects(provider.execute(prepared.request, {
    signal: new AbortController().signal, onEvent: async () => {}, authorize: async () => ({ decision: 'deny', reason: 'Fixture' }),
    invokeTool: async () => null,
  }), /not qualified/);
});

test('Claude refuses to release a prompt when fail-closed hooks were not applied', async (t) => {
  const runtime = fixture(t, undefined, undefined, false);
  const result = await runAnalysis(fixtureTask, catalog(), fixtureWorkspace, host(runtime.provider), store, new AbortController().signal);
  assert.equal(result.status, 'failed');
  assert.match(result.reason!, /fail-closed hooks/);
  assert.equal(runtime.sent(), 0);
});

test('Claude requires blocking hooks, not an empty descriptive agent registry', () => {
  validateClaudeAnalysisInitialization({
    hooks_applied: true, hook_on_failure_supported: true,
    agents: [{ name: 'Explore', description: 'Built-in runtime agent' }],
  });
  assert.throws(() => validateClaudeAnalysisInitialization({
    hooks_applied: true, hook_on_failure_supported: false, agents: [],
  }), /requires applied fail-closed hooks/);
  validateClaudeAnalysisInitialization({ hooks_applied: true, hook_on_failure_supported: true, agents: [] });
});
for (const contamination of ['tools', 'runtime', 'model', 'skills', 'plugins', 'mcp-source'] as const) {
  test(`Claude rejects contaminated ${contamination} inventory`, async (t) => {
    let responseCalled = false;
    const runtime = fixture(t, async () => { responseCalled = true; return JSON.stringify(fixtureReport); }, (inventory) => {
      if (contamination === 'tools') inventory.tools.push('Bash');
      if (contamination === 'runtime') inventory.claude_code_version = 'changed';
      if (contamination === 'model') inventory.model = 'fallback-model';
      if (contamination === 'skills') inventory.skills.push('ambient');
      if (contamination === 'plugins') inventory.plugins.push({ name: 'ambient', path: '/ambient' });
      if (contamination === 'mcp-source') inventory.mcp_servers[0].source = 'project';
    });
    const result = await runAnalysis(fixtureTask, catalog(), fixtureWorkspace, host(runtime.provider), store, new AbortController().signal);
    assert.equal(result.status, 'failed');
    assert.match(result.reason!, /inventory/);
    assert.equal(responseCalled, false);
  });
}

test('Claude native tool refusals remain failures even if the SDK returns valid JSON', async (t) => {
  const runtime = fixture(t, async (options) => {
    const hook = options.hooks?.PreToolUse?.[0].hooks[0];
    assert.ok(hook);
    const response = await hook({
      hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'irrelevant' },
      tool_use_id: 'native', session_id: 'fixture-session', cwd: options.cwd!, transcript_path: '/unused',
    }, 'native', { signal: new AbortController().signal });
    assert.ok('hookSpecificOutput' in response);
    return JSON.stringify(fixtureReport);
  });
  const result = await runAnalysis(fixtureTask, catalog(), fixtureWorkspace, host(runtime.provider), store, new AbortController().signal);
  assert.equal(result.status, 'failed');
  assert.match(result.reason!, /Non-broker tool refused/);
});

test('Claude broker errors cannot be swallowed by MCP and become success', async (t) => {
  const runtime = fixture(t, async (_options, client) => {
    const denied = await client.callTool({ name: 'repository_read', arguments: { path: '.env', startLine: 1, endLine: 1 } });
    assert.equal(denied.isError, true);
    return JSON.stringify(fixtureReport);
  });
  const result = await runAnalysis(fixtureTask, catalog(), fixtureWorkspace, host(runtime.provider), store, new AbortController().signal);
  assert.equal(result.status, 'failed');
  assert.match(result.reason!, /outside|scope|allowed/i);
});

test('Claude cancellation reaches the SDK controller and confirms child exit before cleanup', async (t) => {
  const controller = new AbortController();
  const runtime = fixture(t, async (options) => {
    controller.abort();
    assert.equal(options.abortController?.signal.aborted, true);
    throw new Error('SDK send aborted');
  });
  const prepared = await prepareAnalysis(fixtureTask, catalog(), fixtureWorkspace, host(runtime.provider), new AbortController().signal);
  const result = await runtime.provider.execute(prepared.request, {
    signal: controller.signal, onEvent: async () => {}, authorize: async () => ({ decision: 'deny', reason: 'Unused' }),
    invokeTool: async () => null,
  });
  assert.equal(result.status, 'cancelled');
  for (const child of runtime.children) assert.ok(child.exitCode !== null || child.signalCode !== null);
  for (const directory of runtime.directories) await assert.rejects(access(directory), { code: 'ENOENT' });
});

test('Claude hook requires trusted SDK provenance and never approves remaining permission prompts', async (t) => {
  const runtime = fixture(t);
  const prepared = await prepareAnalysis(fixtureTask, catalog(), fixtureWorkspace, host(runtime.provider), new AbortController().signal);
  const denied: string[] = [];
  const session = claudeAnalysisSession(prepared.request, {
    signal: new AbortController().signal, onEvent: async (event) => {
      if (event.payload.type === 'tool_denied') denied.push(event.payload.toolId);
    }, authorize: async () => ({ decision: 'deny', reason: 'Unused' }), invokeTool: async () => null,
  });
  const hook = session.options.hooks!.PreToolUse![0].hooks[0];
  const base = {
    hook_event_name: 'PreToolUse' as const, tool_name: 'mcp__analysis__repository_read', tool_input: {},
    tool_use_id: 'broker', session_id: 'fixture-session', cwd: '/unused', transcript_path: '/unused',
  };
  const allowed = await hook({ ...base, mcp_server: { name: 'analysis', source: 'sdk' } }, 'broker', { signal: new AbortController().signal });
  assert.deepEqual(allowed, { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' } });
  await hook({ ...base, mcp_server: { name: 'analysis', source: 'project' } }, 'broker', { signal: new AbortController().signal });
  const permission = await session.options.canUseTool!(base.tool_name, {}, {
    signal: new AbortController().signal, toolUseID: 'approval', mcpServer: { name: 'analysis', source: 'sdk' },
    requestId: 'approval', decisionReason: 'Organization approval required',
  });
  assert.ok(permission);
  assert.equal(permission.behavior, 'deny');
  assert.equal(denied.length, 2);
  assert.throws(session.assertNoRefusal, /Non-broker/);
});

for (const name of ['Agent', 'Task', 'Workflow']) {
  test(`Claude observes unavailable ${name} attempts as sticky failures, even without a native hook callback`, async (t) => {
    let responseCalled = false;
    const runtime = fixture(t, async () => { responseCalled = true; return JSON.stringify(fixtureReport); },
      undefined, true, {}, [{
        type: 'assistant', parent_tool_use_id: null,
        message: { content: [{ type: 'tool_use', id: 'delegation', name, input: {} }] },
      }]);
    const result = await runAnalysis(fixtureTask, catalog(), fixtureWorkspace, host(runtime.provider), store, new AbortController().signal);
    assert.equal(result.status, 'failed');
    assert.match(result.reason!, new RegExp(`Non-broker tool requested: ${name}`));
    assert.equal(responseCalled, false);
  });
}

test('Claude rejects subagent responses even if they contain no tool call', async (t) => {
  const runtime = fixture(t, undefined, undefined, true, {}, [{
    type: 'assistant', parent_tool_use_id: 'unexpected-child', message: { content: [{ type: 'text', text: 'Child response' }] },
  }]);
  const result = await runAnalysis(fixtureTask, catalog(), fixtureWorkspace, host(runtime.provider), store, new AbortController().signal);
  assert.equal(result.status, 'failed');
  assert.match(result.reason!, /Non-broker tool requested: Agent/);
});

test('Claude rejects subagent lifecycle events and preserves the refusal when the host aborts', async (t) => {
  const runtime = fixture(t, undefined, undefined, true, {}, [{
    type: 'system', subtype: 'task_started', task_id: 'unexpected-child',
  }]);
  const prepared = await prepareAnalysis(fixtureTask, catalog(), fixtureWorkspace, host(runtime.provider), new AbortController().signal);
  const controller = new AbortController();
  const denied: string[] = [];
  await assert.rejects(runtime.provider.execute(prepared.request, {
    signal: controller.signal, onEvent: async (event) => {
      if (event.payload.type === 'tool_denied') { denied.push(event.payload.toolId); controller.abort(); }
    },
    authorize: async () => ({ decision: 'deny', reason: 'Probe only' }), invokeTool: async () => null,
  }), /Non-broker tool requested: Agent/);
  assert.deepEqual(denied, ['Agent']);
});

test('Claude MCP preflight rejects missing, additional or untrusted broker tools', async (t) => {
  const runtime = fixture(t);
  const prepared = await prepareAnalysis(fixtureTask, catalog(), fixtureWorkspace, host(runtime.provider), new AbortController().signal);
  const session = claudeAnalysisSession(prepared.request, {
    signal: new AbortController().signal, onEvent: async () => {},
    authorize: async () => ({ decision: 'deny', reason: 'Probe only' }), invokeTool: async () => null,
  });
  const broker = { name: 'analysis', source: 'sdk', status: 'connected' as const,
    tools: [{ name: 'repository_read' }, { name: 'repository_search' }] };
  session.validateBroker([broker]);
  for (const servers of [[], [broker, broker], [{ ...broker, source: 'project' }],
    [{ ...broker, tools: undefined }], [{ ...broker, tools: [...broker.tools, { name: 'Agent' }] }]]) {
    assert.throws(() => session.validateBroker(servers), /MCP inventory/);
  }
});

for (const [label, terminal, reason] of [
  ['native error', { subtype: 'error_during_execution', is_error: true, errors: ['Native fixture failure'] }, /Native fixture failure/],
  ['empty response', { result: '' }, /no response/],
  ['session mismatch', { session_id: 'another-session' }, /matching inventory/],
  ['reported denial', { permission_denials: [{}] }, /denied tool calls/],
] satisfies [string, Partial<TerminalMessage>, RegExp][]) {
  test(`Claude does not publish success after ${label}`, async (t) => {
    const runtime = fixture(t, undefined, undefined, true, terminal);
    const result = await runAnalysis(fixtureTask, catalog(), fixtureWorkspace, host(runtime.provider), store, new AbortController().signal);
    assert.equal(result.status, 'failed');
    assert.match(result.reason!, reason);
  });
}

test('Claude reports interruption and retains diagnostics when SDK close fails', async (t) => {
  const runtime = fixture(t, async () => {
    const session = runtime.sessions.at(-1)!;
    const close = session.close;
    session.close = () => { close(); throw new Error('Unconfirmed SDK shutdown'); };
    return JSON.stringify(fixtureReport);
  });
  const result = await runAnalysis(fixtureTask, catalog(), fixtureWorkspace, host(runtime.provider), store, new AbortController().signal);
  assert.equal(result.status, 'interrupted');
  assert.match(result.reason!, /shutdown was not confirmed/);
  await access(runtime.directories.at(-1)!);
});
