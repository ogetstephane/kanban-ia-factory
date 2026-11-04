import type { AgentOverview, AgentRuntime } from '../types/agent';

type Metric = 'inputTokens' | 'outputTokens' | 'cacheReadTokens' | 'cacheWriteTokens' | 'cost' | 'duration';
export type UsageSummary = Record<Metric, number | null> & { calls: number; models: string[] };

export function summarizeAgentUsage(runtimes: AgentRuntime[]): UsageSummary {
  const summary: UsageSummary = {
    calls: 0, models: [], inputTokens: null, outputTokens: null,
    cacheReadTokens: null, cacheWriteTokens: null, cost: null, duration: null,
  };
  const ids = new Set<string>();
  const metrics: Metric[] = ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'cost', 'duration'];
  for (const runtime of runtimes) {
    for (const event of runtime.events) {
      if (event.type !== 'assistant.usage' || ids.has(`${runtime.id}:${event.id}`)) continue;
      ids.add(`${runtime.id}:${event.id}`);
      summary.calls++;
      if (typeof event.data.model === 'string' && !summary.models.includes(event.data.model)) summary.models.push(event.data.model);
      for (const metric of metrics) {
        const value = event.data[metric];
        if (typeof value === 'number' && Number.isFinite(value)) summary[metric] = (summary[metric] ?? 0) + value;
      }
    }
  }
  return summary;
}

export function latestAgentContext(runtime: AgentRuntime) {
  return [...runtime.events].reverse().find((event) => event.type === 'session.usage_info' && !event.agentId)?.data;
}

type Json = AgentRuntime['metadata'][string];
type Quota = NonNullable<AgentOverview['quota']>;

const record = (value: Json | undefined): Record<string, Json> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value) ? value : undefined;
const num = (value: Json | undefined) => typeof value === 'number' && Number.isFinite(value) ? value : null;
const text = (value: Json | undefined) => typeof value === 'string' && value ? value : null;

function accountQuota(runtime: AgentRuntime, key: 'accountQuota' | 'accountQuotaAtStart'): Quota | null {
  const quota = record(runtime.metadata[key]);
  const snapshots = record(quota?.quotaSnapshots);
  if (!snapshots) return null;
  const type = 'premium_interactions' in snapshots ? 'premium_interactions' : Object.keys(snapshots)[0];
  const snapshot = record(snapshots[type]);
  if (!snapshot) return null;
  const unlimited = snapshot.isUnlimitedEntitlement === true || snapshot.entitlementRequests === -1;
  return {
    type, unlimited, used: num(snapshot.usedRequests),
    entitlement: unlimited ? null : num(snapshot.entitlementRequests),
    remainingPercentage: num(snapshot.remainingPercentage),
    resetDate: text(snapshot.resetDate), observedAt: text(quota?.observedAt),
  };
}

function observedQuota(runtime: AgentRuntime): Quota | null {
  for (const event of [...runtime.events].reverse()) {
    if (event.type !== 'session.quota_observation') continue;
    const observation = record(event.data.observation);
    const budget = record(observation?.budgetMetadata);
    if (!observation || !budget) continue;
    const reset = num(budget.resetAtEpochMs);
    return {
      type: text(observation.quotaId) ?? 'quota', unlimited: budget.unlimited === true,
      used: num(budget.consumed), entitlement: budget.unlimited === true ? null : num(budget.entitlement),
      remainingPercentage: num(budget.remainingPercentage),
      resetDate: reset === null ? null : new Date(reset).toISOString(),
      observedAt: text(observation.observedAt) ?? event.timestamp,
    };
  }
  return null;
}

export function agentOverview(runtime: AgentRuntime): AgentOverview {
  const root = runtime.events.filter((event) => !event.agentId);
  const usage = [...root].reverse().find((event) => event.type === 'assistant.usage')?.data;
  const start = root.find((event) => event.type === 'session.start')?.data;
  const context = latestAgentContext(runtime);
  const used = num(context?.currentTokens);
  const limit = num(context?.tokenLimit);
  const quotas = [accountQuota(runtime, 'accountQuota'), accountQuota(runtime, 'accountQuotaAtStart'), observedQuota(runtime)].filter((quota): quota is Quota => !!quota);
  const subagents = new Set<string>();
  for (const event of runtime.events) {
    const name = event.type === 'subagent.started' ? text(event.data.agentName) : null;
    if (name) subagents.add(name);
  }
  return {
    runtimeId: runtime.id, phase: runtime.phase, status: runtime.status,
    provider: text(runtime.metadata.provider) ?? 'unknown',
    model: text(usage?.modelDisplayName) ?? text(usage?.model) ?? text(start?.selectedModel) ?? text(runtime.metadata.requestedModel),
    subagents: [...subagents],
    context: used !== null && limit ? { used, limit } : null,
    quota: quotas.sort((a, b) => (Date.parse(b.observedAt ?? '') || 0) - (Date.parse(a.observedAt ?? '') || 0))[0] ?? null,
  };
}

export const AGENT_ROLES: Record<AgentRuntime['phase'], string> = {
  plan: 'Planning agent', execute: 'Execution agent', review: 'AI review agent',
};

export function agentName(overview: AgentOverview) {
  const provider = overview.provider === 'copilot' ? 'Copilot' : overview.provider;
  return [AGENT_ROLES[overview.phase], overview.model ?? 'default model', provider].join(' · ');
}

export function contextUsage(overview: AgentOverview) {
  if (!overview.context) return null;
  const { used, limit } = overview.context;
  const available = Math.max(0, limit - used);
  return { used, limit, available, availablePercentage: available / limit * 100 };
}

export function quotaUsage(overview: AgentOverview) {
  const quota = overview.quota;
  if (!quota) return null;
  const computed = quota.used !== null && quota.entitlement ? Math.max(0, (1 - quota.used / quota.entitlement) * 100) : null;
  return { ...quota, remainingPercentage: quota.remainingPercentage ?? computed };
}
