import { useEffect, useState } from 'react';
import type { z } from 'zod';
import type { projectHealthSchema } from '../../shared/types/agent';
import { agentApi } from '../data/agentApi';
import { useOperation } from '../data/useOperation';

export default function ProjectHealth({ projectId }: { projectId: string }) {
  const [data, setData] = useState<z.infer<typeof projectHealthSchema> | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const operation = useOperation();
  useEffect(() => {
    const controller = new AbortController();
    setData(null); setError('');
    void agentApi.projectHealth(projectId, controller.signal).then((value) => {
      if (!controller.signal.aborted) setData(value);
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Unable to diagnose project');
    });
    return () => controller.abort();
  }, [projectId, attempt]);
  return <section aria-label="Project health" className="p-4 border border-slate-700 rounded-xl space-y-3">
    <h2 className="font-semibold">Project health</h2>
    <button type="button" onClick={() => setAttempt((value) => value + 1)} className="px-3 py-2 bg-slate-700 rounded">Run diagnostics again</button>
    {(error || operation.error) && <p role="alert" className="text-rose-300">{error || operation.error}</p>}
    {!data && !error && <p role="status">Checking repository and AI authentication…</p>}
    {data && <>
      <p>{data.projectName} · Branch: {data.branch ?? 'Unavailable'} · Commit: {data.commit?.slice(0, 7) ?? 'Unavailable'}</p>
      <p>{data.provider}: {data.authenticated === null ? 'Authentication unknown' : data.authenticated ? 'Authenticated' : 'Not authenticated'}</p>
      <p>npm scripts: {data.scripts.join(', ') || 'None'}</p>
      {data.issues.length ? <ul className="list-disc pl-5 text-amber-300">{data.issues.map((issue, index) => <li key={index}>{issue}</li>)}</ul> : <p className="text-emerald-300">Prerequisites are available. This does not execute tests.</p>}
      <h3 className="font-medium">Retained ticket worktrees ({data.worktrees.length})</h3>
      <p className="text-sm text-slate-400">Cleanup only removes stopped worktrees with no changes relative to their base. Branches and session history are kept. Dirty worktrees are never forcibly removed.</p>
      {data.worktrees.map((worktree) => <div key={worktree.path} className="p-2 bg-slate-900 rounded text-xs break-all">
        {worktree.branch} · {worktree.status}<br />{worktree.path}
        {['completed', 'failed', 'cancelled'].includes(worktree.status) && <button type="button" disabled={operation.pending}
          className="block mt-2 px-2 py-1 bg-slate-700 rounded disabled:opacity-40"
          onClick={() => {
            if (window.confirm('Remove this worktree only if it has no ticket changes? The branch and history will be kept.')) void operation.run(async () => {
              await agentApi.cleanupAgent(worktree.taskId, worktree.sessionId, worktree.updatedAt);
              setAttempt((value) => value + 1);
            });
          }}>Clean up unchanged worktree</button>}
      </div>)}
    </>}
  </section>;
}
