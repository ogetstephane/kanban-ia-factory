import { lazy, Suspense, useEffect, useState } from 'react';
import { boardApi } from '../data/boardApi';
import { useOperation } from '../data/useOperation';
import type { AgentSession, SessionActionFocus } from '../types/agent';
import AgentQuestionForm from './AgentQuestionForm';
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
  const [workspacePanel, setWorkspacePanel] = useState<'changes' | 'session'>('changes');
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const result = await boardApi.agentSession(taskId);
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
    setSession(await boardApi.agentAction(taskId, session.id, action, session.updatedAt));
  });

  const canReview = !!session?.workspace && ['completed', 'failed', 'cancelled', 'awaiting_approval'].includes(session.status);
  return (
    <section aria-label="AI ticket session" className={workspaceLayout
      ? 'grid min-h-[calc(100vh-250px)] min-w-0 gap-4 2xl:grid-cols-[minmax(0,1fr)_minmax(24rem,42%)]'
      : 'rounded-xl border border-indigo-500/30 bg-indigo-500/5 p-3'}>
      <div className={workspaceLayout ? 'min-w-0 space-y-3 text-xs' : 'space-y-3 text-xs'}>
      <h3 className="font-semibold text-indigo-300">AI ticket session</h3>
      {loading ? <p>Loading session…</p> : !session && !error ? <p className="text-slate-400">A session starts when this ticket moves to In Progress.</p> : null}
      {(error || operation.error || session?.error) && <p role="alert" className="text-rose-300 whitespace-pre-wrap">{error || operation.error || session?.error}</p>}
      {session && <>
        <p role="status">{SESSION_LABELS[session.status]} · {session.provider} · Attempt {session.attempt}</p>
        {session.branch && <p className="text-slate-400 break-all">Branch: {session.branch} · Base: {session.baseCommit?.slice(0, 7)}</p>}
        {session.workspace && <p className="text-slate-500 break-all">Worktree: {session.workspace}</p>}
        {session.publication?.status === 'pushed' && !session.workspace && <p role="status" className="text-emerald-300">
          Published to origin/{session.publication.branch} · Done · Worktree removed
        </p>}
        {session.publication?.error && <p role="alert" className="text-rose-300">{session.publication.error}</p>}
        {session.publication?.status === 'pushed' && session.workspace && <Suspense fallback={<p>Loading cleanup retry…</p>}>
          <ReviewValidation kind="tasks" id={taskId} onDone={async () => {
            setSession(await boardApi.agentSession(taskId)); onTaskChange?.();
          }} />
        </Suspense>}
        <SessionTimeline key={session.attempt} taskId={taskId} session={session} actions={<div className="space-y-3">
          {session.status === 'awaiting_input' && session.questions.filter((question) => question.answer === null).slice(-1).map((question) =>
            <AgentQuestionForm key={question.id} question={question} pending={operation.pending}
              onAnswer={(answer) => operation.run(async () => {
                setSession(await boardApi.answerAgent(taskId, session.id, question.id, answer));
              })} />)}
          {session.status === 'awaiting_approval' && <div className="space-y-2">
            <p className="text-amber-200">Approval allows file changes and the repository's npm test/lint scripts in this worktree. Scripts are not sandboxed. No automatic commit or push.</p>
            <button type="button" disabled={operation.pending} onClick={() => { void act('approve'); }}
              className="px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50">Approve plan & execute</button>
          </div>}
          {['failed', 'cancelled', 'awaiting_approval'].includes(session.status) &&
            <button type="button" disabled={operation.pending} onClick={() => { void act('retry'); }}
              className="px-3 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 disabled:opacity-50">Regenerate plan</button>}
          {['queued', 'planning', 'awaiting_input', 'awaiting_approval', 'execution_queued', 'executing'].includes(session.status) &&
            <button type="button" disabled={operation.pending} onClick={() => {
              if (window.confirm('Stop this session? Partial changes will be kept for inspection. Running repository scripts may have external side effects.')) void act('cancel');
            }} className="px-3 py-2 rounded bg-rose-900 disabled:opacity-40">Cancel session</button>}
          {!workspaceLayout && session.workspace && ['completed', 'failed', 'cancelled', 'awaiting_approval'].includes(session.status) &&
            <button type="button" className="px-3 py-2 rounded bg-slate-700" onClick={() => setShowReview((value) => !value)}>{showReview ? 'Hide' : 'Open'} code review</button>}
          {session.workspace && session.publication?.status !== 'pushed' && session.reviewStatus === 'accepted' && ['completed', 'delivering'].includes(session.status) &&
            <button type="button" className="px-3 py-2 rounded bg-emerald-800" onClick={() => setShowDelivery((value) => !value)}>{showDelivery ? 'Hide' : 'Open'} local delivery</button>}
          {session.delivery?.status !== 'delivered' && session.publication?.status !== 'pushed' && ['completed', 'failed', 'cancelled', 'awaiting_approval'].includes(session.status) &&
            <div className="space-y-2 rounded-lg border border-slate-700 p-3">
              <label htmlFor={`feedback-${taskId}`} className="block font-medium">Request corrections</label>
              <textarea id={`feedback-${taskId}`} value={feedback} onChange={(event) => setFeedback(event.target.value)} maxLength={20_000} rows={3}
                className="w-full bg-slate-800 p-2 rounded" placeholder="Describe the changes you want. A new read-only plan will require your approval." />
              <button type="button" disabled={operation.pending || !feedback.trim()} className="px-3 py-2 bg-indigo-700 rounded disabled:opacity-40"
                onClick={() => { void operation.run(async () => {
                  setSession(await boardApi.feedbackAgent(taskId, session.id, feedback.trim(), session.updatedAt)); setFeedback(''); setShowReview(false); onTaskChange?.();
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
      {workspaceLayout && <aside aria-label="Session workspace" className="min-w-0 overflow-y-auto rounded-lg border border-slate-800 bg-slate-900/50 p-3">
        <div className="mb-3 flex items-center gap-4 border-b border-slate-800 pb-2 text-xs">
          <button type="button" aria-pressed={workspacePanel === 'changes'}
            className={`border-b-2 pb-2 ${workspacePanel === 'changes' ? 'border-indigo-400 font-medium text-slate-100' : 'border-transparent text-slate-500 hover:text-slate-300'}`}
            onClick={() => setWorkspacePanel('changes')}>Changes</button>
          <button type="button" aria-pressed={workspacePanel === 'session'}
            className={`border-b-2 pb-2 ${workspacePanel === 'session' ? 'border-indigo-400 font-medium text-slate-100' : 'border-transparent text-slate-500 hover:text-slate-300'}`}
            onClick={() => setWorkspacePanel('session')}>Session details</button>
        </div>
        {workspacePanel === 'changes' && session && canReview
          ? <Suspense fallback={<p className="text-sm text-slate-400">Loading changes…</p>}>
            <TicketReview key={`${session.id}-${session.attempt}`} session={session} onChange={setSession} onValidated={onTaskChange} />
          </Suspense>
          : workspacePanel === 'session' && session
            ? <dl className="space-y-3 break-all text-xs">
              <div><dt className="text-slate-500">Status</dt><dd className="mt-1 text-slate-200">{SESSION_LABELS[session.status]}</dd></div>
              <div><dt className="text-slate-500">Provider</dt><dd className="mt-1 text-slate-200">{session.provider}</dd></div>
              <div><dt className="text-slate-500">Branch</dt><dd className="mt-1 font-mono text-slate-300">{session.branch ?? 'Not created'}</dd></div>
              <div><dt className="text-slate-500">Workspace</dt><dd className="mt-1 font-mono text-slate-300">{session.workspace ?? 'Not created'}</dd></div>
              <div><dt className="text-slate-500">Base commit</dt><dd className="mt-1 font-mono text-slate-300">{session.baseCommit?.slice(0, 7) ?? 'Unavailable'}</dd></div>
              <div><dt className="text-slate-500">Attempt</dt><dd className="mt-1 text-slate-200">{session.attempt}</dd></div>
            </dl>
            : <p className="text-sm text-slate-400">{session ? 'Code changes will be available when this run is ready for review.' : 'Session details will appear here when the run starts.'}</p>}
      </aside>}
    </section>
  );
}
