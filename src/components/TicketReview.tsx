import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { LoaderCircle, Maximize2, Sparkles, X } from 'lucide-react';
import type { z } from 'zod';
import { agentApi } from '../data/agentApi';
import { useOperation } from '../data/useOperation';
import type { AgentSession, reviewSchema } from '../../shared/types/agent';
import FileDiff from './FileDiff';
import ReviewValidation from './ReviewValidation';

export default function TicketReview({ session, onChange, autoRunAi = false, epicReview = false, onValidated, summaryOnly = false }: {
  session: AgentSession; onChange: (session: AgentSession | null) => void; autoRunAi?: boolean;
  epicReview?: boolean; onValidated?: () => void; summaryOnly?: boolean;
}) {
  const [review, setReview] = useState<z.infer<typeof reviewSchema> | null>(null);
  const [error, setError] = useState('');
  const [version, setVersion] = useState(0);
  const [selected, setSelected] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [criteria, setCriteria] = useState<number[]>([]);
  const [file, setFile] = useState<z.infer<typeof reviewSchema>['files'][number] | null>(null);
  const [aiReport, setAiReport] = useState<{ token: string; report: string } | null>(null);
  const [aiPending, setAiPending] = useState(false);
  const [aiError, setAiError] = useState('');
  const operation = useOperation();
  const autoStarted = useRef(false);
  const [fullscreen, setFullscreen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const expand = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    if (!fullscreen) return;
    const element = dialog.current!;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    element.showModal();
    return () => {
      element.close();
      document.body.style.overflow = overflow;
      expand.current?.focus();
    };
  }, [fullscreen]);
  useEffect(() => {
    const controller = new AbortController();
    setReview(null); setConfirmed(false); setCriteria([]);
    void agentApi.reviewAgent(session.taskId, controller.signal).then((value) => {
      if (!controller.signal.aborted) {
        setReview(value); setError(''); setSelected(value.files[0]?.path ?? '');
        setAiReport((current) => current?.token === value.token ? current : null);
      }
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Unable to load review');
    });
    return () => controller.abort();
  }, [session.taskId, session.attempt, version]);
  useEffect(() => {
    setFile(null);
    if (!selected || !review || summaryOnly && !fullscreen) return;
    const controller = new AbortController();
    void agentApi.reviewAgent(session.taskId, controller.signal, selected).then((value) => {
      if (controller.signal.aborted) return;
      if (value.token !== review.token) throw new Error('Files changed. Reload the diff before continuing.');
      setFile(value.files.find((item) => item.path === selected) ?? null);
      setError('');
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) { setConfirmed(false); setError(cause instanceof Error ? cause.message : 'Unable to load file diff'); }
    });
    return () => controller.abort();
  }, [selected, review, session.taskId, summaryOnly, fullscreen]);
  const runAiReview = async () => {
    if (!review || aiPending) return;
    setAiPending(true); setAiError('');
    try { setAiReport(await agentApi.aiReviewAgent(session.taskId, review.token)); }
    catch (cause) { setAiError(cause instanceof Error ? cause.message : 'Unable to run the AI review'); }
    finally { setAiPending(false); }
  };
  useEffect(() => {
    if (autoRunAi && review && !autoStarted.current) {
      autoStarted.current = true;
      void runAiReview();
    }
  }, [autoRunAi, review]);
  const content = <section aria-label="Ticket code review" className="min-w-0 space-y-3 border border-slate-700 p-3 rounded-lg">
    <div className="flex flex-wrap justify-between gap-3">
      <h4 className="font-semibold">Code review · {review?.files.length ?? 0} changed files</h4>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setVersion((value) => value + 1)}>Reload diff</button>
        <button type="button" disabled={!review || aiPending} onClick={() => void runAiReview()}
          className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-40">
          {aiPending ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          {aiPending ? 'Reviewing…' : aiReport?.token === review?.token ? 'Run AI review again' : 'Run AI review'}
        </button>
      </div>
    </div>
    {(error || operation.error || aiError) && <p role="alert" className="text-rose-300">{error || operation.error || aiError}</p>}
    {!review && !error && <p role="status">Loading changes…</p>}
    {review && <>
      <p className="text-slate-400">Compared with {review.baseCommit.slice(0, 7)}. Inspecting or accepting the diff does not commit or push; use Validate review to publish and mark Done.</p>
      {!review.documentation
        ? <p role="alert" className="text-amber-200">The server has not loaded the required ticket-documentation review check yet. Restart the Kanban Flow Copilot server, then reload this diff.</p>
        : <p role={review.documentation.ready ? 'status' : 'alert'} className={review.documentation.ready ? 'text-emerald-300' : 'text-amber-200'}>
          {review.documentation.ready
            ? <>Ticket documentation is ready: <code>{review.documentation.path}</code></>
            : <>Review acceptance is blocked until this ticket has a non-empty, changed document: <code>{review.documentation.path}</code>. Request a correction plan to add it to the worktree.</>}
        </p>}
      {session.reviewStatus === 'accepted' && session.reviewToken !== review.token && <p role="alert" className="text-amber-300">Files changed after human acceptance. The acceptance applies to the earlier snapshot, not these changes.</p>}
      {aiReport?.token === review.token && <div className="space-y-2 rounded-lg border border-indigo-400/20 bg-indigo-400/5 p-3">
        <h5 className="flex items-center gap-2 text-sm font-medium text-indigo-200"><Sparkles className="h-4 w-4" /> AI review · advisory</h5>
        <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words text-sm text-slate-200">{aiReport.report}</pre>
        <p className="text-xs text-slate-500">The AI review is advisory and does not replace your human review. Reload the diff and run it again after changing files.</p>
      </div>}
      <FileDiff files={review.files} selected={selected} onSelect={setSelected} baseCommit={review.baseCommit} file={file} error={error} allowFullscreen={!fullscreen} />
      {session.status === 'completed' && session.delivery?.status !== 'delivered' && session.publication?.status !== 'pushed' && (session.reviewStatus === 'pending' || session.reviewToken !== review.token) && <>
        <h4 className="font-medium">Acceptance criteria</h4>
        {review.criteria.map((criterion, index) => <label key={index} className="flex gap-2">
          <input type="checkbox" checked={criteria.includes(index)} onChange={(event) => setCriteria((current) => event.target.checked ? [...current, index] : current.filter((value) => value !== index))} />
          {criterion}
        </label>)}
        <label className="flex gap-2 text-amber-200">
          <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
          I have reviewed these changes and the check results, including any failed or missing checks.
        </label>
        <button type="button" disabled={!!error || !review.documentation?.ready || !confirmed || criteria.length !== review.criteria.length || operation.pending}
          className="bg-emerald-700 px-3 py-2 rounded disabled:opacity-40"
          onClick={() => { void operation.run(async () => onChange(await agentApi.acceptReview(session.taskId, session.id, session.updatedAt, review.token))); }}>
          Accept human review
        </button>
      </>}
      {session.publication?.status === 'pushed' && <p role="status" className="text-emerald-300">Validated and pushed to origin/{session.publication.branch} · Done</p>}
      {!epicReview && session.status === 'completed' && session.publication?.status !== 'pushed' &&
        session.reviewStatus === 'accepted' && session.reviewToken === review.token &&
        <ReviewValidation key={`${session.updatedAt}-${review.token}`} kind="tasks" id={session.taskId} onDone={async () => {
          onChange(await agentApi.agentSession(session.taskId)); onValidated?.();
        }} />}
    </>}
  </section>;
  if (!summaryOnly) return content;
  return <>
    <section aria-label="Modified files summary" className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h5 className="font-medium text-slate-200">Modified files{review ? ` (${review.files.length})` : ''}</h5>
        <button ref={expand} type="button" disabled={!review} onClick={() => setFullscreen(true)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-slate-700 px-3 py-2 hover:bg-slate-600 disabled:opacity-40">
          <Maximize2 className="h-3.5 w-3.5" />Open diff in full screen
        </button>
      </div>
      {error && <p role="alert" className="text-rose-300">{error}</p>}
      {!review && !error && <p role="status" className="text-slate-500">Loading modified files…</p>}
      {error && <button type="button" onClick={() => setVersion((value) => value + 1)}>Reload modified files</button>}
      {review && (review.files.length ? <>
        <ul className="space-y-1">
          {review.files.slice(0, 5).map((entry) => <li key={entry.path} className="flex min-w-0 gap-2">
            <span className="shrink-0 font-mono text-amber-300">{entry.status}</span>
            <span className="break-all text-slate-400">{entry.path}</span>
          </li>)}
        </ul>
        {review.files.length > 5 && <p className="text-slate-500">And {review.files.length - 5} more. Open the diff to inspect all files or run an AI review.</p>}
      </> : <p className="text-slate-500">No modified files.</p>)}
    </section>
    {fullscreen && createPortal(<dialog ref={dialog} aria-label="Full-screen code review"
      onCancel={(event) => { event.preventDefault(); event.stopPropagation(); setFullscreen(false); }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setFullscreen(false); }
      }}
      className="fixed inset-0 m-0 h-dvh max-h-none w-screen max-w-none border-0 bg-slate-950 p-0 text-sm text-slate-100 backdrop:bg-black/70">
      <div className="flex h-full min-w-0 flex-col">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-700 p-4">
          <h2 className="font-semibold">Full-screen code review</h2>
          <button type="button" onClick={() => setFullscreen(false)} className="inline-flex items-center gap-2 rounded-lg bg-slate-800 px-3 py-2 hover:bg-slate-700">
            <X className="h-4 w-4" />Close review
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-auto p-4">{content}</div>
      </div>
    </dialog>, document.body)}
  </>;
}
