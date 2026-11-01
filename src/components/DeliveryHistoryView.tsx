import { useEffect, useState } from 'react';
import { ArrowDownToLine, ArrowRight, CheckCircle2, Clock3, GitBranch, Search, XCircle } from 'lucide-react';
import { boardApi } from '../data/boardApi';
import type { Project } from '../types/kanban';
import type { z } from 'zod';
import { deliveryHistorySchema } from '../types/agent';

type DeliveryHistory = z.infer<typeof deliveryHistorySchema>;
type DeliveryStatus = '' | 'committing' | 'committed' | 'merging' | 'delivered' | 'failed';
const statusLabel: Record<Exclude<DeliveryStatus, ''>, string> = {
  committing: 'Commit in progress',
  committed: 'Committed',
  merging: 'Merge in progress',
  delivered: 'Delivered',
  failed: 'Failed',
};
const statusStyle: Record<Exclude<DeliveryStatus, ''>, string> = {
  committing: 'bg-amber-400/10 text-amber-200',
  committed: 'bg-cyan-400/10 text-cyan-200',
  merging: 'bg-amber-400/10 text-amber-200',
  delivered: 'bg-emerald-400/10 text-emerald-200',
  failed: 'bg-rose-400/10 text-rose-200',
};
const timestamp = (value: string) => new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium', timeStyle: 'short',
}).format(new Date(value));

