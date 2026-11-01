import { useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle, ArrowRight, CheckCircle2, Clock3, GitBranch, Layers3, MessageCircleQuestion, PackageCheck, ShieldCheck, Sparkles } from 'lucide-react';
import type { z } from 'zod';
import { boardApi } from '../data/boardApi';
import { useOperation } from '../data/useOperation';
import type { Project } from '../types/kanban';
import { agentListSchema, type AgentListQuery, type SessionActionFocus } from '../types/agent';
import type { Release } from '../types/release';

type SessionList = z.infer<typeof agentListSchema>;
type SessionRow = SessionList['items'][number];
const dateLabel = (value: string) => new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value));
const sessionStatusLabel = (status: string) => ({
  queued: 'Plan queued', planning: 'Preparing a plan', awaiting_input: 'Waiting for your answer',
  awaiting_approval: 'Plan ready for approval', execution_queued: 'Execution queued',
  executing: 'Executing plan', completed: 'Work complete', failed: 'Session failed',
  cancelling: 'Stopping session', cancelled: 'Session cancelled', delivering: 'Local delivery in progress',
}[status] ?? status);

function actionFor(session: SessionRow) {
  if (session.status === 'awaiting_input') return { title: 'Answer a question', callToAction: 'Answer question', focus: 'answer' as const, icon: MessageCircleQuestion, color: 'text-cyan-300', edge: 'border-cyan-400/40', tint: 'bg-cyan-400/10' };
  if (session.status === 'awaiting_approval') return { title: 'Approve the plan', callToAction: 'Review plan', focus: 'approve' as const, icon: ShieldCheck, color: 'text-amber-300', edge: 'border-amber-400/40', tint: 'bg-amber-400/10' };
  if (session.status === 'failed') return { title: 'Session needs attention', callToAction: 'Inspect session', focus: 'retry' as const, icon: AlertTriangle, color: 'text-rose-300', edge: 'border-rose-400/40', tint: 'bg-rose-400/10' };
  if (session.reviewStatus === 'pending') return { title: 'Review completed work', callToAction: 'Review changes', focus: 'review' as const, icon: CheckCircle2, color: 'text-violet-300', edge: 'border-violet-400/40', tint: 'bg-violet-400/10' };
  return { title: 'Ready for local delivery', callToAction: 'Continue delivery', focus: 'deliver' as const, icon: PackageCheck, color: 'text-emerald-300', edge: 'border-emerald-400/40', tint: 'bg-emerald-400/10' };
}

