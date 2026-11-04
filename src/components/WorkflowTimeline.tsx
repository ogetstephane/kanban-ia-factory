import type { ReactNode } from 'react';
import { Check, ClipboardCheck, Eye, FileText, Play, Send } from 'lucide-react';
import { WORKFLOW_STEPS, type AgentWorkflow, type WorkflowStepId, type WorkflowStepState } from '../../shared/types/workflow';

const STEP_ICONS = { plan: FileText, approval: ClipboardCheck, execution: Play, review: Eye, delivery: Send };
const STATE_LABELS: Record<WorkflowStepState, string> = {
  pending: 'Not started', active: 'In progress', waiting: 'Waiting for you',
  completed: 'Completed', skipped: 'Skipped by agent', failed: 'Failed', stopped: 'Stopped',
};
const STATE_STYLES: Record<WorkflowStepState, string> = {
  pending: 'border-slate-800 bg-slate-900 text-slate-500',
  active: 'border-indigo-400/60 bg-indigo-500/15 text-indigo-200',
  waiting: 'border-amber-400/50 bg-amber-500/10 text-amber-200',
  completed: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  skipped: 'border-dashed border-slate-600 bg-slate-900 text-slate-500',
  failed: 'border-rose-500/50 bg-rose-500/10 text-rose-300',
  stopped: 'border-slate-600 bg-slate-800 text-slate-400',
};

export function WorkflowStepIcon({ step, state, compact = false }: { step: WorkflowStepId; state: WorkflowStepState; compact?: boolean }) {
  const Icon = STEP_ICONS[step];
  return <span aria-hidden="true" className={`relative inline-flex shrink-0 items-center justify-center rounded-full border ${compact ? 'aspect-square w-full max-w-6' : 'h-7 w-7'} ${STATE_STYLES[state]}`}>
    <Icon className={compact ? 'h-3 w-3 max-w-full' : 'h-3.5 w-3.5'} />
    {state === 'completed' && <Check className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-slate-950 text-emerald-300" />}
  </span>;
}

export default function WorkflowTimeline({ workflow, compact = false, label = 'Agent workflow' }: {
  workflow: AgentWorkflow;
  compact?: boolean;
  label?: string;
}) {
  return <ol aria-label={label} className={compact ? 'grid min-w-0 grid-cols-5 gap-1' : 'grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-5'}>
    {WORKFLOW_STEPS.map(({ id, label: stepLabel }, index) => {
      const state = workflow[id];
      return <li key={id} data-step={id} data-state={state}
        aria-current={state === 'active' || state === 'waiting' ? 'step' : undefined}
        title={`${stepLabel}: ${STATE_LABELS[state]}`}
        className={`relative min-w-0 ${compact ? 'grid justify-items-center' : 'flex flex-col gap-1 border-t-2 pt-2'} ${state === 'completed' ? 'border-emerald-500/40' : state === 'pending' ? 'border-slate-800' : 'border-slate-600'}`}>
        {compact && index > 0 && <span aria-hidden="true" className={`absolute -left-1 right-0 top-3 h-px ${state === 'completed' ? 'bg-emerald-500/40' : 'bg-slate-700'}`} />}
        <WorkflowStepIcon step={id} state={state} compact={compact} />
        <span className={compact ? 'sr-only' : `break-words text-xs font-medium ${state === 'pending' ? 'text-slate-500' : 'text-slate-200'}`}>{stepLabel}</span>
        <span className={compact ? 'sr-only' : 'text-[10px] text-slate-500'}>{STATE_LABELS[state]}</span>
      </li>;
    })}
  </ol>;
}

export function WorkflowStepPanel({ step, state, children }: {
  step: WorkflowStepId;
  state: WorkflowStepState;
  children?: ReactNode;
}) {
  const label = WORKFLOW_STEPS.find((item) => item.id === step)!.label;
  return <section aria-label={`${label} step`} data-state={state}
    className={`min-w-0 rounded-xl border p-3 ${state === 'pending' ? 'border-slate-800 bg-slate-950/20' : 'border-slate-700 bg-slate-900/60'}`}>
    <header className="mb-3 flex flex-wrap items-center gap-2">
      <WorkflowStepIcon step={step} state={state} />
      <h4 className={`text-sm font-semibold ${state === 'pending' ? 'text-slate-500' : 'text-slate-200'}`}>{label}</h4>
      <span className="text-[11px] text-slate-500">{STATE_LABELS[state]}</span>
    </header>
    <div className="space-y-3 text-xs text-slate-300">{children ?? <p className="text-slate-500">This step has not started yet.</p>}</div>
  </section>;
}
