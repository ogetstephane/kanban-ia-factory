import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile, readdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CopilotClient } from '@github/copilot-sdk';
import { z } from 'zod';
import { CopilotAnalysisProvider, COPILOT_ANALYSIS_SDK_VERSION } from './adapters/copilotAnalysisProvider';
import { analysisFixtureCatalog, fixtureTask, fixtureWorkspace } from './core/testing/analysisFixture';
import { runAnalysis, type AnalysisResult } from './core/analysis';
import type { ExecutionEvent } from './core/index';

test('one live Copilot turn is cancelled after observed model output and the runtime exits', {
  skip: process.env.COPILOT_ANALYSIS_LIVE_TEST !== '1', timeout: 100_000,
}, async (t) => {
  assert.equal(process.env.COPILOT_ANALYSIS_ISOLATED, '1', 'Run through make test-analysis-live.');
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  const credentials = z.object({ token: z.string().min(1), model: z.string().min(1) })
    .parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
  const probeDirectory = await mkdtemp(path.join(tmpdir(), 'analysis-live-preflight-'));
  const probe = new CopilotClient({
    mode: 'empty', workingDirectory: probeDirectory, baseDirectory: probeDirectory,
    gitHubToken: credentials.token, useLoggedInUser: false,
  });
  let version: string;
  let model: string;
  try {
    await probe.start();
    assert.ok((await probe.getAuthStatus()).isAuthenticated, 'Copilot authentication failed.');
    version = (await probe.getStatus()).version;
    const models = (await probe.listModels()).filter((item) => item.policy?.state !== 'disabled');
    assert.ok(models.some(({ id }) => id === credentials.model),
      `The selected model is unavailable. Available IDs: ${models.map(({ id }) => id).join(', ')}`);
    model = credentials.model;
  } finally {
    assert.deepEqual(await probe.stop(), [], 'Preflight runtime shutdown failed.');
    await rm(probeDirectory, { recursive: true, force: true });
  }
  const qualification = {
    providerId: 'copilot', modelId: model, sdkVersion: COPILOT_ANALYSIS_SDK_VERSION, runtimeVersion: version,
    evidenceId: 'live-cancellation-probe-only-not-production', exclusiveToolBroker: true,
  };
  const controller = new AbortController();
  const childrenPath = `/proc/self/task/${process.pid}/children`;
  const initialChildren = new Set((await readFile(childrenPath, 'utf8')).trim().split(/\s+/).filter(Boolean));
  const runtimePids: string[] = [];
  let activityAt: number | undefined;
  let cancelledAt: number | undefined;
  let responseCompletedBeforeAbort = false;
  const events: ExecutionEvent[] = [];
  const stored: AnalysisResult[] = [];
  const directories: string[] = [];
  // Observe the actual session without replacing SDK send, abort, or shutdown.
  const provider = new CopilotAnalysisProvider({
    qualifications: [qualification],
    createClient: (options) => {
      directories.push(options.workingDirectory);
      const client = new CopilotClient({ ...options, gitHubToken: credentials.token, useLoggedInUser: false });
      return {
        start: client.start.bind(client), stop: client.stop.bind(client),
        getStatus: client.getStatus.bind(client), getAuthStatus: client.getAuthStatus.bind(client),
        listModels: client.listModels.bind(client),
        createSession: async (configuration) => {
          const session = await client.createSession({
            ...configuration, streaming: true,
            onEvent: (event) => {
              configuration.onEvent?.(event);
              if (!event.agentId && event.type === 'assistant.message' && cancelledAt === undefined) {
                responseCompletedBeforeAbort = true;
              }
              if (activityAt === undefined && !event.agentId && event.type === 'assistant.message_delta'
                && event.data.deltaContent.length) {
                activityAt = performance.now();
                cancelledAt = performance.now();
                controller.abort(new Error('Live cancellation probe after model output.'));
              }
            },
          });
          runtimePids.push(...(await readFile(childrenPath, 'utf8')).trim().split(/\s+/)
            .filter((pid) => pid && !initialChildren.has(pid)));
          return session;
        },
      };
    },
  });
  const catalog = analysisFixtureCatalog('copilot', model);
  // A deliberately long synthetic response ensures cancellation occurs mid-output.
  const definitions = {
    instructions: catalog.instructions, skills: catalog.skills, prompts: catalog.prompts,
    agents: catalog.agents, policies: catalog.policies, executionProfiles: catalog.executionProfiles, workflows: catalog.workflows,
  };
  const { buildDefinitionCatalog } = await import('./core/index');
  const liveCatalog = buildDefinitionCatalog({
    ...definitions,
    prompts: definitions.prompts.map((prompt) => ({
      ...prompt,
      template: 'Return a JSON object with a summary containing the numbers 1 through 20000, one by one in order, as a long string. Set observations and limitations to empty arrays. Do not call tools. Start immediately and do not abbreviate.',
    })),
    agents: definitions.agents.map((agent) => ({
      ...agent, budget: { ...agent.budget, limits: { ...agent.budget.limits, maxDurationMs: 60_000 } },
    })),
  });
  let startupEvents = 0;
  const result = await runAnalysis(fixtureTask, liveCatalog, fixtureWorkspace, {
    providers: [provider], qualifications: [qualification], resourceContents: {},
  }, {
    savePrepared: async () => {},
    appendEvent: async (event) => {
      events.push(event);
      if (event.payload.type === 'started') startupEvents++;
    },
    saveResult: async (_id, value) => { stored.push(value); },
  }, controller.signal);
  assert.equal(startupEvents, 1, 'Expected exactly one SDK session start, with no retry.');
  assert.ok(activityAt !== undefined && cancelledAt !== undefined, 'No active model output observed; cancellation was not qualified.');
  assert.equal(responseCompletedBeforeAbort, false, 'The model completed before cancellation; this is not an active-turn test.');
  assert.ok(['cancelled', 'interrupted'].includes(result.status), `Unexpected result: ${result.status}`);
  assert.equal(stored.length, 1);
  assert.equal(stored[0].status, result.status);
  // Core may stop waiting after its 100 ms grace; verify real cleanup separately.
  const cleanupDeadline = performance.now() + 10_000;
  let remaining = runtimePids;
  do {
    const pids = new Set(await readdir('/proc'));
    remaining = runtimePids.filter((pid) => pids.has(pid));
    if (!remaining.length) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  } while (performance.now() < cleanupDeadline);
  assert.ok(runtimePids.length > 0, 'No real runtime child was observed.');
  assert.deepEqual(remaining, [], 'Live runtime child still exists after cancellation.');
  for (const directory of directories) {
    await assert.rejects(access(directory), { code: 'ENOENT' });
  }
  t.diagnostic(`SDK ${COPILOT_ANALYSIS_SDK_VERSION}; runtime ${version}; model ${model}; result ${result.status}; runtime exit verified within ${Math.ceil(performance.now() - cancelledAt)} ms after abort.`);
  t.diagnostic('One synthetic model turn requested; billing cessation and production confinement are not established by this test.');
});