export default function CockpitView({ scopeId, projects, onOpenTicket, onOpenRelease }: {
  scopeId: string;
  projects: Project[];
  onOpenTicket: (projectId: string, taskId: string, action: SessionActionFocus) => void;
  onOpenRelease: (release: Release) => void;
}) {
  const [sessions, setSessions] = useState<SessionList | null>(null);
  const [releases, setReleases] = useState<Release[]>([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const operation = useOperation();
  const scopedProjects = useMemo(() => scopeId === 'All'
    ? projects
    : projects.filter((project) => project.id === scopeId), [projects, scopeId]);
  const projectFilter = scopeId === 'All' ? undefined : scopeId;
  const query: AgentListQuery = { actionable: 'cockpit', projectId: projectFilter, page };

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    setLoading(true);
    const load = async () => {
      try {
        const [actionList, releaseList] = await Promise.all([
          boardApi.agentSessions(query, controller.signal),
          boardApi.releases(scopeId, controller.signal),
        ]);
        if (!controller.signal.aborted) {
          setSessions(actionList);
          setReleases(releaseList);
          setError('');
        }
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Unable to load cockpit data');
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
          timer = setTimeout(() => setRefresh((value) => value + 1), 15000);
        }
      }
    };
    void load();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [scopeId, page, refresh]);

  const blockedReleases = releases.filter((release) => release.status === 'in_progress' &&
    (release.deliveredCount < release.ticketCount || !!release.error));
  const actionCount = sessions?.actionCount ?? 0;
  const selectedProjectName = scopeId === 'All' ? 'All projects' : scopedProjects[0]?.name ?? 'Project';
  return <section aria-label="Project cockpit" className="mx-auto max-w-7xl space-y-7 pb-10 text-slate-100">
    <header className="relative isolate overflow-hidden rounded-3xl border border-indigo-400/20 bg-gradient-to-br from-indigo-950 via-slate-900 to-slate-950 p-6 shadow-2xl shadow-indigo-950/30 sm:p-9">
      <div className="pointer-events-none absolute -right-20 -top-32 -z-10 h-80 w-80 rounded-full bg-indigo-500/20 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-36 left-1/3 -z-10 h-72 w-72 rounded-full bg-cyan-500/10 blur-3xl" />
      <div className="flex flex-wrap items-start justify-between gap-5">
        <div className="max-w-2xl">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-indigo-300/20 bg-indigo-300/10 px-3 py-1 text-xs font-medium text-indigo-200">
            <Sparkles className="h-3.5 w-3.5" /> Command center <span className="text-indigo-300/50">/</span> {selectedProjectName}
          </div>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Your work, <span className="bg-gradient-to-r from-indigo-300 to-cyan-200 bg-clip-text text-transparent">in focus.</span></h1>
          <p className="mt-3 max-w-xl text-sm leading-6 text-slate-300">A calm overview of the decisions, reviews and releases that need you next.</p>
        </div>
      </div>
      <div className="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={Activity} label="Open actions" value={String(actionCount)} accent="text-indigo-300" />
        <Stat icon={Layers3} label="Active projects" value={String(scopedProjects.length)} accent="text-cyan-300" />
        <Stat icon={Clock3} label="In progress" value={String(scopedProjects.reduce((sum, project) => sum + (project.stats?.inProgressTasks ?? 0), 0))} accent="text-amber-300" />
        <Stat icon={PackageCheck} label="Release blockers" value={String(blockedReleases.length)} accent="text-rose-300" />
      </div>
    </header>

    {error && <p role="alert" className="rounded-xl border border-rose-400/20 bg-rose-400/5 p-4 text-rose-200">{error}</p>}
    {operation.error && <p role="alert" className="rounded-xl border border-rose-400/20 bg-rose-400/5 p-4 text-rose-200">{operation.error}</p>}
    <div className="grid gap-7 xl:grid-cols-[minmax(0,1.45fr)_minmax(300px,.8fr)]">
      <section aria-label="Next actions" className="min-w-0 space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div><p className="text-xs font-semibold uppercase tracking-[.18em] text-indigo-300">Your attention</p>
            <h2 className="mt-1 text-xl font-semibold">Next actions</h2></div>
          <p className="text-xs text-slate-400">{loading ? 'Syncing…' : `${actionCount} waiting across your projects`}</p>
        </div>
        {loading && !sessions && <div role="status" className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6 text-sm text-slate-400">Gathering your next actions…</div>}
        {!loading && sessions?.items.length === 0 && <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-900/40 p-8 text-center">
          <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-300" />
          <h3 className="mt-3 font-medium">You’re all caught up</h3>
          <p className="mt-1 text-sm text-slate-400">No questions, approvals or reviews need your attention.</p>
        </div>}
        <div className="space-y-3">
          {sessions?.items.map((session) => {
            const action = actionFor(session);
            const Icon = action.icon;
            return <article key={session.id} className={`group rounded-2xl border ${action.edge} bg-slate-900/80 p-4 transition duration-200 hover:-translate-y-0.5 hover:bg-slate-900 hover:shadow-xl hover:shadow-indigo-950/20 sm:p-5`}>
              <div className="flex items-start gap-4">
                <div className={`mt-0.5 rounded-xl ${action.tint} p-3 ${action.color}`}><Icon className="h-5 w-5" /></div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`text-xs font-semibold ${action.color}`}>{action.title}</span>
                    <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[11px] text-slate-300">{session.priority}</span>
                  </div>
                  <h3 className="mt-1.5 break-words font-medium text-slate-100">{session.taskTitle}</h3>
                  <p className="mt-1 text-xs text-slate-400">{session.projectName ?? 'No project'} <span className="text-slate-600">/</span> {session.featureTitle ?? 'No feature'} <span className="text-slate-600">/</span> {sessionStatusLabel(session.status)}</p>
                  {session.status === 'failed' && session.error && <p className="mt-2 line-clamp-2 text-xs text-rose-300">{session.error}</p>}
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                    <span className="text-[11px] text-slate-500">Updated {dateLabel(session.updatedAt)}</span>
                    <button type="button" disabled={operation.pending || !session.projectId}
                      onClick={() => void operation.run(async () => onOpenTicket(session.projectId!, session.taskId, action.focus))}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-white/5 px-3 py-2 text-xs font-medium text-slate-200 transition group-hover:bg-indigo-500/15 group-hover:text-indigo-200 disabled:opacity-40">
                      {action.callToAction} <ArrowRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            </article>;
          })}
        </div>
        {sessions && sessions.total > sessions.pageSize && <nav aria-label="Cockpit action pages" className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-3 text-sm">
          <button type="button" disabled={page <= 1} className="text-slate-300 disabled:opacity-40" onClick={() => setPage((value) => value - 1)}>Previous</button>
          <span className="text-xs text-slate-400">Page {page} of {Math.ceil(sessions.total / sessions.pageSize)}</span>
          <button type="button" disabled={page * sessions.pageSize >= sessions.total} className="text-slate-300 disabled:opacity-40" onClick={() => setPage((value) => value + 1)}>Next</button>
        </nav>}
      </section>

      <aside className="space-y-7">
        <section aria-label="Releases to watch" className="space-y-4">
          <div className="flex items-end justify-between gap-3">
            <div><p className="text-xs font-semibold uppercase tracking-[.18em] text-amber-300">Ship with confidence</p><h2 className="mt-1 text-xl font-semibold">Release watch</h2></div>
            <span className="text-xs text-slate-400">{blockedReleases.length} need attention</span>
          </div>
          {!loading && releases.filter((release) => release.status === 'in_progress').length === 0 &&
            <p className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 text-sm text-slate-400">No releases in progress.</p>}
          {releases.filter((release) => release.status === 'in_progress').slice(0, 5).map((release) => {
            const project = projects.find((item) => item.id === release.projectId);
            const progress = release.ticketCount ? Math.round(release.deliveredCount / release.ticketCount * 100) : 100;
            const blocked = release.deliveredCount < release.ticketCount || !!release.error;
            return <article key={release.id} className="rounded-2xl border border-slate-800 bg-slate-900/75 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0"><p className="truncate text-xs text-slate-400">{project?.name ?? release.projectId}</p>
                  <h3 className="mt-1 font-semibold">v{release.version}</h3></div>
                <span className={`rounded-full px-2.5 py-1 text-[11px] ${blocked ? 'bg-amber-300/10 text-amber-200' : 'bg-emerald-300/10 text-emerald-200'}`}>
                  {release.error ? 'Publication failed' : blocked ? 'Blocked' : 'Ready'}
                </span>
              </div>
              <div className="mt-4 flex items-center justify-between text-xs text-slate-400"><span>Tickets delivered</span><span>{release.deliveredCount}/{release.ticketCount}</span></div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-800"><div className={`h-full rounded-full ${blocked ? 'bg-amber-400' : 'bg-emerald-400'}`} style={{ width: `${progress}%` }} /></div>
              {release.error && <p className="mt-3 line-clamp-2 text-xs text-rose-300">{release.error}</p>}
              <button type="button" onClick={() => onOpenRelease(release)} className="mt-4 inline-flex items-center gap-1.5 text-xs font-medium text-indigo-300 hover:text-indigo-200">
                Review release <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </article>;
          })}
        </section>

        <section aria-label="Project progress" className="space-y-4">
          <div><p className="text-xs font-semibold uppercase tracking-[.18em] text-cyan-300">The bigger picture</p><h2 className="mt-1 text-xl font-semibold">Project pulse</h2></div>
          {!scopedProjects.length && <p className="rounded-2xl border border-slate-800 p-4 text-sm text-slate-400">No projects in this scope.</p>}
          {scopedProjects.map((project) => {
            const stats = project.stats ?? { totalTasks: 0, completedTasks: 0, inProgressTasks: 0, completionRate: 0, totalFeatures: 0 };
            return <article key={project.id} className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-800 text-lg">{project.icon || '💼'}</span>
                <div className="min-w-0 flex-1"><h3 className="truncate text-sm font-medium">{project.name}</h3>
                  <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-slate-400">
                    {project.repositoryUrl ? <><GitBranch className="h-3 w-3 text-emerald-300" />{project.repositoryBranch ?? 'Git repository'}</> : 'No Git repository'}
                  </p></div>
                <span className="text-sm font-semibold text-cyan-200">{stats.completionRate}%</span>
              </div>
              <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-slate-800"><div className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-cyan-300" style={{ width: `${stats.completionRate}%` }} /></div>
              <div className="mt-2 flex justify-between text-[11px] text-slate-500"><span>{stats.completedTasks}/{stats.totalTasks} tickets done</span><span>{stats.totalFeatures} features</span></div>
            </article>;
          })}
        </section>
      </aside>
    </div>
  </section>;
}

function Stat({ icon: Icon, label, value, accent }: {
  icon: typeof Activity; label: string; value: string; accent: string;
}) {
  return <div className="rounded-2xl border border-white/[.08] bg-slate-950/35 p-4 backdrop-blur-sm">
    <div className="flex items-center justify-between gap-3"><span className="text-xs text-slate-400">{label}</span><Icon className={`h-4 w-4 ${accent}`} /></div>
    <p className={`mt-2 text-2xl font-semibold tracking-tight ${accent}`}>{value}</p>
  </div>;
}
