import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { agentContextSchema, type AgentRuntime } from '../../shared/types/agent';
import { summarizeAgentUsage } from '../../shared/utils/agentTelemetry';
import { CodeGraph } from './codeGraph';
import { CopilotProvider } from './copilotProvider';
import { GRAPHIFY_SKILL_DIRECTORY } from './graphifySkill';

function measuredUsage(runtime: AgentRuntime) {
  const usage = summarizeAgentUsage([runtime]);
  for (const metric of ['inputTokens', 'outputTokens', 'cacheReadTokens'] as const) {
    assert.ok(runtime.events.some((event) => event.type === 'assistant.usage'), 'No usage reported');
    for (const event of runtime.events.filter((event) => event.type === 'assistant.usage')) {
      const value = event.data[metric];
      assert.ok(typeof value === 'number' && Number.isFinite(value) && value >= 0, `Missing/invalid ${metric}`);
    }
    assert.notEqual(usage[metric], null);
  }
  assert.ok(usage.inputTokens! > 0);
  assert.ok(usage.cacheReadTokens! <= usage.inputTokens!, 'Cache reads must be included in input tokens');
  return {
    inputTokens: usage.inputTokens!,
    cacheReadTokens: usage.cacheReadTokens!,
    uncachedInputTokens: usage.inputTokens! - usage.cacheReadTokens!,
    outputTokens: usage.outputTokens!,
    calls: usage.calls,
  };
}

function compare(baseline: number[], graphify: number[]) {
  assert.ok(baseline.length > 0 && baseline.length === graphify.length, 'Expected paired samples');
  assert.ok([...baseline, ...graphify].every((value) => Number.isFinite(value) && value >= 0));
  const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
  const baselineTotal = sum(baseline);
  assert.ok(baselineTotal > 0, 'Cannot measure savings against a zero baseline');
  const graphifyTotal = sum(graphify);
  return {
    baselineTotal, graphifyTotal,
    savingsPercentage: (baselineTotal - graphifyTotal) / baselineTotal * 100,
    pairsWithSavings: baseline.filter((value, index) => graphify[index] < value).length,
  };
}

test('benchmark reports savings, regressions and mixed pairs without assuming a Graphify benefit', () => {
  assert.deepEqual(compare([100, 100], [50, 150]), {
    baselineTotal: 200, graphifyTotal: 200, savingsPercentage: 0, pairsWithSavings: 1,
  });
  assert.equal(compare([100], [80]).savingsPercentage, 20);
  assert.equal(compare([100], [120]).savingsPercentage, -20);
  assert.throws(() => compare([], []));
  assert.throws(() => compare([100, 100], [100]));
  assert.throws(() => compare([0], [1]));
  assert.throws(() => compare([100], [NaN]));
});

test('benchmark distinguishes cached input and refuses incomplete usage', () => {
  const runtime: AgentRuntime = {
    id: 'fixture', phase: 'plan', status: 'completed', providerSessionId: null,
    startedAt: '2026-11-04T00:00:00Z', endedAt: '2026-11-04T00:00:01Z',
    error: '', metadata: {}, events: [{
      id: 'usage', type: 'assistant.usage', timestamp: '2026-11-04T00:00:00Z',
      data: { inputTokens: 100, cacheReadTokens: 80, outputTokens: 10 },
    }],
  };
  assert.deepEqual(measuredUsage(runtime), {
    inputTokens: 100, cacheReadTokens: 80, uncachedInputTokens: 20, outputTokens: 10, calls: 1,
  });
  runtime.events.push(runtime.events[0]);
  assert.equal(measuredUsage(runtime).inputTokens, 100, 'Duplicate events are not billed twice');
  runtime.events = [];
  assert.throws(() => measuredUsage(runtime), /No usage/);
  runtime.events = [{
    id: 'missing', type: 'assistant.usage', timestamp: 'now', data: { inputTokens: 100, outputTokens: 10 },
  }];
  assert.throws(() => measuredUsage(runtime), /cacheReadTokens/);
  runtime.events[0].data.cacheReadTokens = 101;
  assert.throws(() => measuredUsage(runtime), /Cache reads/);
});

