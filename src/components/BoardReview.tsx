import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { boardApi } from '../data/boardApi';
import type { Task } from '../types/kanban';
import type { AgentSession } from '../types/agent';
import TicketReview from './TicketReview';
import ReviewValidation from './ReviewValidation';

export default function BoardReview({ title, tasks, ai, featureId, onClose, onValidated }: {
  title: string;
  tasks: Task[];
  ai: boolean;
  featureId?: string;
  onValidated?: () => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [validationVersion, setValidationVersion] = useState(0);
  useEffect(() => {
    const element = dialog.current!;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    element.showModal();
    return () => { element.close(); document.body.style.overflow = overflow; };
  }, []);
  return createPortal(<dialog ref={dialog} aria-label={`Review ${title}`}
    className="fixed inset-0 m-0 h-dvh max-h-none w-screen max-w-none overflow-auto border-0 bg-slate-950 p-4 text-slate-100 backdrop:bg-black/70"
    onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <div className="mx-auto max-w-[1600px] space-y-5">
    <header className="flex items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold">Review · {title}</h1>
        <p className="mt-1 text-sm text-slate-400">{tasks.length} ticket(s). Select a changed file to inspect its diff. AI reviews are advisory.</p>
      </div>
      <button type="button" aria-label="Close review" onClick={onClose} className="rounded-lg border border-slate-700 p-2"><X className="h-5 w-5" /></button>
    </header>
    {!tasks.length && <p role="status">This epic has no tickets to review.</p>}
    {tasks.map((task) => <TaskReview key={task.id} task={task} ai={ai} epicReview={!!featureId}
      onAccepted={() => setValidationVersion((value) => value + 1)} onValidated={onValidated} />)}
    {featureId && tasks.length > 0 && <ReviewValidation key={validationVersion} kind="features" id={featureId} onDone={() => { onValidated?.(); onClose(); }} />}
    </div>
  </dialog>, document.body);
}

function TaskReview({ task, ai, epicReview, onValidated, onAccepted }: {
  task: Task; ai: boolean; epicReview: boolean; onValidated?: () => void; onAccepted: () => void;
}) {
  const [session, setSession] = useState<AgentSession | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    void boardApi.agentSession(task.id).then((value) => {
      if (active) {
        setSession(value);
        if (!value?.workspace && value?.publication?.status !== 'pushed') setError('No agent worktree is available for this ticket.');
      }
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : 'Unable to load ticket review');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [task.id]);
  return <section aria-label={`Review ticket ${task.title}`} className="space-y-3">
    <h2 className="font-semibold">{task.title} <span className="text-xs text-slate-400">· {session?.publication?.status === 'pushed' ? 'Done' : task.status}</span></h2>
    {loading && <p role="status">Loading ticket session…</p>}
    {error && <p role="alert" className="text-rose-300">{error}</p>}
    {session?.publication?.status === 'pushed' && !session.workspace && <p role="status" className="text-emerald-300">
      Published to origin/{session.publication.branch} · Done · Worktree removed
    </p>}
    {session?.workspace && <TicketReview session={session} onChange={(value) => { setSession(value); onAccepted(); }}
      autoRunAi={ai} epicReview={epicReview} onValidated={onValidated} />}
  </section>;
}
