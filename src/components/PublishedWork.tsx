import { useState } from 'react';
import type { z } from 'zod';
import type { finishPreviewSchema, publishedWorkSchema } from '../../shared/types/git';
import { releaseApi } from '../data/releaseApi';
import { gitApi } from '../data/gitApi';
import { useOperation } from '../data/useOperation';
import ReleaseSelect from './ReleaseSelect';

type Work = z.infer<typeof publishedWorkSchema>;

export default function PublishedWork({ work, projectId, onRefresh, onOpenTask }: {
  work: Work; projectId: string; onRefresh: () => void; onOpenTask: (projectId: string, taskId: string) => void;
}) {
  const [preview, setPreview] = useState<z.infer<typeof finishPreviewSchema> | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const operation = useOperation();
  const finished = work.finishStatus === 'finished';
  return <section aria-label={`Published ${work.title}`} className="space-y-3 rounded-lg border border-emerald-500/25 p-3">
    <div className="flex flex-wrap justify-between gap-2">
      <h3 className="font-semibold">{work.kind === 'features' ? 'Epic' : 'Task'} · {work.title} · Done</h3>
      <span className="text-sm text-slate-400">{finished ? 'Finished · branch closed' : work.finishStatus ?? 'Ready to finish'}</span>
    </div>
    <p className="break-all font-mono text-sm">origin/{work.branch}</p>
    {work.finishError && <p role="alert" className="text-rose-300">{work.finishError}</p>}
    {operation.error && <p role="alert" className="text-rose-300">{operation.error}</p>}
    {work.tasks.map((task) => <div key={task.id} className="space-y-2 border-t border-slate-700 pt-2">
      <button type="button" className="text-indigo-300 underline" onClick={() => onOpenTask(projectId, task.id)}>{task.title}</button>
      <p className="text-xs text-slate-400">Release: {task.releaseVersion ? `v${task.releaseVersion}` : 'Unassigned · create the next release before Finish'}</p>
      {!finished && !work.finishStatus && <ReleaseSelect projectId={projectId} value={task.releaseId ?? ''}
        id={`git-release-${task.id}`} disabled={operation.pending} onChange={(value) => { void operation.run(async () => {
          await releaseApi.assignRelease(projectId, task.id, value || null, task.revision); setPreview(null); onRefresh();
        }); }} />}
    </div>)}
    {!finished && <button type="button" disabled={operation.pending} className="rounded bg-indigo-700 px-3 py-2 disabled:opacity-40"
      onClick={() => { void operation.run(async () => {
        setPreview(null); setConfirmed(false); setPreview(await gitApi.finishPreview(work.kind, work.id));
      }); }}>{operation.pending ? 'Working…' : preview ? 'Reload Finish preview' : work.finishStatus ? 'Retry Finish' : 'Finish'}</button>}
    {preview && !finished && <div className="space-y-3 rounded border border-amber-500/30 p-3">
      <p>Merge <code>{preview.branch}</code> into <code>{preview.targetBranch}</code> for <strong>v{preview.releaseVersion}</strong>.</p>
      <p className="break-all text-sm text-slate-400">Origin: {preview.origin}. Push the project branch, then delete the feature branch locally and on origin. This does not publish the release tag.</p>
      <label className="flex gap-2"><input type="checkbox" checked={confirmed} disabled={operation.pending}
        onChange={(event) => setConfirmed(event.target.checked)} />I confirm the merge, push and feature-branch deletion.</label>
      <button type="button" disabled={!confirmed || operation.pending} className="rounded bg-emerald-700 px-3 py-2 disabled:opacity-40"
        onClick={() => { void operation.run(async () => {
          await gitApi.finishBranch(work.kind, work.id, preview); setPreview(null); onRefresh();
        }); }}>{operation.pending ? 'Finishing…' : 'Confirm Finish · merge, push & close branch'}</button>
    </div>}
  </section>;
}
