import { useEffect, useState } from 'react';
import type { z } from 'zod';
import type { publicationPreviewSchema } from '../../shared/types/agent';
import { gitApi } from '../data/gitApi';
import { useOperation } from '../data/useOperation';

export default function ReviewValidation({ kind, id, onDone }: {
  kind: 'tasks' | 'features'; id: string; onDone: () => void | Promise<void>;
}) {
  const [preview, setPreview] = useState<z.infer<typeof publicationPreviewSchema> | null>(null);
  const [error, setError] = useState('');
  const [version, setVersion] = useState(0);
  const [confirmed, setConfirmed] = useState(false);
  const [done, setDone] = useState(false);
  const operation = useOperation();
  useEffect(() => {
    const controller = new AbortController();
    setPreview(null); setError(''); setConfirmed(false);
    void gitApi.reviewPublication(kind, id, controller.signal).then((value) => {
      if (!controller.signal.aborted) setPreview(value);
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Unable to prepare review validation');
    });
    return () => controller.abort();
  }, [kind, id, version]);
  return <section aria-label="Validate review" className="space-y-3 rounded-lg border border-emerald-500/30 p-3">
    <h3 className="font-semibold">Validate {kind === 'features' ? 'epic' : 'ticket'} review</h3>
    {(error || operation.error) && <p role="alert" className="text-rose-300">{error || operation.error}</p>}
    {!done && <button type="button" disabled={operation.pending} onClick={() => { operation.clearError(); setVersion((value) => value + 1); }}>Reload validation</button>}
    {!preview && !error && <p role="status">Preparing reviewed snapshots…</p>}
    {preview && !done && <>
      <p>Commit and push {preview.tasks.length} reviewed ticket(s) to <code>origin/{preview.branch}</code>.</p>
      <p className="break-all text-sm text-slate-400">Origin: {preview.origin}. No merge into the project branch. Done is recorded only after the push is verified.</p>
      <p className="text-sm text-slate-400">Published worktrees are removed after the standalone ticket or entire epic is Done. Branches and session history are kept.</p>
      {preview.warnings.map((warning) => <p key={warning} className="text-amber-200">{warning}</p>)}
      <label className="flex gap-2"><input type="checkbox" checked={confirmed} disabled={operation.pending}
        onChange={(event) => setConfirmed(event.target.checked)} />
        I confirm this push to origin and acknowledge any failed or missing checks.
      </label>
      <button type="button" disabled={!confirmed || operation.pending} className="rounded bg-emerald-700 px-3 py-2 disabled:opacity-40"
        onClick={() => { void operation.run(async () => {
          await gitApi.publishReview(kind, id, { ...preview, acknowledgeChecks: confirmed });
          setDone(true);
          await onDone();
        }); }}>
        {operation.pending ? 'Committing and pushing…' : 'Validate review · push & mark Done'}
      </button>
      <p className="text-xs text-slate-400">If a push fails, successfully published tickets stay Done; the epic stays unfinished. Reload validation to retry safely.</p>
    </>}
    {done && <p role="status" className="text-emerald-300">Review validated, pushed to origin/{preview?.branch} and marked Done.</p>}
  </section>;
}
