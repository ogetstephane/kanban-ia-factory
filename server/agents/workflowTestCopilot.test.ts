import test from 'node:test';
import assert from 'node:assert/strict';
import { CopilotClient, type SessionConfig } from '@github/copilot-sdk';
import { access } from 'node:fs/promises';
import { WorkflowTestCopilot, workflowTestSession } from './workflowTestCopilot';
import { documentFixture } from '../../shared/types/workflowEditor.fixture';

test('real preview configuration disables ambient discovery and denies every tool or permission', async () => {
  const session = workflowTestSession('/isolated-test', 'Write tickets', ['Frame scope']);
  const config = session.configuration;
  assert.deepEqual(config.tools, []);
  assert.deepEqual(config.availableTools, []);
  assert.deepEqual(config.mcpServers, {});
  assert.deepEqual(config.customAgents, []);
  assert.equal(config.enableConfigDiscovery, false);
  assert.equal(config.skipCustomInstructions, true);
  assert.equal(config.enableFileHooks, false);
  assert.equal(config.enableSkills, false);
  assert.equal(config.enableHostGitOperations, false);
  assert.equal(config.enableSessionStore, false);
  session.assertNoRefusal();
  const denied = await config.onPermissionRequest!({ kind: 'custom-tool', toolName: 'write', toolDescription: 'Write a file' }, { sessionId: 'test' });
  assert.equal(denied.kind, 'denied-interactively-by-user');
  assert.throws(session.assertNoRefusal, /denied/);
});

test('real preview adapter is exercised entirely offline with verified inventory, strict JSON and confirmed cleanup', async (t) => {
  for (const scenario of ['success', 'ambient-tool', 'invalid-json', 'denied-tool', 'cancelled'] as const) {
    await t.test(scenario, async (t) => {
      const directories: string[] = [];
      const controller = new AbortController();
      let sent = 0;
      t.mock.method(CopilotClient.prototype, 'start', async () => {});
      const stop = t.mock.method(CopilotClient.prototype, 'stop', async () => []);
      t.mock.method(CopilotClient.prototype, 'forceStop', async () => {});
      t.mock.method(CopilotClient.prototype, 'getAuthStatus', async () => ({ isAuthenticated: true }));
      t.mock.method(CopilotClient.prototype, 'createSession', async (configuration: SessionConfig) => {
        assert.equal(configuration.model, 'fixture-model');
        assert.deepEqual(configuration.allowedModels, ['fixture-model']);
        assert.equal(configuration.workingDirectory, directories[0]);
        assert.equal(configuration.configDirectory, directories[0]);
        return {
          rpc: {
            tools: {
              initializeAndValidate: async () => ({}),
              getCurrentMetadata: async () => ({ tools: scenario === 'ambient-tool' ? [{ name: 'bash' }] : [] }),
            },
            instructions: { getSources: async () => ({ sources: [] }) },
            agent: { list: async () => ({ agents: [] }) },
            skills: { list: async () => ({ skills: [] }) },
          },
          sendAndWait: async (request: { prompt: string }, timeout: number) => {
            sent++;
            assert.equal(timeout, 120_000);
            assert.deepEqual(JSON.parse(request.prompt).context, { variables: { request: 'Test' }, upstream: {} });
            if (scenario === 'cancelled') controller.abort(new Error('Chosen cancellation'));
            if (scenario === 'denied-tool') await configuration.onPermissionRequest!({
              kind: 'custom-tool', toolName: 'write', toolDescription: 'Write a file',
            }, { sessionId: 'test' });
            return { data: { content: scenario === 'invalid-json' ? 'Not JSON' : '{"verified":true}' } };
          },
        };
      });
      const adapter = new WorkflowTestCopilot((options) => {
        assert.equal(options.mode, 'empty');
        assert.equal(options.workingDirectory, options.baseDirectory);
        directories.push(options.workingDirectory);
        return new CopilotClient(options);
      });
      const promise = adapter.execute({
        agent: { ...documentFixture().agents[0], model: 'fixture-model' }, prompt: 'Draft a ticket',
        skills: ['Frame scope'], input: { variables: { request: 'Test' }, upstream: {} }, signal: controller.signal,
      });
      if (scenario === 'success') assert.deepEqual(await promise, { verified: true });
      else await assert.rejects(promise, scenario === 'ambient-tool' ? /inventory/ : scenario === 'cancelled' ? /Chosen cancellation/ : scenario === 'denied-tool' ? /denied/ : /JSON/);
      assert.equal(sent, scenario === 'ambient-tool' ? 0 : 1);
      assert.equal(stop.mock.callCount(), 1);
      await assert.rejects(access(directories[0]), { code: 'ENOENT' });
    });
  }
});
