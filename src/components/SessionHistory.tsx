import { useEffect, useState, type ReactNode } from 'react';
import { boardApi } from '../data/boardApi';
import type { AgentSession } from '../types/agent';
import { MarkdownPreview } from './MarkdownPreview';

type Attempt = AgentSession['attempts'][number];
type Snapshot = Attempt['snapshot'];

function TimelineEvent({ title, state, children, current = false }: {
  title: string;
  state?: string;
  children?: ReactNode;
  current?: boolean;
}) {
  return <li className="relative pl-6 pb-5 last:pb-0">
    <span className={`absolute left-0 top-1.5 h-2.5 w-2.5 rounded-full ring-4 ring-slate-950 ${current ? 'bg-indigo-400' : 'bg-slate-600'}`} />
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
      <h4 className="font-medium text-slate-200">{title}</h4>
      {state && <span className="text-[11px] text-slate-400">{state}</span>}
    </div>
    {children && <div className="mt-2 space-y-2 text-slate-300">{children}</div>}
  </li>;
}

function AttemptTimeline({ number, snapshot, createdAt, current, actions }: {
  number: number;
  snapshot: Snapshot;
  createdAt: string;
  current: boolean;
  actions?: ReactNode;
}) {
  const activeStage = snapshot.status === 'queued' || snapshot.status === 'planning'
    ? 'Planning'
    : snapshot.status === 'awaiting_input'
      ? 'Waiting for an answer'
      : snapshot.status === 'awaiting_approval'
        ? 'Plan ready'
        : snapshot.status === 'execution_queued' || snapshot.status === 'executing'
          ? 'Execution'
          : snapshot.status === 'delivering'
            ? 'Delivery'
            : snapshot.status === 'completed'
              ? 'Completed'
              : snapshot.status === 'failed'
                ? 'Failed'
                : snapshot.status === 'cancelled'
                  ? 'Cancelled'
                  : snapshot.status;
  const checksPassed = snapshot.checks.filter((check) => check.passed).length;

  return <article className={`rounded-xl border p-4 ${current ? 'border-indigo-500/40 bg-indigo-500/5' : 'border-slate-700 bg-slate-900/60'}`}>
    <header className="mb-4 flex flex-wrap items-center justify-between gap-2">
      <h3 className="font-semibold text-slate-100">Run {number}{current ? ' · Current' : ''}</h3>
      <span className={`rounded-full px-2.5 py-1 text-[11px] ${current ? 'bg-indigo-500/15 text-indigo-200' : 'bg-slate-800 text-slate-400'}`}>
        {activeStage}
      </span>
      <time className="w-full text-xs text-slate-500 sm:w-auto">{new Date(createdAt).toLocaleString()}</time>
    </header>

    <ol className="relative ml-1 border-l border-slate-700">
      <TimelineEvent title="Plan" state={current && ['queued', 'planning'].includes(snapshot.status)
        ? snapshot.plan ? 'Streaming preview' : 'In progress'
        : snapshot.plan ? 'Prepared' : 'Not available'} current={current && ['queued', 'planning', 'awaiting_approval'].includes(snapshot.status)}>
        {snapshot.feedback && <p className="text-xs text-amber-200">Correction request: {snapshot.feedback}</p>}
        {(snapshot.plan || current && ['queued', 'planning'].includes(snapshot.status)) && <details open={current && ['queued', 'planning', 'awaiting_input', 'awaiting_approval'].includes(snapshot.status)}>
          <summary className="cursor-pointer text-xs text-indigo-200">Preview implementation plan</summary>
          <div className="mt-2 max-h-96 overflow-auto rounded-lg bg-slate-950/70 p-3">
            {snapshot.plan ? <MarkdownPreview source={snapshot.plan} /> : <p className="text-xs text-slate-500">Waiting for the plan…</p>}
          </div>
        </details>}
      </TimelineEvent>

      {snapshot.questions.map((question) => <TimelineEvent
        key={question.id}
        title={question.answer === null ? 'Question for you' : 'Clarification answered'}
        state={question.answeredAt ? new Date(question.answeredAt).toLocaleString() : undefined}
        current={current && question.answer === null}
      >
        <p className="whitespace-pre-wrap text-xs">{question.question}</p>
        {question.answer && <p className="whitespace-pre-wrap text-xs text-emerald-200">Answer: {question.answer}</p>}
      </TimelineEvent>)}

      <TimelineEvent title="Execution" state={['execution_queued', 'executing'].includes(snapshot.status)
        ? snapshot.output ? 'Streaming agent content' : 'In progress'
        : snapshot.output ? 'Result available' : snapshot.error ? 'Stopped with an error' : 'Not started'} current={current && ['execution_queued', 'executing', 'completed', 'failed', 'cancelled'].includes(snapshot.status)}>
        {(snapshot.output || current && ['execution_queued', 'executing'].includes(snapshot.status)) && <details open={current && ['execution_queued', 'executing'].includes(snapshot.status)}>
          <summary className="cursor-pointer text-xs text-indigo-200">View Copilot agent content</summary>
          <div className="mt-2 max-h-96 overflow-auto rounded-lg bg-slate-950/70 p-3">
            {snapshot.output ? <MarkdownPreview source={snapshot.output} /> : <p className="text-xs text-slate-500">Waiting for Copilot…</p>}
          </div>
        </details>}
        {snapshot.error && <p role="alert" className="whitespace-pre-wrap text-xs text-rose-300">{snapshot.error}</p>}
        {snapshot.checks.length > 0 && <details>
          <summary className="cursor-pointer text-xs">Checks · {checksPassed}/{snapshot.checks.length} passed</summary>
          <div className="mt-2 space-y-2">
            {snapshot.checks.map((check) => <details key={check.id} className="rounded-lg bg-slate-950/70 p-2">
              <summary className={check.passed ? 'cursor-pointer text-emerald-300' : 'cursor-pointer text-rose-300'}>
                npm run {check.script}: {check.passed ? 'Passed' : 'Failed'} · {new Date(check.createdAt).toLocaleString()}
              </summary>
              <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap text-xs">{check.output}</pre>
            </details>)}
          </div>
        </details>}
      </TimelineEvent>

      <TimelineEvent title="Human review" state={snapshot.reviewStatus.replace('_', ' ')} current={current && snapshot.reviewStatus === 'pending'}>
        {snapshot.reviewStatus === 'accepted' && <p className="text-xs text-emerald-300">Review accepted for this run.</p>}
      </TimelineEvent>
      {snapshot.publication && <TimelineEvent title="Review publication" state={snapshot.publication.status}>
        <p>origin/{snapshot.publication.branch} · {snapshot.publication.commitHash.slice(0, 7)}</p>
        {snapshot.publication.status === 'pushed' && <p className="text-emerald-300">Push verified · Done</p>}
        {snapshot.publication.error && <p role="alert" className="text-rose-300">{snapshot.publication.error}</p>}
      </TimelineEvent>}

      {snapshot.delivery && <TimelineEvent title="Local delivery" state={snapshot.delivery.status} current={current && snapshot.delivery.status !== 'delivered'}>
        <p className="break-all text-xs">
          {snapshot.delivery.targetBranch} · {snapshot.delivery.mergeHash ?? snapshot.delivery.commitHash ?? 'No commit'}
        </p>
        {snapshot.delivery.error && <p role="alert" className="whitespace-pre-wrap text-xs text-rose-300">{snapshot.delivery.error}</p>}
      </TimelineEvent>}
    </ol>
    {current && actions && <div className="mt-4 border-t border-indigo-500/20 pt-4">{actions}</div>}
  </article>;
}

