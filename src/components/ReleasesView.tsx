import { useEffect, useState } from 'react';
import type { z } from 'zod';
import { RELEASE_LABELS, releaseEditSchema, versionSchema, type Release, type releaseDetailSchema, type releasePreviewSchema } from '../types/release';
import type { Project, Task } from '../types/kanban';
import { ALL_PROJECTS } from '../utils/projectLogic';
import { boardApi } from '../data/boardApi';
import { useOperation } from '../data/useOperation';

type Detail = z.infer<typeof releaseDetailSchema>;
type Preview = z.infer<typeof releasePreviewSchema>;
const fieldClass = 'rounded border border-slate-700 bg-slate-800 p-2 text-sm disabled:opacity-50';
const buttonClass = 'rounded bg-indigo-700 px-3 py-2 text-sm hover:bg-indigo-600 disabled:opacity-40';

function ReleaseDetail({ release, onRefresh, onOpenTask }: {
  release: Detail; onRefresh: () => void; onOpenTask: (task: Task) => void;
}) {
  const [version, setVersion] = useState(release.version);
  const [status, setStatus] = useState<z.infer<typeof releaseEditSchema>['status']>(release.status === 'published' ? 'in_progress' : release.status);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [candidates, setCandidates] = useState<Task[] | null>(null);
  const [ticketId, setTicketId] = useState('');
  const operation = useOperation();
  const mutable = !release.targetCommit && !release.publishing && !['published', 'cancelled'].includes(release.status);
  const membershipMutable = (!release.targetCommit || release.status === 'cancelled') && !release.publishing && release.status !== 'published';
  return <section aria-label={`Release ${release.version}`} className="min-w-0 space-y-4 rounded-xl border border-slate-700 bg-slate-900 p-4">
    <h2 className="text-xl font-semibold">v{release.version} · {RELEASE_LABELS[release.status]}</h2>
    <p>{release.deliveredCount}/{release.ticketCount} tickets delivered locally</p>
    <p className="text-xs text-slate-400">A release only creates and pushes its version tag. No branch push, deployment or AI execution.</p>
    {(release.error || operation.error) && <p role="alert" className="whitespace-pre-wrap text-rose-300">{operation.error || release.error}</p>}
    {release.publishing && <p role="status" className="text-amber-200">Tag publication is running. Refresh to see the result.</p>}
    {release.targetCommit && <div className="space-y-1 break-all text-xs">
      <p>Tag: v{release.version} · Commit: {release.targetCommit}</p>
      <p>Branch: {release.targetBranch} · Origin: {release.remoteUrl}</p>
      {release.status === 'cancelled' ? <p className="text-amber-200">Publication cancelled. Any existing local or remote tag is retained; no further push will run.</p>
        : release.publishedAt ? <p className="text-emerald-300">Published {new Date(release.publishedAt).toLocaleString()}</p>
        : <p className="text-amber-200">Publication is pinned to this commit. Tickets and version are frozen; retry reuses this tag.</p>}
    </div>}
    {mutable && <form className="flex flex-wrap items-end gap-3" onSubmit={(event) => {
      event.preventDefault();
      void operation.run(async () => {
        const parsed = releaseEditSchema.parse({ version, status });
        if (status === 'cancelled' && !window.confirm('Cancel this release? Its tickets can be reassigned to another version.')) return;
        await boardApi.updateRelease(release.projectId, release.id, { ...parsed, revision: release.revision });
        onRefresh();
      });
    }}>
      <label className="grid gap-1 text-xs">Version<input className={fieldClass} value={version} onChange={(event) => setVersion(event.target.value)} required maxLength={100} /></label>
      <label className="grid gap-1 text-xs">Release status<select className={fieldClass} value={status} onChange={(event) => {
        const result = releaseEditSchema.shape.status.safeParse(event.target.value);
        if (result.success) setStatus(result.data);
      }}>
        {release.status === 'upcoming' && <option value="upcoming">Upcoming</option>}
        <option value="in_progress">In progress</option><option value="cancelled">Cancelled</option>
      </select></label>
      <button className={buttonClass} disabled={operation.pending}>Save release</button>
    </form>}
    {release.targetCommit && release.error && release.status === 'in_progress' && !release.publishing &&
      <button type="button" disabled={operation.pending} className="rounded bg-rose-900 px-3 py-2 text-sm disabled:opacity-40"
        onClick={() => { void operation.run(async () => {
          if (!window.confirm('Cancel this failed publication? Any local or remote tag is kept, even if the remote already accepted it. This release cannot be retried after cancellation; its tickets can be reassigned.')) return;
          await boardApi.updateRelease(release.projectId, release.id, { version: release.version, status: 'cancelled', revision: release.revision });
          onRefresh();
        }); }}>Cancel failed publication (keep tags)</button>}
    <div className="space-y-2">
      <h3 className="font-semibold">Tickets</h3>
      {!release.tickets.length && <p className="text-sm text-slate-400">No tickets assigned.</p>}
      {release.tickets.map((ticket) => <div key={ticket.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-700 p-3 text-sm">
        <div className="min-w-0">
          <button type="button" className="break-words text-left text-indigo-300 underline" onClick={() => { void operation.run(async () => {
            const board = await boardApi.load(release.projectId);
            const task = board.tasks.find((item) => item.id === ticket.id);
            if (!task) throw new Error('Ticket no longer exists. Refresh the release.');
            onOpenTask(task);
          }); }}>{ticket.title}</button>
          <p className={ticket.delivered ? 'text-emerald-300' : 'text-amber-200'}>{ticket.status} · {ticket.delivered ? `Delivered ${ticket.mergeHash?.slice(0, 7)}` : 'Not delivered locally'}</p>
        </div>
        {membershipMutable && <button type="button" disabled={operation.pending} className="text-xs text-slate-400 underline"
          onClick={() => { void operation.run(async () => {
            await boardApi.assignRelease(release.projectId, ticket.id, null, ticket.revision); onRefresh();
          }); }}>Remove from release</button>}
      </div>)}
      {mutable && <>
        <button type="button" className={buttonClass} disabled={operation.pending} onClick={() => { void operation.run(async () => {
          setCandidates((await boardApi.load(release.projectId)).tasks.filter((task) => task.projectId === release.projectId && task.releaseId !== release.id));
        }); }}>Assign a ticket</button>
        {candidates && <div className="flex flex-wrap gap-2">
          <select aria-label="Ticket to assign" className={`${fieldClass} max-w-full`} value={ticketId} onChange={(event) => setTicketId(event.target.value)}>
            <option value="">Select a ticket</option>{candidates.map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}
          </select>
          <button type="button" className={buttonClass} disabled={operation.pending || !ticketId} onClick={() => { void operation.run(async () => {
            const task = candidates.find((item) => item.id === ticketId);
            if (!task) throw new Error('Select a ticket first');
            await boardApi.assignRelease(release.projectId, task.id, release.id, task.revision ?? 0); onRefresh();
          }); }}>Attach to v{release.version}</button>
        </div>}
      </>}
    </div>
    {release.status === 'in_progress' && !release.publishing && <div className="space-y-3 border-t border-slate-700 pt-4">
      {release.deliveredCount !== release.ticketCount && <p className="text-amber-200">Publication blocked: all attached tickets must be delivered locally. Moving a ticket to Done manually is not enough.</p>}
      <button type="button" disabled={operation.pending || release.deliveredCount !== release.ticketCount} className={buttonClass}
        onClick={() => { void operation.run(async () => { setPreview(null); setPreview(await boardApi.releasePreview(release.projectId, release.id)); }); }}>
        {release.targetCommit ? 'Prepare publication retry' : 'Prepare tag publication'}
      </button>
      {preview && <div className="space-y-3 rounded border border-amber-500/30 p-3 text-sm">
        <p className="break-all">Push <strong>{preview.tag}</strong> at <code>{preview.commit}</code> from {preview.branch} to {preview.remoteUrl}</p>
        <p>{preview.alreadyTagged ? 'The existing local tag will be reused.' : 'A local tag will be created.'} Only this tag will be pushed.</p>
        <button type="button" disabled={operation.pending} className="rounded bg-emerald-700 px-3 py-2 disabled:opacity-40" onClick={() => { void operation.run(async () => {
          if (!window.confirm(`Create and push tag ${preview.tag} to ${preview.remoteUrl}? No branch will be pushed.`)) return;
          try { await boardApi.publishRelease(release.projectId, release.id, preview); }
          finally { setPreview(null); onRefresh(); }
        }); }}>Create tag & push release</button>
      </div>}
    </div>}
  </section>;
}

export default function ReleasesView({ projectId, projects, onOpenTask, refreshKey, focusReleaseId }: {
  projectId: string; projects: Project[]; onOpenTask: (task: Task) => void; refreshKey: number; focusReleaseId?: string;
}) {
  const allProjects = projectId === ALL_PROJECTS;
  const [creationProjectId, setCreationProjectId] = useState(allProjects ? '' : projectId);
  const [releases, setReleases] = useState<Release[]>([]);
  const [selected, setSelected] = useState('');
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState('');
  const [detailError, setDetailError] = useState('');
  const [filter, setFilter] = useState('all');
  const [version, setVersion] = useState('');
  const [attempt, setAttempt] = useState(0);
  const operation = useOperation();
  const selectedProjectId = releases.find((release) => release.id === selected)?.projectId;
  const refresh = () => setAttempt((n) => n + 1);
  useEffect(() => {
    if (focusReleaseId && releases.some((release) => release.id === focusReleaseId)) setSelected(focusReleaseId);
  }, [focusReleaseId, releases]);
  useEffect(() => {
    const controller = new AbortController();
    void boardApi.releases(projectId, controller.signal).then((rows) => {
      if (!controller.signal.aborted) { setReleases(rows); setError(''); }
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Unable to load releases');
    });
    return () => controller.abort();
  }, [projectId, attempt, refreshKey]);
  useEffect(() => {
    setDetail(null); setDetailError('');
    if (!selected || !selectedProjectId) return;
    const controller = new AbortController();
    void boardApi.release(selectedProjectId, selected, controller.signal).then((row) => {
      if (!controller.signal.aborted) setDetail(row);
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) setDetailError(cause instanceof Error ? cause.message : 'Unable to load release');
    });
    return () => controller.abort();
  }, [selectedProjectId, selected, attempt, refreshKey]);
  return <section aria-label="Project releases" className="mx-auto max-w-7xl space-y-5 text-slate-200">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h1 className="text-2xl font-bold">Releases</h1><p className="text-sm text-slate-400">Project versions, ticket scope and Git tag publication.</p></div>
      <button type="button" className={buttonClass} onClick={refresh}>Refresh releases</button>
    </div>
    {(error || operation.error) && <p role="alert" className="text-rose-300">{error || operation.error}</p>}
    <form className="flex flex-wrap items-end gap-3" onSubmit={(event) => {
      event.preventDefault();
      void operation.run(async () => {
        const result = versionSchema.safeParse(version);
        if (!result.success) throw new Error(result.error.issues[0].message);
        if (!projects.some((project) => project.id === creationProjectId)) throw new Error('Choose a project for this release.');
        await boardApi.createRelease(creationProjectId, { version: result.data, status: 'upcoming' });
        refresh();
        setVersion('');
      });
    }}>
      {allProjects && <label className="grid gap-1 text-xs">Project for new release
        <select value={creationProjectId} onChange={(event) => setCreationProjectId(event.target.value)} required className={`${fieldClass} max-w-full`}>
          <option value="">Choose a project</option>
          {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
        </select>
      </label>}
      <label className="grid gap-1 text-xs">New version<input value={version} onChange={(event) => setVersion(event.target.value)} placeholder="1.2.0 or 1.2.0-rc.1" maxLength={100} required className={fieldClass} /></label>
      <button className={buttonClass} disabled={operation.pending || !creationProjectId}>Create version</button>
      <label className="grid gap-1 text-xs">Filter releases<select value={filter} onChange={(event) => setFilter(event.target.value)} className={fieldClass}>
        <option value="all">All statuses</option>{Object.entries(RELEASE_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select></label>
    </form>
    <div className="grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
      <div className="space-y-2">
        {!error && !releases.length && <p className="text-sm text-slate-400">No releases yet. Create your first version.</p>}
        {releases.filter((release) => filter === 'all' || release.status === filter).map((release) =>
          <button key={release.id} type="button" aria-pressed={selected === release.id} onClick={() => setSelected(release.id)}
            className={`w-full rounded-lg border p-3 text-left ${selected === release.id ? 'border-indigo-500 bg-indigo-500/10' : 'border-slate-700 bg-slate-900'}`}>
            <strong>v{release.version}</strong><p className="text-sm">{RELEASE_LABELS[release.status]}{release.publishing ? ' · Publishing tag...' : ''}</p>
            {allProjects && <p className="break-words text-xs text-indigo-300">{projects.find((project) => project.id === release.projectId)?.name ?? release.projectId}</p>}
            <p className="text-xs text-slate-400">{release.deliveredCount}/{release.ticketCount} delivered{release.error ? ' · Publication error' : ''}</p>
          </button>)}
      </div>
      {detailError ? <p role="alert" className="text-rose-300">{detailError}</p> : detail
        ? <div className="min-w-0 space-y-2">
          {allProjects && <p className="text-sm text-indigo-300">{projects.find((project) => project.id === detail.projectId)?.name ?? detail.projectId}</p>}
          <ReleaseDetail key={`${detail.id}-${detail.revision}`} release={detail} onRefresh={refresh} onOpenTask={onOpenTask} />
        </div>
        : <p className="text-sm text-slate-400">{selected ? 'Loading release...' : 'Select a release to manage its tickets and publication.'}</p>}
    </div>
  </section>;
}
