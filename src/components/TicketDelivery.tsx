import { useEffect, useState } from 'react';
import type { z } from 'zod';
import type { AgentSession, deliveryPreviewSchema } from '../../shared/types/agent';
import { boardApi } from '../data/boardApi';
import { agentApi } from '../data/agentApi';
import { releaseApi } from '../data/releaseApi';
import { useOperation } from '../data/useOperation';
import ReleaseSelect from './ReleaseSelect';

export default function TicketDelivery({ session, onChange, onTaskChange }: {
  session: AgentSession; onChange: (session: AgentSession | null) => void; onTaskChange?: () => void;
}) {
  const [preview, setPreview] = useState<z.infer<typeof deliveryPreviewSchema> | null>(null);
  const [error, setError] = useState('');
  const [version, setVersion] = useState(0);
  const [message, setMessage] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [releaseId, setReleaseId] = useState(session.releaseId ?? '');
  useEffect(() => { setReleaseId(session.releaseId ?? ''); }, [session.releaseId]);
  const operation = useOperation();
  useEffect(() => {
    const controller = new AbortController();
    setPreview(null); setError(''); setAcknowledged(false);
    void agentApi.delivery(session.taskId, controller.signal).then((value) => {
      if (!controller.signal.aborted) {
        setPreview(value); setMessage(value.delivery?.message ?? value.suggestedMessage);
      }
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Unable to load delivery');
    });
    return () => controller.abort();
  }, [session.taskId, session.attempt, version]);

  const act = (action: 'commit' | 'merge') => operation.run(async () => {
    if (!preview) throw new Error('Reload delivery before continuing');
    if (!window.confirm(action === 'commit'
      ? 'Commit all reviewed changes on the ticket branch? Nothing will be pushed or merged yet.'
      : `Merge into ${preview.targetBranch} in the project clone and mark the ticket Done? The original repository will not be modified.`)) return;
    try {
      const result = await agentApi.deliver(session.taskId, action, {
        sessionId: preview.sessionId, updatedAt: preview.updatedAt,
        targetHead: preview.targetHead, ticketHead: preview.ticketHead, tree: preview.tree,
        reviewToken: preview.reviewToken, acknowledgeChecks: acknowledged, message: message.trim(),
      });
      setPreview(result);
      onChange(await agentApi.agentSession(session.taskId));
      if (result.delivery?.status === 'delivered') onTaskChange?.();
    } catch (cause) {
      setPreview(null);
      throw cause;
    }
  });
  const committed = !!preview?.delivery?.commitHash && preview.ticketHead === preview.delivery.commitHash;
  return <section aria-label="Local ticket delivery" className="space-y-3 rounded-lg border border-emerald-500/30 p-3">
    <div className="flex items-center justify-between gap-3">
      <h4 className="font-semibold text-emerald-300">Local delivery</h4>
      <button type="button" disabled={operation.pending} onClick={() => setVersion((value) => value + 1)}>Reload delivery</button>
    </div>
    <p className="text-slate-400">1. Commit on the ticket branch. 2. Merge into the project clone. No push, pull request or changes to the original repository.</p>
    {session.projectId && session.delivery?.status !== 'delivered' && <div className="space-y-2">
      <ReleaseSelect id={`delivery-release-${session.id}`} projectId={session.projectId} value={releaseId} onChange={setReleaseId} disabled={operation.pending || session.status === 'delivering'} />
      {releaseId !== (session.releaseId ?? '') && <button type="button" disabled={operation.pending || !releaseId}
        className="rounded bg-indigo-700 p-2 disabled:opacity-40" onClick={() => { void operation.run(async () => {
          const board = await boardApi.load(session.projectId!);
          const task = board.tasks.find((item) => item.id === session.taskId);
          if (!task) throw new Error('Ticket not found. Reload before assigning a version.');
          await releaseApi.assignRelease(session.projectId!, task.id, releaseId, task.revision);
          onChange(await agentApi.agentSession(task.id)); setVersion((n) => n + 1);
        }); }}>Assign version & reload delivery</button>}
    </div>}
    {(error || operation.error) && <p role="alert" className="text-rose-300 whitespace-pre-wrap">{error || operation.error}</p>}
    {!preview && !error && !operation.error && <p role="status">Loading delivery preview...</p>}
    {preview && <>
      <p className="break-all">{session.branch} → <strong>{preview.targetBranch}</strong> · target {preview.targetHead.slice(0, 7)}</p>
      <p className="text-slate-400 break-all">Clone: {preview.clonePath}</p>
      <p>{preview.fileCount} reviewed files · Human review accepted</p>
      {preview.delivery?.error && <p role="alert" className="text-rose-300 whitespace-pre-wrap">{preview.delivery.error}</p>}
      {preview.delivery?.commitHash && <p className="break-all">Ticket commit: <code>{preview.delivery.commitHash}</code></p>}
      {preview.delivery?.mergeHash && <p className="break-all">Merge commit: <code>{preview.delivery.mergeHash}</code></p>}
      {preview.delivery?.status === 'delivered' ? <p role="status" className="text-emerald-300">Delivered locally. Ticket moved to Done.</p> : <>
        {preview.warnings.length > 0 && <div className="space-y-2 text-amber-200">
          <ul>{preview.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
          <label className="flex gap-2"><input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />
            I explicitly accept delivering despite these failed or missing checks.
          </label>
        </div>}
        <label className="block space-y-1">Commit message
          <textarea value={message} onChange={(event) => setMessage(event.target.value)} disabled={!!preview.delivery || operation.pending}
            maxLength={4000} rows={2} className="block w-full rounded bg-slate-800 p-2 disabled:opacity-60" />
        </label>
        <button type="button" disabled={operation.pending || session.status === 'delivering' || !message.trim() || !preview.fileCount || (preview.warnings.length > 0 && !acknowledged)}
          onClick={() => { void act(committed ? 'merge' : 'commit'); }}
          className="rounded bg-emerald-700 px-3 py-2 hover:bg-emerald-600 disabled:opacity-40">
          {operation.pending ? 'Delivery in progress...' : committed ? '2. Merge & mark Done' : '1. Commit reviewed changes'}
        </button>
      </>}
    </>}
  </section>;
}
