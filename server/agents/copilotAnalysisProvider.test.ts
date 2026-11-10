import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { access, rm } from 'node:fs/promises';
import { CopilotClient, type SessionConfig } from '@github/copilot-sdk';
import { CopilotAnalysisProvider, COPILOT_ANALYSIS_SDK_VERSION } from './adapters/copilotAnalysisProvider';
import { prepareAnalysis, runAnalysis, type AnalysisHost, type AnalysisStore } from './core/analysis';
import { analysisFixtureCatalog, fixtureTask, fixtureWorkspace, fixtureReport } from './core/testing/analysisFixture';

const qualification = {
  providerId: 'copilot', modelId: 'fixture-model', sdkVersion: COPILOT_ANALYSIS_SDK_VERSION,
  runtimeVersion: 'fixture-runtime', evidenceId: 'simulated-sdk-test-only', exclusiveToolBroker: true,
};
const store: AnalysisStore = {
  savePrepared: async () => {}, appendEvent: async () => {}, saveResult: async () => {},
};
function mockClient(
  t: TestContext, respond: (configuration: SessionConfig) => Promise<string>,
  inventory: 'clean' | 'tools' | 'instructions' | 'agents' | 'skills' | 'missing' = 'clean',
) {
  const directories: string[] = [];
  const abort = t.mock.fn(async () => {});
  const stop = t.mock.method(CopilotClient.prototype, 'stop', async () => []);
  t.mock.method(CopilotClient.prototype, 'start', async () => {});
  t.mock.method(CopilotClient.prototype, 'getStatus', async () => ({ version: 'fixture-runtime', protocolVersion: 1 }));
  t.mock.method(CopilotClient.prototype, 'getAuthStatus', async () => ({ isAuthenticated: true }));
  t.mock.method(CopilotClient.prototype, 'listModels', async () => [{ id: 'fixture-model', name: 'Fixture' }]);
  const create = t.mock.method(CopilotClient.prototype, 'createSession', async (configuration: SessionConfig) => {
    assert.ok(configuration.workingDirectory);
    assert.ok(directories.includes(configuration.workingDirectory));
    return { sessionId: 'fixture-session', abort,
      rpc: {
        tools: { initializeAndValidate: async () => ({}), getCurrentMetadata: async () => ({
          tools: inventory === 'missing' ? null : inventory === 'tools' ? [{ name: 'bash' }]
            : configuration.tools?.map(({ name }) => ({ name })) ?? [],
        }) },
        instructions: { getSources: async () => ({ sources: inventory === 'instructions' ? [{
          id: 'hostile', label: 'AGENTS.md', sourcePath: 'AGENTS.md', content: 'HOSTILE', type: 'model', location: 'repository',
        }] : [] }) },
        agent: { list: async () => ({ agents: inventory === 'agents' ? [{ id: 'hostile', name: 'hostile' }] : [] }) },
        skills: { list: async () => ({ skills: inventory === 'skills' ? [{ name: 'hostile', enabled: true }] : [] }) },
      },
      sendAndWait: async () => ({ data: { content: await respond(configuration) } }) };
  });
  const provider = new CopilotAnalysisProvider({
    qualifications: [qualification],
    createClient: (options) => {
      assert.equal(options.mode, 'empty');
      assert.equal(options.baseDirectory, options.workingDirectory);
      assert.notEqual(options.workingDirectory, fixtureWorkspace.root);
      directories.push(options.workingDirectory);
      return new CopilotClient(options);
    },
  });
  return { provider, directories, abort, stop, create };
}
function host(provider: CopilotAnalysisProvider): AnalysisHost {
  return { providers: [provider], qualifications: [qualification], resourceContents: {} };
}
async function read(configuration: SessionConfig) {
  const tool = configuration.tools?.find(({ name }) => name === 'analysis_repository_read');
  assert.ok(tool?.handler);
  const result = await tool.handler({ path: 'src/service.ts', startLine: 1, endLine: 1 }, {
    sessionId: 'fixture-session', toolCallId: 'read', toolName: tool.name, arguments: {},
  });
  assert.deepEqual(result, { resultType: 'success', textResultForLlm: JSON.stringify(fixtureWorkspace.files['src/service.ts']) });
}
test('Copilot adapter uses an empty runtime and the canonical snapshot broker, then cleans up', async (t) => {
  const fixture = mockClient(t, async (config) => {
    assert.equal(config.enableConfigDiscovery, false);
    assert.equal(config.skipCustomInstructions, true);
    assert.equal(config.enableSkills, false);
    assert.equal(config.enableFileHooks, false);
    assert.equal(config.enableHostGitOperations, false);
    assert.equal(config.enableSessionStore, false);
    assert.equal(config.enableOnDemandInstructionDiscovery, false);
    assert.deepEqual(config.memory, { enabled: false });
    assert.deepEqual(config.availableTools, ['analysis_repository_read', 'analysis_repository_search']);
    assert.deepEqual(config.mcpServers, {});
    assert.deepEqual(config.pluginDirectories, []);
    assert.equal(config.model, 'fixture-model');
    assert.equal(config.configDirectory, config.workingDirectory);
    assert.equal(config.systemMessage?.mode, 'replace');
    assert.match(config.systemMessage.content!, /repository.read -> analysis_repository_read/);
    const permission = await config.onPermissionRequest?.({
      kind: 'custom-tool', toolName: 'analysis_repository_read', toolDescription: 'Read snapshot', args: { path: 'src/service.ts' },
    }, { sessionId: 'fixture-session' });
    assert.equal(permission?.kind, 'approved');
    await read(config);
    return JSON.stringify(fixtureReport);
  });
  const result = await runAnalysis(fixtureTask, analysisFixtureCatalog('copilot', 'fixture-model'),
    fixtureWorkspace, host(fixture.provider), store, new AbortController().signal);
  assert.equal(result.status, 'succeeded', result.reason);
  assert.deepEqual(result.report, fixtureReport);
  assert.equal(fixture.create.mock.callCount(), 1);
  assert.equal(fixture.stop.mock.callCount(), fixture.directories.length);
  for (const directory of fixture.directories) await assert.rejects(access(directory), { code: 'ENOENT' });
});