export default function DeliveryHistoryView({ scopeId, projects, onOpenTicket }: {
  scopeId: string;
  projects: Project[];
  onOpenTicket: (projectId: string, taskId: string) => void;
}) {
  const [projectId, setProjectId] = useState(scopeId === 'All' ? '' : scopeId);
  const [status, setStatus] = useState<DeliveryStatus>('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<DeliveryHistory | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setProjectId(scopeId === 'All' ? '' : scopeId);
    setPage(1);
  }, [scopeId]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      void boardApi.deliveryHistory({
        projectId: projectId || undefined, status: status || undefined, search: search.trim(), page,
      }, controller.signal).then((result) => {
        if (!controller.signal.aborted) { setData(result); setError(''); }
      }).catch((cause: unknown) => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Unable to load delivery history');
      }).finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    }, search ? 250 : 0);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [projectId, status, search, page]);

  return <section aria-label="Delivery history" className="mx-auto max-w-7xl space-y-6 pb-10 text-slate-100">
    <header className="overflow-hidden rounded-3xl border border-emerald-400/15 bg-gradient-to-br from-emerald-950/70 via-slate-900 to-slate-950 p-6 sm:p-8">
      <div className="flex items-start gap-4">
        <div className="rounded-2xl bg-emerald-300/10 p-3 text-emerald-200"><ArrowDownToLine className="h-6 w-6" /></div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-[.18em] text-emerald-300">Delivery timeline</p>
          <h1 className="mt-1 text-2xl font-semibold sm:text-3xl">Delivery history</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">A searchable record of local commits and merges, with the ticket, release and project context for each attempt.</p>
        </div>
      </div>
    </header>

    <div className="grid gap-3 rounded-2xl border border-slate-800 bg-slate-900/70 p-4 sm:grid-cols-[minmax(180px,.7fr)_minmax(180px,.7fr)_minmax(220px,1.4fr)]">
      {scopeId === 'All' ? <label className="space-y-1 text-xs font-medium text-slate-300">
        Project
        <select aria-label="Delivery history project" value={projectId} onChange={(event) => { setProjectId(event.target.value); setPage(1); }}
          className="block w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100">
          <option value="">All projects</option>
          {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
        </select>
      </label> : <div className="space-y-1 text-xs font-medium text-slate-400">
        Project
        <p className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-200">{projects.find((project) => project.id === projectId)?.name ?? 'Selected project'}</p>
      </div>}
      <label className="space-y-1 text-xs font-medium text-slate-300">
        Delivery status
        <select aria-label="Delivery history status" value={status} onChange={(event) => { setStatus(event.target.value as DeliveryStatus); setPage(1); }}
          className="block w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100">
          <option value="">All attempts</option>
          <option value="delivered">Delivered</option>
          <option value="committed">Committed, not merged</option>
          <option value="committing">Commit in progress</option>
          <option value="merging">Merge in progress</option>
          <option value="failed">Failed</option>
        </select>
      </label>
      <label className="space-y-1 text-xs font-medium text-slate-300">
        Search
        <span className="relative block">
          <Search aria-hidden="true" className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input aria-label="Search delivery history" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }}
            maxLength={200} placeholder="Ticket, project, feature or version"
            className="w-full rounded-lg border border-slate-700 bg-slate-950 py-2 pl-9 pr-9 text-sm text-slate-100 placeholder:text-slate-500" />
          {search && <button type="button" aria-label="Clear delivery search" onClick={() => { setSearch(''); setPage(1); }}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white"><XCircle className="h-4 w-4" /></button>}
        </span>
      </label>
    </div>

    {error && <p role="alert" className="rounded-xl border border-rose-400/20 bg-rose-400/5 p-4 text-rose-200">{error}</p>}
    <div className="flex items-center justify-between gap-3">
      <h2 className="font-semibold">Recent attempts</h2>
      <p role="status" className="text-xs text-slate-400">{loading ? 'Loading history…' : `${data?.total ?? 0} delivery attempt${data?.total === 1 ? '' : 's'}`}</p>
    </div>
    {!loading && !error && data?.items.length === 0 && <div className="rounded-2xl border border-dashed border-slate-700 p-10 text-center">
      <Clock3 className="mx-auto h-8 w-8 text-slate-500" />
      <h3 className="mt-3 font-medium">No delivery attempts found</h3>
      <p className="mt-1 text-sm text-slate-400">Completed and in-progress local delivery attempts will appear here.</p>
    </div>}
    <div className="space-y-3">
      {data?.items.map((item) => {
        const itemStatus = item.status as Exclude<DeliveryStatus, ''>;
        const Icon = item.status === 'delivered' ? CheckCircle2 : item.status === 'failed' ? XCircle : Clock3;
        return <article key={item.id} className="rounded-2xl border border-slate-800 bg-slate-900/75 p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-3">
              <span className={`mt-0.5 rounded-xl p-2.5 ${statusStyle[itemStatus]}`}><Icon className="h-5 w-5" /></span>
              <div className="min-w-0">
                <p className="text-xs text-slate-400">{item.projectName}{item.featureTitle ? ` / ${item.featureTitle}` : ''}{item.releaseVersion ? ` / v${item.releaseVersion}` : ''}</p>
                <button type="button" onClick={() => onOpenTicket(item.projectId, item.taskId)}
                  className="mt-1 inline-flex max-w-full items-center gap-1.5 text-left font-semibold text-slate-100 hover:text-indigo-200">
                  <span className="break-words">{item.taskTitle}</span><ArrowRight aria-hidden="true" className="h-4 w-4 shrink-0" />
                </button>
                <p className="mt-1 text-xs text-slate-400">Attempt {item.attempt} · <span className="inline-flex items-center gap-1"><GitBranch className="h-3 w-3" />{item.targetBranch}</span></p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 sm:justify-end">
              <span className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${statusStyle[itemStatus]}`}>{statusLabel[itemStatus]}</span>
              <time className="text-xs text-slate-500" dateTime={item.updatedAt}>{timestamp(item.updatedAt)}</time>
            </div>
          </div>
          {(item.commitHash || item.mergeHash) && <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 border-t border-slate-800 pt-3 font-mono text-[11px] text-slate-400">
            {item.commitHash && <span>Commit <code className="text-slate-300">{item.commitHash.slice(0, 10)}</code></span>}
            {item.mergeHash && <span>Merge <code className="text-emerald-200">{item.mergeHash.slice(0, 10)}</code></span>}
          </div>}
          {item.error && <p className="mt-3 whitespace-pre-wrap break-words text-xs text-rose-300">{item.error}</p>}
        </article>;
      })}
    </div>
    {data && data.total > data.pageSize && <nav aria-label="Delivery history pages" className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-3 text-sm">
      <button type="button" disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)}
        className="rounded-lg px-3 py-2 text-slate-300 hover:bg-slate-800 disabled:opacity-40">Previous</button>
      <span className="text-xs text-slate-400">Page {data.page} of {Math.ceil(data.total / data.pageSize)}</span>
      <button type="button" disabled={page * data.pageSize >= data.total || loading} onClick={() => setPage((value) => value + 1)}
        className="rounded-lg px-3 py-2 text-slate-300 hover:bg-slate-800 disabled:opacity-40">Next</button>
    </nav>}
  </section>;
}
