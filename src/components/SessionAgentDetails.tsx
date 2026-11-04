import { useState, type ReactNode } from 'react';
import type { AgentRuntime, AgentSession } from '../../shared/types/agent';
import { agentName, agentOverview, latestAgentContext, quotaUsage, summarizeAgentUsage } from '../../shared/utils/agentTelemetry';

type Snapshot = AgentSession['attempts'][number]['snapshot'];

function JsonDetails({ title, value }: { title: string; value: unknown }) {
  const [open, setOpen] = useState(false);
  return <details onToggle={(event) => setOpen(event.currentTarget.open)} className="min-w-0 rounded-lg border border-slate-700 p-3">
    <summary className="cursor-pointer text-xs font-medium text-slate-300">{title}</summary>
    {open && <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-all text-[11px] text-slate-400">{JSON.stringify(value, null, 2)}</pre>}
  </details>;
}

function Metric({ label, children }: { label: string; children: ReactNode }) {
  return <div className="min-w-0 rounded-lg bg-slate-950/60 p-2">
    <dt className="text-[10px] text-slate-500">{label}</dt>
    <dd className="mt-1 break-all text-xs text-slate-200">{children}</dd>
  </div>;
}

const number = (value: number | null | undefined) => value == null ? 'Not reported' : value.toLocaleString(undefined, { maximumFractionDigits: 20 });

function Usage({ runtimes }: { runtimes: AgentRuntime[] }) {
  const usage = summarizeAgentUsage(runtimes);
  return <dl className="grid grid-cols-2 gap-2 lg:grid-cols-4">
    <Metric label="Models">{usage.models.join(', ') || 'Not reported'}</Metric>
    <Metric label="API calls with usage">{usage.calls || 'Not reported'}</Metric>
    <Metric label="Input tokens">{number(usage.inputTokens)}</Metric>
    <Metric label="Output tokens">{number(usage.outputTokens)}</Metric>
    <Metric label="Cache read tokens">{number(usage.cacheReadTokens)}</Metric>
    <Metric label="Cache write tokens">{number(usage.cacheWriteTokens)}</Metric>
    <Metric label="Premium request cost (multiplier units)">{number(usage.cost)}</Metric>
    <Metric label="API duration (ms)">{number(usage.duration)}</Metric>
  </dl>;
}

function RuntimeDetails({ runtime }: { runtime: AgentRuntime }) {
  const context = latestAgentContext(runtime);
  const currentTokens = context?.currentTokens;
  const tokenLimit = context?.tokenLimit;
  const utilization = typeof currentTokens === 'number' && typeof tokenLimit === 'number' && tokenLimit > 0
    ? `${(currentTokens / tokenLimit * 100).toFixed(1)}%` : 'Not reported';
  const start = runtime.events.find((event) => event.type === 'session.start')?.data;
  const configuration = runtime.metadata.configuration;
  const overview = agentOverview(runtime);
  const quota = quotaUsage(overview);
  return <section aria-label={`${runtime.phase} agent runtime`} className="min-w-0 space-y-3 rounded-lg border border-slate-700 p-3">
    <h5 className="text-xs font-semibold text-indigo-200">{runtime.phase === 'plan' ? 'Planning' : runtime.phase === 'execute' ? 'Execution' : 'AI review'} agent · {runtime.status}</h5>
    <Usage runtimes={[runtime]} />
    <dl className="grid grid-cols-2 gap-2 lg:grid-cols-4">
      <Metric label="Agent">{agentName(overview)}</Metric>
      <Metric label="Subagents">{overview.subagents.join(', ') || 'None'}</Metric>
      <Metric label="Copilot quota used / entitlement">{quota ? quota.unlimited ? 'Unlimited' : `${number(quota.used)} / ${number(quota.entitlement)}` : 'Not reported'}</Metric>
      <Metric label="Copilot quota available">{quota?.remainingPercentage == null ? 'Not reported' : `${quota.remainingPercentage.toFixed(1)}%`}</Metric>
      <Metric label="Runtime ID">{runtime.id}</Metric>
      <Metric label="Provider session ID">{runtime.providerSessionId ?? 'Not created'}</Metric>
      <Metric label="Started">{new Date(runtime.startedAt).toLocaleString()}</Metric>
      <Metric label="Ended">{runtime.endedAt ? new Date(runtime.endedAt).toLocaleString() : 'Running'}</Metric>
      <Metric label="Wall duration (ms)">{runtime.endedAt ? number(Date.parse(runtime.endedAt) - Date.parse(runtime.startedAt)) : 'Running'}</Metric>
      <Metric label="Context tokens / limit">{number(typeof currentTokens === 'number' ? currentTokens : null)} / {number(typeof tokenLimit === 'number' ? tokenLimit : null)}</Metric>
      <Metric label="Context utilization">{utilization}</Metric>
      <Metric label="Context available">{typeof currentTokens === 'number' && typeof tokenLimit === 'number' && tokenLimit > 0 ? `${number(Math.max(0, tokenLimit - currentTokens))} (${((1 - currentTokens / tokenLimit) * 100).toFixed(1)}%)` : 'Not reported'}</Metric>
      <Metric label="Runtime events">{runtime.events.length}</Metric>
      <Metric label="Requested model">{typeof runtime.metadata.requestedModel === 'string' ? runtime.metadata.requestedModel : 'Provider default'}</Metric>
      <Metric label="Selected model">{typeof start?.selectedModel === 'string' ? start.selectedModel : 'Not reported'}</Metric>
      <Metric label="Reasoning effort">{typeof start?.reasoningEffort === 'string' ? start.reasoningEffort : 'Not reported'}</Metric>
      <Metric label="Context tier">{typeof start?.contextTier === 'string' ? start.contextTier : 'Not reported'}</Metric>
      <Metric label="Copilot version">{typeof start?.copilotVersion === 'string' ? start.copilotVersion : 'Not reported'}</Metric>
    </dl>
    {runtime.error && <p role="alert" className="whitespace-pre-wrap text-xs text-rose-300">{runtime.error}</p>}
    <JsonDetails title="Context window details (latest root-agent sample)" value={context ?? null} />
    <JsonDetails title="Session initialization metadata" value={start ?? null} />
    <JsonDetails title="Runtime configuration, system instructions and tool definitions" value={configuration ?? null} />
    <JsonDetails title="All supplied context, prompt, attachments and runtime metadata" value={runtime.metadata} />
    <JsonDetails title="All runtime information" value={runtime} />
    <JsonDetails title={`All raw runtime events (${runtime.events.length}) · includes usage, billing, quotas, tools, reasoning and compaction when reported`} value={runtime.events} />
  </section>;
}

export default function SessionAgentDetails({ snapshot }: { snapshot: Snapshot }) {
  return <section aria-label="Agent details" className="mb-4 min-w-0 space-y-3 rounded-xl border border-slate-700 bg-slate-900/70 p-3">
    <h4 className="text-sm font-semibold text-slate-200">Agent details</h4>
    <p className="text-[11px] text-slate-500">All recorded information for this run. Usage includes root agents and subagents across planning, execution and AI review. Cost is the provider's billing multiplier, not a currency amount. Totals cover reported fields and may be incomplete; unreported metrics are not assumed to be zero.</p>
    <Usage runtimes={snapshot.runtimes} />
    <JsonDetails title="All session information" value={{ ...snapshot.sessionInfo, ...snapshot, runtimes: undefined, sessionInfo: undefined }} />
    <JsonDetails title="Ticket, project and feature context snapshot" value={snapshot.context ?? null} />
    {!snapshot.runtimes.length && <p className="text-xs text-slate-400">No runtime telemetry recorded. It will appear when a new agent starts; telemetry from older runs cannot be reconstructed.</p>}
    {snapshot.runtimes.map((runtime) => <RuntimeDetails key={runtime.id} runtime={runtime} />)}
  </section>;
}