test('live paired Graphify token benchmark on the same committed repository', {
  skip: process.env.COPILOT_GRAPHIFY_BENCHMARK !== '1',
  timeout: 1_800_000,
}, async (t) => {
  const root = process.cwd();
  const model = process.env.GRAPHIFY_BENCHMARK_MODEL || 'mai-code-1.1-flash';
  const graphifyVersion = execFileSync(process.env.GRAPHIFY_BIN || 'graphify', ['--version'], { encoding: 'utf8' }).trim();
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const temporary = await mkdtemp(path.join(tmpdir(), 'kanban-graphify-benchmark-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const workspace = path.join(temporary, 'snapshot');
  await mkdir(workspace);
  const archive = path.join(temporary, 'snapshot.tar');
  execFileSync('git', ['archive', '--output', archive, commit], { cwd: root });
  execFileSync('tar', ['-xf', archive, '-C', workspace, '--exclude=prisma/kanban.db', '--exclude=.env']);
  await rm(archive);
  const skill = await readFile(path.join(GRAPHIFY_SKILL_DIRECTORY, 'ticket-graphify/SKILL.md'), 'utf8');
  const context = agentContextSchema.parse({
    project: null, feature: null,
    task: {
      id: 'graphify-benchmark', title: 'Rename InProgress to Processing on Board',
      description: [
        'Plan only. Rename the visible Kanban board column label from In Progress to Processing.',
        'Keep the canonical persisted status In Progress unchanged; no migration or workflow changes.',
        'Inspect sources and identify the exact label rendering site and the canonical status definition.',
        'Return a concise implementation/test/documentation plan with source paths and line locations.',
      ].join('\n'),
      status: 'In Progress', priority: 'Medium', agentProvider: 'copilot', agentModel: model,
      tags: [], acceptanceCriteria: ['Only the board column display label changes; stored values remain unchanged.'],
      subtasks: [], order: 0, storyPoints: 1,
      createdAt: '2026-11-04T00:00:00Z', updatedAt: '2026-11-04T00:00:00Z',
    },
  });
  const runs: Array<{
    pair: number; graphify: boolean; runtimeId: string; providerSessionId: string | null;
    usage: ReturnType<typeof measuredUsage>; wallMs: number; graphCalls: number;
    toolCalls: number; toolFailures: number; output: string;
    usageEvents: AgentRuntime['events'];
  }> = [];
  const report = {
    commit, model, graphifyVersion, nodeVersion: process.version,
    pairs: 3, startedAt: new Date().toISOString(),
    skillSha256: createHash('sha256').update(skill).digest('hex'),
    context, runs,
  };
  const destination = path.resolve(process.env.GRAPHIFY_BENCHMARK_OUTPUT || 'test-results/graphify-benchmark.json');
  await mkdir(path.dirname(destination), { recursive: true });
  const save = (extra = {}) => writeFile(destination, JSON.stringify({ ...report, ...extra }, null, 2) + '\n');
  await save({ status: 'running' });
  try {
    for (let pair = 1; pair <= report.pairs; pair++) {
      for (const graphify of pair % 2 ? [false, true] : [true, false]) {
        let runtime: AgentRuntime | undefined;
        const provider = new CopilotProvider(new CodeGraph({
          enabled: graphify, binary: process.env.GRAPHIFY_BIN,
          cacheDir: path.join(temporary, 'graphs'),
        }));
        const output = await provider.run({
          context, workspace, phase: 'plan', plan: '', answers: [],
          signal: AbortSignal.timeout(240_000),
          onSession: async () => undefined,
          onRuntime: async (value) => { runtime = value; },
          ask: async () => 'Only the visible board column label changes. Preserve canonical In Progress.',
        });
        assert.ok(runtime && runtime.status === 'completed' && runtime.endedAt);
        const events = runtime.events;
        const tools = events.filter((event) => event.type === 'tool.execution_start');
        const successfulToolIds = new Set(events
          .filter((event) => event.type === 'tool.execution_complete' && event.data.success === true)
          .map((event) => event.data.toolCallId));
        const graphCalls = tools.filter((event) => String(event.data.toolName).startsWith('ticket_graph_')).length;
        runs.push({
          pair, graphify, runtimeId: runtime.id, providerSessionId: runtime.providerSessionId,
          usage: measuredUsage(runtime),
          wallMs: Date.parse(runtime.endedAt) - Date.parse(runtime.startedAt),
          graphCalls, toolCalls: tools.length,
          toolFailures: events.filter((event) => event.type === 'tool.execution_complete' && event.data.success === false).length,
          output, usageEvents: events.filter((event) => event.type === 'assistant.usage'),
        });
        await save({ status: 'running' });
        assert.equal(graphCalls > 0, graphify, 'Graph-enabled runs must actually query Graphify, not silently fall back');
        if (graphify) {
          const graphIds = new Set(tools.filter((event) => String(event.data.toolName).startsWith('ticket_graph_'))
            .map((event) => event.data.toolCallId));
          assert.ok([...graphIds].some((id) => successfulToolIds.has(id)), 'At least one graph call must succeed');
        }
        assert.equal(events.find((event) => event.type === 'session.start')?.data.selectedModel, model);
        for (const alternatives of [['src/components/KanbanColumn.tsx'], ['shared/types/kanban.ts', 'shared/types/board.ts']]) {
          assert.ok(alternatives.some((file) => output.includes(file) &&
            tools.some((event) => event.data.toolName === 'ticket_read_file' &&
              successfulToolIds.has(event.data.toolCallId) &&
              typeof event.data.arguments === 'object' && event.data.arguments !== null &&
              !Array.isArray(event.data.arguments) && event.data.arguments.path === file)),
          `Must read and cite a source in ${alternatives.join(' or ')}`);
        }
        assert.match(output, /Processing/);
        assert.match(output, /In Progress/);
        t.diagnostic(JSON.stringify(runs.at(-1)));
      }
    }
    const comparisons = Object.fromEntries(
      (['inputTokens', 'uncachedInputTokens', 'outputTokens'] as const).map((metric) => [
        metric, compare(
          runs.filter((run) => !run.graphify).map((run) => run.usage[metric]),
          runs.filter((run) => run.graphify).map((run) => run.usage[metric]),
        ),
      ]),
    );
    await save({ status: 'completed', comparisons, endedAt: new Date().toISOString() });
    t.diagnostic(JSON.stringify({ destination, comparisons }));
  } catch (error) {
    await save({ status: 'failed', error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
});