test('unqualified runtime fails before creating a session', async (t) => {
  const fixture = mockClient(t, async () => JSON.stringify(fixtureReport));
  const provider = new CopilotAnalysisProvider();
  const capabilities = await provider.getCapabilities({ providerId: 'copilot', modelId: 'fixture-model' });
  assert.equal(capabilities.features.blockingToolPermissions, 'unknown');
  await assert.rejects(prepareAnalysis(fixtureTask, analysisFixtureCatalog('copilot', 'fixture-model'),
    fixtureWorkspace, host(provider), new AbortController().signal), /qualified/);
  assert.equal(fixture.create.mock.callCount(), 0);
});

test('runtime qualification is rechecked at execution, not only preparation', async (t) => {
  const fixture = mockClient(t, async () => JSON.stringify(fixtureReport));
  const prepared = await prepareAnalysis(fixtureTask, analysisFixtureCatalog('copilot', 'fixture-model'),
    fixtureWorkspace, host(fixture.provider), new AbortController().signal);
  t.mock.method(CopilotClient.prototype, 'getStatus', async () => ({ version: 'changed-runtime', protocolVersion: 1 }));
  await assert.rejects(fixture.provider.execute(prepared.request, {
    signal: new AbortController().signal, onEvent: async () => {}, authorize: async () => ({ decision: 'deny', reason: 'Fixture' }),
    invokeTool: async () => null,
  }), /not qualified/);
  assert.equal(fixture.create.mock.callCount(), 0);
});

test('a denied native tool remains a failure even when the model returns valid JSON', async (t) => {
  const fixture = mockClient(t, async (config) => {
    const hook = await config.hooks?.onPreToolUse?.({
      toolName: 'bash', toolArgs: { command: 'irrelevant' }, sessionId: 'fixture-session',
      timestamp: new Date(), workingDirectory: config.workingDirectory!,
    }, { sessionId: 'fixture-session' });
    assert.equal(hook?.permissionDecision, 'deny');
    await read(config);
    return JSON.stringify(fixtureReport);
  });
  const result = await runAnalysis(fixtureTask, analysisFixtureCatalog('copilot', 'fixture-model'),
    fixtureWorkspace, host(fixture.provider), store, new AbortController().signal);
  assert.equal(result.status, 'failed');
  assert.match(result.reason!, /Non-broker/);
});

