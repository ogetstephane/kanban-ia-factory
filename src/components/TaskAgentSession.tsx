import { lazy, Suspense, useEffect, useState } from 'react';
import { agentApi } from '../data/agentApi';
import { useOperation } from '../data/useOperation';
import type { AgentSession, SessionActionFocus } from '../../shared/types/agent';
import AgentQuestionForm from './AgentQuestionForm';
import WorkflowTimeline from './WorkflowTimeline';
import { getAgentWorkflow } from '../../shared/utils/agentWorkflow';
const TicketReview = lazy(() => import('./TicketReview'));
const SessionTimeline = lazy(() => import('./SessionHistory'));
const TicketDelivery = lazy(() => import('./TicketDelivery'));
const ReviewValidation = lazy(() => import('./ReviewValidation'));

export const SESSION_LABELS: Record<AgentSession['status'], string> = {
  queued: 'Plan queued', planning: 'Preparing a read-only plan',
  awaiting_input: 'Waiting for your answer',
  awaiting_approval: 'Plan ready — awaiting your approval',
  execution_queued: 'Approved — execution queued', executing: 'Executing the approved plan',
  completed: 'Execution finished — inspect the changes', failed: 'Session failed',
  cancelling: 'Stopping the session', cancelled: 'Session cancelled — inspect partial changes',
  delivering: 'Delivery or review publication in progress',
};

