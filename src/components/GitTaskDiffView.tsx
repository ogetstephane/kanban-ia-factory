import { useEffect, useState } from 'react';
import { ArrowLeft, LoaderCircle } from 'lucide-react';
import { agentApi } from '../data/agentApi';
import type { reviewSchema } from '../../shared/types/agent';
import type { z } from 'zod';
import FileDiff from './FileDiff';

type Review = z.infer<typeof reviewSchema>;
type ReviewFile = Review['files'][number];

export default function GitTaskDiffView({ taskId, title, status, onBack }: {
  taskId: string;
  title: string;
  status: string;
  onBack: () => void;
}) {
  const [review, setReview] = useState<Review | null>(null);
  const [selected, setSelected] = useState('');
  const [file, setFile] = useState<ReviewFile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    setReview(null);
    setFile(null);
    void agentApi.reviewAgent(taskId, controller.signal).then((value) => {
      if (!controller.signal.aborted) {
        setReview(value);
        setSelected(value.files[0]?.path ?? '');
      }
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Unable to load ticket diff');
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [taskId]);

  useEffect(() => {
    if (!selected || !review) { setFile(null); return; }
    const controller = new AbortController();
    setFile(null);
    void agentApi.reviewAgent(taskId, controller.signal, selected).then((value) => {
      if (controller.signal.aborted) return;
      if (value.token !== review.token) throw new Error('Ticket files changed. Go back and reopen the diff.');
      setFile(value.files.find((entry) => entry.path === selected) ?? null);
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Unable to load file diff');
    });
    return () => controller.abort();
  }, [taskId, selected, review]);

  const files = review?.files ?? [];
  return <section aria-label={`Git diff for ${title}`} className="w-full min-w-0 space-y-4">
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-start gap-3">
        <button type="button" onClick={onBack} className="rounded-lg border border-slate-700 p-2 text-slate-300 hover:bg-slate-800" aria-label="Back to Git inventory">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div>
          <h1 className="text-xl font-semibold text-white">Ticket diff · {title}</h1>
          <p className="text-xs text-slate-400">{taskId} · session {status}</p>
        </div>
      </div>
      {review && <p className="text-xs text-slate-400">Compared with base {review.baseCommit.slice(0, 12)} · {files.length} changed file(s)</p>}
    </header>
    {loading && <p role="status" className="flex items-center gap-2 text-sm text-slate-400"><LoaderCircle className="h-4 w-4 animate-spin" />Loading ticket diff…</p>}
    {error && <p role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">{error}</p>}
    {!loading && review && <>
      {review.documentation && <p className={`text-xs ${review.documentation.ready ? 'text-emerald-300' : 'text-amber-200'}`}>
        Required ticket documentation: <code>{review.documentation.path}</code> · {review.documentation.ready ? 'present' : 'missing or empty'}
      </p>}
      <FileDiff files={files} selected={selected} onSelect={setSelected} baseCommit={review.baseCommit} file={file} error={error} />
    </>}
  </section>;
}
