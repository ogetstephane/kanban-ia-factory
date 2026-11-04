import test from 'node:test';
import assert from 'node:assert/strict';
import { agentRuntimeSchema } from '../types/agent';
import { agentName, agentOverview, contextUsage, latestAgentContext, quotaUsage, summarizeAgentUsage } from './agentTelemetry';

function runtime(events: unknown[] = [], id = 'runtime') {
  return agentRuntimeSchema.parse({
    id, phase: 'plan', providerSessionId: 'provider', status: 'completed',
    startedAt: '2026-11-03T10:00:00Z', endedAt: '2026-11-03T10:01:00Z',
    error: '', metadata: {}, events,
  });
}
const event = (id: string, type: string, data: unknown, agentId?: string) => ({
  id, type, data, timestamp: '2026-11-03T10:00:00Z', ...(agentId ? { agentId } : {}),
});

test('usage totals include all phases and subagents, without counting duplicates or cumulative context snapshots', () => {
  const usage = event('call', 'assistant.usage', { model: 'main', inputTokens: 100, outputTokens: 20, cost: 0.5, duration: 10 });
  const result = summarizeAgentUsage([
    runtime([usage, usage, event('child', 'assistant.usage', { model: 'child', inputTokens: 50, cacheReadTokens: 40, cost: 0 }, 'child'),
      event('context', 'session.usage_info', { currentTokens: 500, tokenLimit: 1000 })]),
    runtime([event('review', 'assistant.usage', { model: 'main', outputTokens: 5, cost: 1, duration: 20 })], 'review'),
  ]);
  assert.deepEqual(result, {
    calls: 3, models: ['main', 'child'], inputTokens: 150, outputTokens: 25,
    cacheReadTokens: 40, cacheWriteTokens: null, cost: 1.5, duration: 30,
  });
});

test('missing usage is unavailable, while explicit zero remains zero', () => {
  assert.equal(summarizeAgentUsage([runtime()]).cost, null);
  assert.equal(summarizeAgentUsage([runtime([event('zero', 'assistant.usage', { model: 'free', cost: 0 })])]).cost, 0);
});

test('context uses the latest root sample, not the last subagent sample', () => {
  assert.deepEqual(latestAgentContext(runtime([
    event('first', 'session.usage_info', { currentTokens: 100 }),
    event('last', 'session.usage_info', { currentTokens: 200, tokenLimit: 1000 }),
    event('child', 'session.usage_info', { currentTokens: 500 }, 'child'),
  ])), { currentTokens: 200, tokenLimit: 1000 });
  assert.equal(latestAgentContext(runtime()), undefined);
});

test('agent overview names the agent and reports context and the newest Copilot quota reading', () => {
  const run = agentRuntimeSchema.parse({
    ...runtime([
      event('start', 'session.start', { selectedModel: 'fallback-model' }),
      event('usage', 'assistant.usage', { model: 'claude-x', modelDisplayName: 'Claude X' }),
      event('child-usage', 'assistant.usage', { model: 'child-model' }, 'child'),
      event('sub', 'subagent.started', { agentName: 'explore' }, 'child'),
      event('context', 'session.usage_info', { currentTokens: 32_000, tokenLimit: 128_000 }),
      event('child-context', 'session.usage_info', { currentTokens: 1, tokenLimit: 2 }, 'child'),
      { ...event('observed', 'session.quota_observation', { observation: {
        quotaId: 'premium', observedAt: '2026-11-03T10:00:30Z',
        budgetMetadata: { consumed: 80, entitlement: 300, remainingPercentage: 73.3, unlimited: false },
      } }), ephemeral: true },
    ]),
    metadata: {
      provider: 'copilot',
      accountQuotaAtStart: { observedAt: '2026-11-03T10:00:00Z', quotaSnapshots: { premium_interactions: {
        isUnlimitedEntitlement: false, entitlementRequests: 300, usedRequests: 75, remainingPercentage: 75 } } },
      accountQuota: { observedAt: '2026-11-03T10:01:00Z', quotaSnapshots: {
        chat: { isUnlimitedEntitlement: true, entitlementRequests: -1, usedRequests: 0, remainingPercentage: 100 },
        premium_interactions: { isUnlimitedEntitlement: false, entitlementRequests: 300, usedRequests: 90, remainingPercentage: 70, resetDate: '2026-12-01T00:00:00Z' } } },
    },
  });
  const overview = agentOverview(run);
  assert.equal(agentName(overview), 'Planning agent · Claude X · Copilot');
  assert.deepEqual(overview.subagents, ['explore']);
  assert.deepEqual(contextUsage(overview), { used: 32_000, limit: 128_000, available: 96_000, availablePercentage: 75 });
  assert.deepEqual(overview.quota, {
    type: 'premium_interactions', unlimited: false, used: 90, entitlement: 300,
    remainingPercentage: 70, resetDate: '2026-12-01T00:00:00Z', observedAt: '2026-11-03T10:01:00Z',
  });
});

test('agent overview degrades to unreported values and derives missing quota percentage', () => {
  const overview = agentOverview(runtime([], 'empty'));
  assert.equal(overview.provider, 'unknown');
  assert.equal(agentName(overview), 'Planning agent · default model · unknown');
  assert.equal(overview.context, null);
  assert.equal(overview.quota, null);
  assert.equal(quotaUsage({ ...overview, quota: {
    type: 'x', unlimited: false, used: 30, entitlement: 120, remainingPercentage: null, resetDate: null, observedAt: null,
  } })?.remainingPercentage, 75);
  const failed = agentOverview(agentRuntimeSchema.parse({ ...runtime(), metadata: { accountQuota: { observedAt: 'now', error: 'denied' } } }));
  assert.equal(failed.quota, null);
});