test('abort reaches the SDK and a rejected send can confirm cancellation after shutdown', async (t) => {
  const controller = new AbortController();
  const fixture = mockClient(t, async () => {
    controller.abort();
    throw new Error('SDK send aborted');
  });
  const result = await runAnalysis(fixtureTask, analysisFixtureCatalog('copilot', 'fixture-model'),
    fixtureWorkspace, host(fixture.provider), store, controller.signal);
  assert.equal(result.status, 'cancelled');
  assert.equal(fixture.abort.mock.callCount(), 1);
});

test('invalid tool arguments cannot be swallowed into a successful report', async (t) => {
  const fixture = mockClient(t, async (config) => {
    const tool = config.tools?.find(({ name }) => name === 'analysis_repository_read');
    assert.ok(tool?.handler);
    await assert.rejects(Promise.resolve(tool.handler(null, {
      sessionId: 'fixture-session', toolCallId: 'invalid', toolName: tool.name, arguments: {},
    })));
    return JSON.stringify(fixtureReport);
  });
  const result = await runAnalysis(fixtureTask, analysisFixtureCatalog('copilot', 'fixture-model'),
    fixtureWorkspace, host(fixture.provider), store, new AbortController().signal);
  assert.equal(result.status, 'failed');
  assert.equal(fixture.create.mock.callCount(), 1);
});

test('runtime shutdown errors cannot publish success or claim confirmed cancellation', async (t) => {
  const fixture = mockClient(t, async (config) => {
    await read(config);
    t.mock.method(CopilotClient.prototype, 'stop', async () => [new Error('Runtime still connected')]);
    return JSON.stringify(fixtureReport);
  });
  t.after(async () => {
    for (const directory of fixture.directories) await rm(directory, { recursive: true, force: true });
  });
  const result = await runAnalysis(fixtureTask, analysisFixtureCatalog('copilot', 'fixture-model'),
    fixtureWorkspace, host(fixture.provider), store, new AbortController().signal);
  assert.equal(result.status, 'interrupted');
  assert.match(result.reason!, /shutdown was not confirmed/);
  assert.equal(fixture.create.mock.callCount(), 1);
});

for (const managed of [false, true]) {
  test(`native permission callback refuses ${managed ? 'managed custom-tool approval' : 'live filesystem access'}`, async (t) => {
    const fixture = mockClient(t, async (config) => {
      const permission = managed
        ? { kind: 'custom-tool' as const, toolName: 'analysis_repository_read', toolDescription: 'Read snapshot', managedApprovalRequired: true }
        : { kind: 'read' as const, path: '/excluded-host-file', intention: 'Bypass the snapshot' };
      const decision = await config.onPermissionRequest?.(permission, { sessionId: 'fixture-session' });
      assert.equal(decision?.kind, 'denied-interactively-by-user');
      return JSON.stringify(fixtureReport);
    });
    const result = await runAnalysis(fixtureTask, analysisFixtureCatalog('copilot', 'fixture-model'),
      fixtureWorkspace, host(fixture.provider), store, new AbortController().signal);
    assert.equal(result.status, 'failed');
    assert.match(result.reason!, /Non-broker/);
    assert.equal(fixture.create.mock.callCount(), 1);
  });
}

for (const inventory of ['tools', 'instructions', 'agents', 'skills', 'missing'] as const) {
  test(`pre-model guard blocks ${inventory} inventory contamination`, async (t) => {
    let sent = false;
    const fixture = mockClient(t, async () => {
      sent = true;
      return JSON.stringify(fixtureReport);
    }, inventory);
    const result = await runAnalysis(fixtureTask, analysisFixtureCatalog('copilot', 'fixture-model'),
      fixtureWorkspace, host(fixture.provider), store, new AbortController().signal);
    assert.equal(result.status, 'failed');
    assert.match(result.reason!, /inventory|ambient/);
    assert.equal(sent, false);
    assert.equal(fixture.create.mock.callCount(), 1);
  });
}
