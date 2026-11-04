import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Bot, Brain, CheckCircle2, Circle, CircleAlert, LoaderCircle, Sparkles, Wrench } from 'lucide-react';
import type { AgentRuntime } from '../../shared/types/agent';
import {
  sessionActivity, object, showActivityReport, toolArgumentSummary, toolLabel,
  type AgentActivity, type ToolActivity,
} from '../utils/sessionActivity';
import { MarkdownPreview } from './MarkdownPreview';

type Props = {
  phase: AgentRuntime['phase'];
  runtimes: AgentRuntime[];
  output: string;
  active: boolean;
  live: boolean;
};

function AgentLabel({ agentId }: { agentId?: string }) {
  return agentId ? <span className="block break-all text-[10px] text-indigo-300">Subagent · {agentId}</span> : null;
}

const Message = memo(function Message({ text, agentId }: { text: string; agentId?: string }) {
  return <div className="min-w-0">
    <AgentLabel agentId={agentId} />
    <MarkdownPreview source={text} />
  </div>;
});

function Reasoning({ text, agentId }: { text: string; agentId?: string }) {
  const [open, setOpen] = useState(false);
  return <details onToggle={(event) => setOpen(event.currentTarget.open)} className="min-w-0 text-slate-400">
    <summary className="flex cursor-pointer items-center gap-2 text-xs hover:text-slate-200">
      <Brain aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
      Reasoning {agentId && <span className="truncate text-[10px] text-indigo-300">· Subagent {agentId}</span>}
    </summary>
    {open && <div className="ml-5 mt-2 border-l border-slate-700 pl-3"><MarkdownPreview source={text} /></div>}
  </details>;
}