export default function TaskAgentSession({ taskId, onTaskChange, initialAction, workspaceLayout = false }: {
  taskId: string; onTaskChange?: () => void; initialAction?: SessionActionFocus; workspaceLayout?: boolean;
}) {
  const [session, setSession] = useState<AgentSession | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const operation = useOperation();
  const [showReview, setShowReview] = useState(initialAction === 'review');
  const [showDelivery, setShowDelivery] = useState(initialAction === 'deliver');
  const [feedback, setFeedback] = useState('');
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const result = await agentApi.agentSession(taskId);
        if (active) { setSession(result); setError(''); }
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : 'Unable to load session');
      } finally {
        if (active) { setLoading(false); timer = setTimeout(() => { void load(); }, 2000); }
      }
    };
    void load();
    return () => { active = false; clearTimeout(timer); };
  }, [taskId]);

  const act = (action: 'approve' | 'retry' | 'cancel') => operation.run(async () => {
    if (!session) throw new Error('No session loaded');
    setSession(await agentApi.agentAction(taskId, session.id, action, session.updatedAt));
  });

  const canReview = !!session?.workspace && ['completed', 'failed', 'cancelled', 'awaiting_approval'].includes(session.status);
  const workflow = getAgentWorkflow(session);
  const questionForm = session?.status === 'awaiting_input' && session.questions.filter((question) => question.answer === null).slice(-1).map((question) =>
    <AgentQuestionForm key={question.id} question={question} pending={operation.pending}
      onAnswer={(answer) => operation.run(async () => {
        setSession(await agentApi.answerAgent(taskId, session.id, question.id, answer));
      })} />);
  return (
    <section aria-label="AI ticket session" className={workspaceLayout
      ? 'min-h-[calc(100vh-250px)] min-w-0'
      : 'rounded-xl border border-indigo-500/30 bg-indigo-500/5 p-3'}>
      <div className={workspaceLayout ? 'min-w-0 space-y-3 text-xs' : 'space-y-3 text-xs'}>
      <h3 className="font-semibold text-indigo-300">AI ticket session</h3>
      {loading ? <p>Loading session…</p> : !session && !error ? <p className="text-slate-400">A session starts when this ticket moves to In Progress.</p> : null}
      {(error || operation.error || session?.error) && <p role="alert" className="text-rose-300 whitespace-pre-wrap">{error || operation.error || session?.error}</p>}
      {session && <>
        <p role="status">{SESSION_LABELS[session.status]} · {session.provider} · Attempt {session.attempt}</p>
        <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
          <h4 className="mb-3 text-xs font-semibold text-slate-300">Workflow summary</h4>
          <WorkflowTimeline workflow={workflow} />
        </div>
        {session.branch && <p className="text-slate-400 break-all">Branch: {session.branch} · Base: {session.baseCommit?.slice(0, 7)}</p>}
        {session.workspace && <p className="text-slate-500 break-all">Worktree: {session.workspace}</p>}
        {session.publication?.status === 'pushed' && !session.workspace && <p role="status" className="text-emerald-300">
          Published to origin/{session.publication.branch} · Done · Worktree removed
        </p>}
        {session.publication?.error && <p role="alert" className="text-rose-300">{session.publication.error}</p>}
        {session.publication?.status === 'pushed' && session.workspace && <Suspense fallback={<p>Loading cleanup retry…</p>}>
          <ReviewValidation kind="tasks" id={taskId} onDone={async () => {
            setSession(await agentApi.agentSession(taskId)); onTaskChange?.();
          }} />
        </Suspense>}
        <SessionTimeline key={session.attempt} taskId={taskId} session={session} stepActions={{
          plan: workflow.execution === 'pending' && questionForm,
          execution: workflow.execution !== 'pending' && questionForm,
          approval: session.status === 'awaiting_approval' && <div className="space-y-2">
            <p className="text-amber-200">Approval allows file changes and the repository's npm test/lint scripts in this worktree. Scripts are not sandboxed. No automatic commit or push.</p>
            <button type="button" disabled={operation.pending} onClick={() => { void act('approve'); }}
              className="px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50">Approve plan & execute</button>
          </div>,
          review: canReview && (workspaceLayout
            ? <Suspense fallback={<p>Loading modified files…</p>}>
              <TicketReview key={`${session.id}-${session.attempt}`} session={session} onChange={setSession} onValidated={onTaskChange} summaryOnly />
            </Suspense>
            : <button type="button" className="px-3 py-2 rounded bg-slate-700" onClick={() => setShowReview((value) => !value)}>{showReview ? 'Hide' : 'Open'} code review</button>),
          delivery: session.workspace && session.publication?.status !== 'pushed' && session.reviewStatus === 'accepted' && ['completed', 'delivering'].includes(session.status) &&
            <button type="button" className="px-3 py-2 rounded bg-emerald-800" onClick={() => setShowDelivery((value) => !value)}>{showDelivery ? 'Hide' : 'Open'} local delivery</button>,
        }} actions={<div className="space-y-3">
          {['failed', 'cancelled', 'awaiting_approval'].includes(session.status) &&
            <button type="button" disabled={operation.pending} onClick={() => { void act('retry'); }}
              className="px-3 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 disabled:opacity-50">Regenerate plan</button>}
          {['queued', 'planning', 'awaiting_input', 'awaiting_approval', 'execution_queued', 'executing'].includes(session.status) &&
            <button type="button" disabled={operation.pending} onClick={() => {
              if (window.confirm('Stop this session? Partial changes will be kept for inspection. Running repository scripts may have external side effects.')) void act('cancel');
            }} className="px-3 py-2 rounded bg-rose-900 disabled:opacity-40">Cancel session</button>}
          {session.delivery?.status !== 'delivered' && session.publication?.status !== 'pushed' && ['completed', 'failed', 'cancelled', 'awaiting_approval'].includes(session.status) &&
            <div className="space-y-2 rounded-lg border border-slate-700 p-3">
              <label htmlFor={`feedback-${taskId}`} className="block font-medium">Request corrections</label>
              <textarea id={`feedback-${taskId}`} value={feedback} onChange={(event) => setFeedback(event.target.value)} maxLength={20_000} rows={3}
                className="w-full bg-slate-800 p-2 rounded" placeholder="Describe the changes you want. A new read-only plan will require your approval." />
              <button type="button" disabled={operation.pending || !feedback.trim()} className="px-3 py-2 bg-indigo-700 rounded disabled:opacity-40"
                onClick={() => { void operation.run(async () => {
                  setSession(await agentApi.feedbackAgent(taskId, session.id, feedback.trim(), session.updatedAt)); setFeedback(''); setShowReview(false); onTaskChange?.();
                }); }}>Request a correction plan</button>
            </div>}
        </div>} />
        {!workspaceLayout && session.workspace && ['completed', 'failed', 'cancelled', 'awaiting_approval'].includes(session.status) && <>
          {showReview && <Suspense fallback={<p>Loading review…</p>}><TicketReview key={`${session.id}-${session.attempt}`} session={session} onChange={setSession} onValidated={onTaskChange} /></Suspense>}
        </>}
        {session.delivery?.status === 'delivered' && <p className="text-emerald-300" role="status">Delivered locally to {session.delivery.targetBranch} · {session.delivery.mergeHash?.slice(0, 7)}</p>}
        {session.workspace && session.publication?.status !== 'pushed' && session.reviewStatus === 'accepted' && ['completed', 'delivering'].includes(session.status) && <>
          {showDelivery && <Suspense fallback={<p>Loading delivery...</p>}><TicketDelivery key={`${session.id}-${session.attempt}`} session={session} onChange={setSession} onTaskChange={onTaskChange} /></Suspense>}
        </>}
      </>}
      </div>
    </section>
  );
}