export default function SessionHistory({ taskId, session, actions }: {
  taskId: string;
  session: AgentSession;
  actions?: ReactNode;
}) {
  const [runs, setRuns] = useState<Attempt[] | null>(null);
  const [historyError, setHistoryError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    void boardApi.agentHistory(taskId, controller.signal).then((value) => {
      if (!controller.signal.aborted) { setRuns(value); setHistoryError(''); }
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) setHistoryError(cause instanceof Error ? cause.message : 'Unable to load previous runs');
    });
    return () => controller.abort();
  }, [taskId, session.attempt]);
  const currentSnapshot: Snapshot = {
    status: session.status, plan: session.plan, output: session.output, error: session.error,
    feedback: session.feedback, reviewStatus: session.reviewStatus, reviewToken: session.reviewToken,
    questions: session.questions.filter((question) =>
      !(runs ?? []).some((attempt) => attempt.snapshot.questions.some((previous) => previous.id === question.id))),
    checks: session.checks, delivery: session.delivery, publication: session.publication,
  };
  return <section aria-label={`Session timeline for ${taskId}`} className="space-y-4">
    <h2 className="text-sm font-semibold text-slate-200">Run timeline</h2>
    {historyError && <p role="alert" className="text-xs text-rose-300">{historyError}</p>}
    {runs === null && !historyError && <p className="text-xs text-slate-500">Loading previous runs…</p>}
    {runs?.length === 0 && <p className="text-xs text-slate-500">This is the first run for this ticket.</p>}
    {[...(runs ?? [])].reverse().map((attempt) => <AttemptTimeline
      key={attempt.number}
      number={attempt.number}
      snapshot={attempt.snapshot}
      createdAt={attempt.createdAt}
      current={false}
    />)}
    <AttemptTimeline
      number={session.attempt}
      snapshot={currentSnapshot}
      createdAt={(runs ?? []).find((attempt) => attempt.number === session.attempt - 1)?.createdAt ?? session.createdAt}
      current
      actions={actions}
    />
  </section>;
}
