import type { AgentOverview } from '../../shared/types/agent';
import { agentName, contextUsage, quotaUsage } from '../../shared/utils/agentTelemetry';

const count = (value: number) => value.toLocaleString();
const percent = (value: number) => `${value.toFixed(value < 10 && value % 1 ? 1 : 0)}%`;

function Gauge({ label, available, detail, compact }: { label: string; available: number | null; detail: string; compact: boolean }) {
  const tone = available === null ? 'bg-slate-500' : available <= 10 ? 'bg-rose-400' : available <= 30 ? 'bg-amber-400' : 'bg-emerald-400';
  return <div className="min-w-0">
    <div className="flex items-baseline justify-between gap-2 text-[11px]">
      <span className="text-slate-500">{label}</span>
      <span className="tabular-nums text-slate-200">{available === null ? 'n/a' : `${percent(available)} available`}</span>
    </div>
    <div role="meter" aria-label={`${label} available`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={available ?? undefined}
      aria-valuetext={available === null ? 'Not reported' : `${percent(available)} available, ${detail}`}
      className={`mt-1 overflow-hidden rounded-full bg-slate-800 ${compact ? 'h-1' : 'h-1.5'}`}>
      <div className={`h-full ${tone}`} style={{ width: `${Math.max(0, Math.min(100, available ?? 0))}%` }} />
    </div>
    {!compact && <p className="mt-1 truncate text-[11px] tabular-nums text-slate-400" title={detail}>{detail}</p>}
  </div>;
}

export default function AgentOverviewSummary({ agent, compact = false }: { agent: AgentOverview | null; compact?: boolean }) {
  if (!agent) return compact ? null : <p className="text-[11px] text-slate-500">No agent telemetry yet for this run.</p>;
  const context = contextUsage(agent);
  const quota = quotaUsage(agent);
  const contextDetail = context ? `${count(context.used)} / ${count(context.limit)} tokens used · ${count(context.available)} left` : 'Not reported';
  const quotaDetail = !quota ? 'Not reported'
    : quota.unlimited ? 'Unlimited entitlement'
      : `${quota.used === null ? '?' : count(quota.used)} / ${quota.entitlement === null ? '?' : count(quota.entitlement)} premium requests used`
        + (quota.resetDate ? ` · resets ${new Date(quota.resetDate).toLocaleDateString()}` : '');
  const name = agentName(agent);
  return <div aria-label="Agent usage" className={compact ? 'space-y-1.5' : 'grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)]'}>
    <div className="min-w-0">
      {!compact && <p className="text-[11px] text-slate-500">Agent</p>}
      <p className={`truncate ${compact ? 'text-[11px] text-indigo-200' : 'text-sm font-medium text-indigo-200'}`} title={name}>{name}</p>
      {!compact && agent.subagents.length > 0 && <p className="truncate text-[11px] text-slate-400" title={agent.subagents.join(', ')}>Subagents: {agent.subagents.join(', ')}</p>}
    </div>
    <Gauge label="Context window" available={context?.availablePercentage ?? null} detail={contextDetail} compact={compact} />
    <Gauge label="Copilot quota" available={quota?.unlimited ? 100 : quota?.remainingPercentage ?? null} detail={quotaDetail} compact={compact} />
  </div>;
}