function formatValue(value: Exclude<ToolActivity['arguments'], undefined>): string {
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

function Tool({ item }: { item: ToolActivity }) {
  const [open, setOpen] = useState(false);
  const summary = toolArgumentSummary(item.arguments);
  const result = object(item.result);
  const resultValue = result?.detailedContent ?? result?.content ?? item.result;
  const output = item.shellOutput || item.partialOutput;
  const status = item.status === 'running' ? 'Running' : item.status === 'completed' ? 'Completed'
    : item.status === 'failed' ? 'Failed' : 'No completion recorded';
  const Icon = item.status === 'running' ? LoaderCircle : item.status === 'completed' ? CheckCircle2
    : item.status === 'failed' ? CircleAlert : Circle;
  return <div className="min-w-0">
    <details onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="flex min-w-0 cursor-pointer items-start gap-2 text-xs text-slate-300 hover:text-white">
        <Wrench aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-500" />
        <span className="min-w-0 flex-1">
          <span className="font-medium">{toolLabel(item)}</span>
          {summary && <span className="ml-2 break-all text-slate-500">{summary}</span>}
          {item.progress && <span className="mt-1 block whitespace-pre-wrap text-slate-400">{item.progress}</span>}
          <AgentLabel agentId={item.agentId} />
        </span>
        <span className={`flex shrink-0 items-center gap-1 ${item.status === 'failed' ? 'text-rose-300' : item.status === 'completed' ? 'text-emerald-400' : 'text-slate-400'}`}>
          <Icon aria-hidden="true" className={`h-3.5 w-3.5 ${item.status === 'running' ? 'animate-spin' : ''}`} />{status}
        </span>
      </summary>
      {open && <div className="ml-5 mt-2 space-y-2 border-l border-slate-700 pl-3 text-[11px]">
        <p className="break-all text-slate-500">Tool: {item.name}</p>
        {item.arguments !== undefined && <div><p className="text-slate-400">Arguments</p>
          <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded bg-slate-900 p-2 text-slate-300">{formatValue(item.arguments)}</pre>
        </div>}
        {output && <div><p className="text-slate-400">Live output</p>
          <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded bg-slate-900 p-2 text-slate-300">{output}</pre>
        </div>}
        {resultValue !== undefined && <div><p className="text-slate-400">Result</p>
          <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded bg-slate-900 p-2 text-slate-300">{formatValue(resultValue)}</pre>
        </div>}
      </div>}
    </details>
    {item.error && <p className="ml-5 mt-1 whitespace-pre-wrap break-words text-xs text-rose-300">{item.error}</p>}
  </div>;
}

function ActivityItem({ item }: { item: AgentActivity }) {
  if (item.kind === 'message' || item.kind === 'reasoning') {
    return item.kind === 'message'
      ? <Message text={item.text} agentId={item.agentId} />
      : <Reasoning text={item.text} agentId={item.agentId} />;
  }
  if (item.kind === 'tool') return <Tool item={item} />;
  if (item.kind === 'intent') return <p className="flex items-center gap-2 text-xs text-slate-400">
    <Sparkles aria-hidden="true" className="h-3.5 w-3.5 shrink-0" /> {item.text} <AgentLabel agentId={item.agentId} />
  </p>;
  if (item.kind === 'skill') return <p className="flex items-center gap-2 text-xs text-slate-400">
    <Sparkles aria-hidden="true" className="h-3.5 w-3.5 shrink-0" /> Skill · {item.name} <AgentLabel agentId={item.agentId} />
  </p>;
  if (item.kind === 'subagent') return <div className="flex items-start gap-2 text-xs text-slate-400">
    <Bot aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
    <div><p>{item.name} · {item.status === 'unrecorded' ? 'No completion recorded' : item.status}</p>
      {item.description && <p className="mt-1 whitespace-pre-wrap text-slate-500">{item.description}</p>}
      {item.error && <p className="mt-1 whitespace-pre-wrap text-rose-300">{item.error}</p>}
    </div>
  </div>;
  return <p className={`whitespace-pre-wrap text-xs ${item.level === 'error' ? 'text-rose-300' : item.level === 'warning' ? 'text-amber-300' : 'text-slate-400'}`}>
    {item.level === 'error' ? 'Error' : item.level === 'warning' ? 'Warning' : 'Info'}: {item.message}
  </p>;
}

const PHASE_LABELS = { plan: 'Planning', execute: 'Execution', review: 'AI review' };
const REPORT_LABELS = { plan: 'Preview implementation plan', execute: 'Execution report', review: 'AI review report' };

export default function SessionAgentActivity({ phase, runtimes, output, active, live }: Props) {
  const items = useMemo(() => sessionActivity(runtimes, phase), [runtimes, phase]);
  const showReport = showActivityReport(items, output, active);
  const viewport = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const [following, setFollowing] = useState(true);

  useEffect(() => {
    if (follow.current && viewport.current) viewport.current.scrollTop = viewport.current.scrollHeight;
  }, [items, output]);

  const jumpToLatest = () => {
    follow.current = true;
    setFollowing(true);
    if (viewport.current) viewport.current.scrollTop = viewport.current.scrollHeight;
  };

  return <section aria-label={`Copilot ${PHASE_LABELS[phase].toLowerCase()} activity`} className="min-w-0 rounded-lg border border-slate-800 bg-slate-950/70">
    <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 px-3 py-2">
      <h5 className="text-xs font-semibold text-indigo-200">Copilot agent activity · {PHASE_LABELS[phase]}</h5>
      {live && <span className="flex items-center gap-1.5 text-[10px] text-indigo-300">
        <span aria-hidden="true" className="h-1.5 w-1.5 animate-pulse rounded-full bg-indigo-400" /> Live · refreshes every 2 seconds
      </span>}
    </header>
    <div ref={viewport} role="log" aria-label={`Copilot ${PHASE_LABELS[phase].toLowerCase()} activity feed`} aria-live="off" tabIndex={0}
      className="max-h-[32rem] min-h-20 space-y-4 overflow-auto p-3"
      onScroll={(event) => {
        const element = event.currentTarget;
        const atBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 48;
        follow.current = atBottom;
        setFollowing(atBottom);
      }}>
      {!items.length && !showReport && <p className="text-xs text-slate-500">
        {active ? 'Waiting for Copilot activity…' : `No ${PHASE_LABELS[phase].toLowerCase()} activity was recorded for this run.`}
      </p>}
      {items.length > 0 && <ol className="space-y-4">
        {items.map((item) => <li key={item.key} data-activity={item.kind}><ActivityItem item={item} /></li>)}
      </ol>}
      {showReport && <div>
        <h6 className="text-xs font-medium text-slate-400">{REPORT_LABELS[phase]}</h6>
        <MarkdownPreview source={output} />
      </div>}
    </div>
    {!following && <div className="border-t border-slate-800 px-3 py-2 text-right">
      <button type="button" onClick={jumpToLatest} className="text-xs text-indigo-300 hover:text-indigo-100">Jump to latest</button>
    </div>}
  </section>;
}
