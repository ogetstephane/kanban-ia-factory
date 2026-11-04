import { useEffect, useState } from 'react';
import { gitApi } from '../data/gitApi';
import type { GitInventory } from '../../shared/types/git';
import { ALL_PROJECTS } from '../utils/projectLogic';
import GitTaskDiffView from './GitTaskDiffView';
import PublishedWork from './PublishedWork';
import type { z } from 'zod';
import type { publishedWorkListSchema } from '../../shared/types/git';

export default function GitView({ projectId, onOpenTask, openingTicket, ticketError }: {
  projectId: string;
  onOpenTask: (projectId: string, taskId: string) => void;
  openingTicket: boolean;
  ticketError: string;
}) {
  const [inventory, setInventory] = useState<GitInventory | null>(null);
  const [published, setPublished] = useState<Record<string, z.infer<typeof publishedWorkListSchema>>>({});
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [search, setSearch] = useState('');
  const [selectedTask, setSelectedTask] = useState<{ id: string; title: string; status: string } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    void gitApi.gitInventory(projectId, controller.signal).then(async (value) => {
      const work = await Promise.all(value.projects.map(async (project) => [project.id, await gitApi.publishedWork(project.id, controller.signal)] as const));
      if (!controller.signal.aborted) { setInventory(value); setPublished(Object.fromEntries(work)); }
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Unable to load Git inventory');
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [projectId, attempt]);
  if (selectedTask) return <GitTaskDiffView taskId={selectedTask.id} title={selectedTask.title} status={selectedTask.status} onBack={() => setSelectedTask(null)} />;
  const query = search.trim().toLowerCase();
  const projects = inventory?.projects.filter((project) => (projectId === ALL_PROJECTS || project.id === projectId) &&
    [project.name, project.url, project.branch, project.configuredBranch, project.clonePath,
      ...project.worktrees.flatMap((worktree) => [worktree.path, worktree.branch, worktree.task?.title, worktree.task?.id])]
      .concat((published[project.id] ?? []).flatMap((work) => [work.title, work.branch, ...work.tasks.flatMap((task) => [task.title, task.releaseVersion ?? ''])]))
      .some((value) => value?.toLowerCase().includes(query))) ?? [];
  return <section aria-label="Git repositories" className="w-full min-w-0 space-y-5">
    <div className="flex flex-wrap justify-between gap-3">
      <div><h1 className="text-2xl font-bold">Git repositories & worktrees</h1>
        <p className="text-sm text-slate-400">Git inventory for {projectId === ALL_PROJECTS ? 'all projects' : 'the selected project'}. Finish published work with an explicit merge, push and feature-branch closure.</p></div>
      <button type="button" disabled={loading} onClick={() => setAttempt((n) => n + 1)}
        className="rounded bg-indigo-700 px-3 py-2 disabled:opacity-40">Refresh Git inventory</button>
    </div>
    <div className="flex flex-wrap gap-3">
      <label className="grid gap-1 text-xs">Search Git projects and worktrees
        <input value={search} onChange={(event) => setSearch(event.target.value)} className="rounded border border-slate-700 bg-slate-800 p-2 text-sm" placeholder="Project, URL, branch, path or ticket" /></label>
    </div>
    {error && <p role="alert" className="text-rose-300">{error}</p>}
    {ticketError && <p role="alert" className="text-rose-300">{ticketError}</p>}
    {openingTicket && <p role="status">Loading ticket and its project...</p>}
    {loading && <p role="status">Reading local Git repositories...</p>}
    {!loading && !error && <p className="text-sm text-slate-400">{projects.length} Git project(s) · {projects.reduce((sum, project) => sum + project.worktrees.length, 0)} registered worktree(s), including main clones</p>}
    {!loading && !error && !projects.length && <p>No Git inventory matches for the selected project.</p>}
    {!error && projects.map((project) => <article key={project.id} aria-label={`Git project ${project.name}`} className="min-w-0 space-y-3 rounded-xl border border-slate-700 bg-slate-900 p-4">
      <h2 className="text-lg font-semibold">{project.name}</h2>
      <dl className="grid gap-2 text-sm sm:grid-cols-2">
        <div className="min-w-0"><dt className="text-slate-400">Repository URL / source</dt><dd className="break-all">{project.url}</dd></div>
        <div><dt className="text-slate-400">Current clone branch</dt><dd className="break-all">{project.branch ?? (project.error ? 'Unavailable' : 'Detached HEAD')} · {project.head?.slice(0, 12) ?? 'No commit'}</dd></div>
        <div className="min-w-0"><dt className="text-slate-400">Managed clone</dt><dd className="break-all">{project.clonePath}</dd></div>
        <div><dt className="text-slate-400">Configured project branch</dt><dd className="break-all">{project.configuredBranch ?? 'Not set'}</dd></div>
      </dl>
      {project.error && <p role="alert" className="text-rose-300">{project.error} · Refresh after restoring the clone.</p>}
      <div className="space-y-3">
        <h3 className="font-semibold">Published epics & standalone tasks</h3>
        {!(published[project.id]?.length) && <p className="text-sm text-slate-400">No Done, published work yet.</p>}
        {(published[project.id] ?? []).map((work) => <PublishedWork key={`${work.kind}-${work.id}`} work={work}
          projectId={project.id} onOpenTask={onOpenTask} onRefresh={() => setAttempt((value) => value + 1)} />)}
      </div>
      <div className="space-y-2">
        {project.worktrees.map((worktree) => <div key={worktree.path} className="space-y-2 rounded-lg border border-slate-700 p-3 text-sm">
          <div className="flex flex-wrap gap-2">
            <strong className="break-all">{worktree.branch ?? (worktree.bare ? 'Bare repository' : 'Detached HEAD')}</strong>
            <span className="text-slate-400">{worktree.main ? 'Main clone' : 'Linked worktree'} · {worktree.head?.slice(0, 12) ?? 'No commit'}</span>
          </div>
          <p className="break-all font-mono text-xs text-slate-400">{worktree.path}</p>
          {worktree.locked !== null && <p className="break-words text-amber-200">Locked{worktree.locked ? `: ${worktree.locked}` : ''}</p>}
          {worktree.prunable !== null && <p className="break-words text-amber-200">Missing/stale worktree registration{worktree.prunable ? `: ${worktree.prunable}` : ''} · No automatic removal</p>}
          {worktree.task ? <div>
            <button type="button" disabled={openingTicket} className="break-words text-left text-indigo-300 underline disabled:opacity-40"
              onClick={() => onOpenTask(project.id, worktree.task!.id)}>Open ticket: {worktree.task.title}</button>
            <p className="text-xs text-slate-400">{worktree.task.id} · {worktree.task.status} · AI: {worktree.task.sessionStatus}</p>
            <button type="button"
              disabled={!['completed', 'failed', 'cancelled', 'awaiting_approval'].includes(worktree.task.sessionStatus)}
              onClick={() => setSelectedTask({ id: worktree.task!.id, title: worktree.task!.title, status: worktree.task!.sessionStatus })}
              className="mt-2 rounded-lg border border-indigo-400/30 bg-indigo-400/10 px-3 py-1.5 text-xs font-medium text-indigo-200 hover:bg-indigo-400/20 disabled:cursor-not-allowed disabled:opacity-40"
              title={['completed', 'failed', 'cancelled', 'awaiting_approval'].includes(worktree.task.sessionStatus)
                ? 'View the ticket worktree diff' : 'The worktree diff is available when the Copilot session stops'}>
              View task diff
            </button>
          </div> : <p className="text-xs text-slate-400">{worktree.main ? 'Project workspace (not a ticket)' : 'No linked ticket (external worktree or deleted session/ticket)'}</p>}
        </div>)}
      </div>
    </article>)}
  </section>;
}
