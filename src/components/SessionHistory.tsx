import { useEffect, useState, type ReactNode } from 'react';
import { agentApi } from '../data/agentApi';
import type { AgentSession } from '../../shared/types/agent';
import { MarkdownPreview } from './MarkdownPreview';
import WorkflowTimeline, { WorkflowStepPanel } from './WorkflowTimeline';
import { getAgentWorkflow } from '../../shared/utils/agentWorkflow';
import type { WorkflowStepId } from '../../shared/types/workflow';
import SessionAgentDetails from './SessionAgentDetails';

type Attempt = AgentSession['attempts'][number];
type Snapshot = Attempt['snapshot'];

function AttemptTimeline({ number, snapshot, createdAt, current, actions, stepActions }: {
  number: number;
  snapshot: Snapshot;
  createdAt: string;
  current: boolean;
  actions?: ReactNode;
  stepActions?: Partial<Record<WorkflowStepId, ReactNode>>;
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
  const workflow = getAgentWorkflow(snapshot);
  const questionStep = workflow.execution !== 'pending' ? 'execution' : 'plan';
  const questions = snapshot.questions.length > 0 && <div className="space-y-2">
    {snapshot.questions.map((question) => <div key={question.id} className="rounded-lg border border-slate-700 p-3">
      <p className="font-medium text-amber-200">{question.answer === null ? 'Question for you' : 'Clarification answered'}</p>
      <p className="mt-1 whitespace-pre-wrap">{question.question}</p>
      {question.answer && <p className="mt-2 whitespace-pre-wrap text-emerald-200">Answer: {question.answer}</p>}
      {question.answeredAt && <time className="mt-1 block text-[10px] text-slate-500">{new Date(question.answeredAt).toLocaleString()}</time>}
    </div>)}
  </div>;

  return <article className={`rounded-xl border p-4 ${current ? 'border-indigo-500/40 bg-indigo-500/5' : 'border-slate-700 bg-slate-900/60'}`}>
    <header className="mb-4 flex flex-wrap items-center justify-between gap-2">
      <h3 className="font-semibold text-slate-100">Run {number}{current ? ' · Current' : ''}</h3>
      <span className={`rounded-full px-2.5 py-1 text-[11px] ${current ? 'bg-indigo-500/15 text-indigo-200' : 'bg-slate-800 text-slate-400'}`}>
        {activeStage}
      </span>
      <time className="w-full text-xs text-slate-500 sm:w-auto">{new Date(createdAt).toLocaleString()}</time>
    </header>

    <SessionAgentDetails snapshot={snapshot} />
    {!current && <div className="mb-4"><WorkflowTimeline workflow={workflow} label={`Workflow for run ${number}`} /></div>}
    <div className="grid min-w-0 gap-3">
      <WorkflowStepPanel step="plan" state={workflow.plan}>
        {snapshot.feedback && <p className="text-xs text-amber-200">Correction request: {snapshot.feedback}</p>}
        <p className="text-slate-500">Read-only implementation plan</p>
        {(snapshot.plan || current && ['queued', 'planning'].includes(snapshot.status)) && <div>
          <h5 className="text-xs text-indigo-200">Preview implementation plan</h5>
          <div className="mt-2 max-h-96 overflow-auto rounded-lg bg-slate-950/70 p-3">
            {snapshot.plan ? <MarkdownPreview source={snapshot.plan} /> : <p className="text-xs text-slate-500">Waiting for the plan…</p>}
          </div>
        </div>}
        {questionStep === 'plan' && questions}
        {current && stepActions?.plan}
      </WorkflowStepPanel>
      <WorkflowStepPanel step="approval" state={workflow.approval}>
        <p className={workflow.approval === 'pending' ? 'text-slate-500' : undefined}>
          {workflow.approval === 'completed' ? 'Plan approved for execution.' : 'The plan must be approved before the agent can change files.'}
        </p>
        {current && stepActions?.approval}
      </WorkflowStepPanel>
      <WorkflowStepPanel step="execution" state={workflow.execution}>
        {(snapshot.output || current && ['execution_queued', 'executing'].includes(snapshot.status)) ? <div>
          <h5 className="text-xs text-indigo-200">Copilot agent content</h5>
          <div className="mt-2 max-h-96 overflow-auto rounded-lg bg-slate-950/70 p-3">
            {snapshot.output ? <MarkdownPreview source={snapshot.output} /> : <p className="text-xs text-slate-500">Waiting for Copilot…</p>}
          </div>
        </div> : <p className="text-slate-500">Execution output will appear here when the approved run starts.</p>}
        {questionStep === 'execution' && questions}
        {current && stepActions?.execution}
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
      </WorkflowStepPanel>
      <WorkflowStepPanel step="review" state={workflow.review}>
        <p className={workflow.review === 'pending' ? 'text-slate-500' : snapshot.reviewStatus === 'accepted' ? 'text-emerald-300' : undefined}>
          {snapshot.reviewStatus === 'accepted' ? 'Review accepted for this run.' : 'Inspect the code changes and checks before accepting this run.'}
        </p>
        {current && stepActions?.review}
      </WorkflowStepPanel>
      <WorkflowStepPanel step="delivery" state={workflow.delivery}>
        {!snapshot.publication && !snapshot.delivery && <p className="text-slate-500">Delivery or publication follows human review acceptance.</p>}
        {snapshot.publication && <div className="space-y-1 break-all">
          <h5 className="font-medium">Review publication · {snapshot.publication.status}</h5>
          <p>origin/{snapshot.publication.branch} · {snapshot.publication.commitHash.slice(0, 7)}</p>
          {snapshot.publication.status === 'pushed' && <p className="text-emerald-300">Push verified · Done</p>}
          {snapshot.publication.error && <p role="alert" className="text-rose-300">{snapshot.publication.error}</p>}
        </div>}
        {snapshot.delivery && <div className="space-y-1 break-all">
          <h5 className="font-medium">Local delivery · {snapshot.delivery.status}</h5>
          <p>{snapshot.delivery.targetBranch} · {snapshot.delivery.mergeHash ?? snapshot.delivery.commitHash ?? 'No commit'}</p>
          {snapshot.delivery.error && <p role="alert" className="whitespace-pre-wrap text-rose-300">{snapshot.delivery.error}</p>}
        </div>}
        {current && stepActions?.delivery}
      </WorkflowStepPanel>
    </div>
    {snapshot.error && <p role="alert" className="mt-3 whitespace-pre-wrap text-xs text-rose-300">{snapshot.error}</p>}
    {current && actions && <div className="mt-4 border-t border-indigo-500/20 pt-4">{actions}</div>}
  </article>;
}

export default function SessionHistory({ taskId, session, actions, stepActions }: {
  taskId: string;
  session: AgentSession;
  actions?: ReactNode;
  stepActions?: Partial<Record<WorkflowStepId, ReactNode>>;
}) {
  const [runs, setRuns] = useState<Attempt[] | null>(null);
  const [historyError, setHistoryError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    void agentApi.agentHistory(taskId, controller.signal).then((value) => {
      if (!controller.signal.aborted) { setRuns(value); setHistoryError(''); }
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) setHistoryError(cause instanceof Error ? cause.message : 'Unable to load previous runs');
    });
    return () => controller.abort();
  }, [taskId, session.attempt]);
  const currentSnapshot: Snapshot = {
    status: session.status, resumeStatus: session.resumeStatus, plan: session.plan, output: session.output, error: session.error,
    feedback: session.feedback, reviewStatus: session.reviewStatus, reviewToken: session.reviewToken,
    questions: session.questions.filter((question) =>
      !(runs ?? []).some((attempt) => attempt.snapshot.questions.some((previous) => previous.id === question.id))),
    checks: session.checks, delivery: session.delivery, publication: session.publication,
    context: session.context, runtimes: session.runtimes,
    sessionInfo: Object.fromEntries(Object.entries(session).filter(([key]) => !['context', 'runtimes', 'attempts'].includes(key))),
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
      stepActions={stepActions}
    />
  </section>;
}
