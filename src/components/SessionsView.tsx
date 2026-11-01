import { lazy, Suspense, useEffect, useState } from 'react';
import type { z } from 'zod';
import { agentListSchema, agentListQuerySchema, agentStatusSchema, type AgentListQuery } from '../types/agent';
import { boardApi } from '../data/boardApi';
import TaskAgentSession, { SESSION_LABELS } from './TaskAgentSession';
import { ALL_PROJECTS } from '../utils/projectLogic';
import WorkflowTimeline from './WorkflowTimeline';
const ProjectHealth = lazy(() => import('./ProjectHealth'));

const fieldClass = 'min-w-0 rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 outline-none focus:border-indigo-400';

function statusColor(status: string) {
  if (status === 'awaiting_input' || status === 'awaiting_approval') return 'bg-amber-400';
  if (status === 'failed') return 'bg-rose-400';
  if (status === 'completed') return 'bg-emerald-400';
  return 'bg-indigo-400';
}

export default function SessionsView({ initialProjectId }: { initialProjectId: string }) {
  const [filters, setFilters] = useState<AgentListQuery>({ projectId: initialProjectId === ALL_PROJECTS ? undefined : initialProjectId, page: 1 });
  const [data, setData] = useState<z.infer<typeof agentListSchema> | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [showHealth, setShowHealth] = useState(false);
  const update = (patch: Partial<AgentListQuery>) => {
    setFilters((previous) => ({ ...previous, ...patch, page: 1 }));
    setSelected(null);
  };
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    setLoading(true);
    const load = async () => {
      try {
        const result = await boardApi.agentSessions(filters, controller.signal);
        if (!controller.signal.aborted) { setData(result); setError(''); }
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Unable to load sessions');
      } finally {
        if (!controller.signal.aborted) { setLoading(false); timer = setTimeout(() => { void load(); }, 2000); }
      }
    };
    timer = setTimeout(() => { void load(); }, 250);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [filters]);

  const selectedRow = data?.items.find((item) => item.taskId === selected) ?? data?.items[0];
  return (
    <section className="w-full min-w-0 space-y-4 text-slate-100" aria-label="Agent sessions">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-slate-800 pb-4">
        <div>
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-indigo-300">Workspace</p>
          <h1 className="text-xl font-semibold">Sessions</h1>
          <p className="mt-1 text-sm text-slate-400">Review agent conversations, runs, and code changes.</p>
        </div>
        <nav aria-label="Session views" className="flex gap-1 rounded-lg border border-slate-800 bg-slate-900 p-1 text-sm">
          <button type="button" aria-pressed={!filters.actionable && !showHealth}
            className={`rounded-md px-3 py-2 ${!filters.actionable && !showHealth ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white'}`}
            onClick={() => { setShowHealth(false); update({ actionable: undefined, status: undefined }); }}>All sessions</button>
          <button type="button" aria-pressed={!!filters.actionable && !showHealth}
            className={`rounded-md px-3 py-2 ${filters.actionable && !showHealth ? 'bg-amber-500/15 text-amber-200' : 'text-slate-400 hover:text-white'}`}
            onClick={() => { setShowHealth(false); update({ actionable: 'true', status: undefined }); }}>Action inbox <span className="ml-1 text-xs">({data?.actionCount ?? 0})</span></button>
          <button type="button" aria-pressed={showHealth}
            className={`rounded-md px-3 py-2 ${showHealth ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white'}`}
            onClick={() => setShowHealth((value) => !value)}>Project health</button>
        </nav>
      </header>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <select aria-label="Sessions project" className={fieldClass} value={filters.projectId ?? ''}
          onChange={(event) => update({ projectId: event.target.value || undefined, featureId: undefined })}>
          <option value="">All projects</option>
          {data?.projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
        </select>
        <select aria-label="Sessions feature or epic" className={fieldClass} value={filters.featureId ?? ''}
          onChange={(event) => update({ featureId: event.target.value || undefined })}>
          <option value="">All features / epics</option>
          {data?.features.filter((feature) => !filters.projectId || !feature.projectId || feature.projectId === filters.projectId)
            .map((feature) => <option key={feature.id} value={feature.id}>{feature.title}</option>)}
        </select>
        <select aria-label="Sessions status" className={fieldClass} value={filters.status ?? ''}
          onChange={(event) => update({ status: event.target.value ? agentStatusSchema.parse(event.target.value) : undefined })}>
          <option value="">All session states</option>
          {agentStatusSchema.options.map((status) => <option key={status} value={status}>{SESSION_LABELS[status]}</option>)}
        </select>
        <select aria-label="Sessions priority" className={fieldClass} value={filters.priority ?? ''}
          onChange={(event) => update({ priority: agentListQuerySchema.shape.priority.parse(event.target.value || undefined) })}>
          <option value="">All priorities</option>
          {['Critical', 'High', 'Medium', 'Low'].map((priority) => <option key={priority}>{priority}</option>)}
        </select>
        <input aria-label="Search sessions" placeholder="Search sessions…" value={filters.search ?? ''}
          onChange={(event) => update({ search: event.target.value })} maxLength={200} className={fieldClass} />
      </div>

      {error && <p role="alert" className="rounded-md border border-rose-900/70 bg-rose-950/30 p-3 text-sm text-rose-300">{error}</p>}
      {showHealth && (filters.projectId
        ? <Suspense fallback={<p>Loading diagnostics…</p>}><ProjectHealth key={filters.projectId} projectId={filters.projectId} /></Suspense>
        : <p className="rounded-md border border-amber-900/70 bg-amber-950/20 p-3 text-sm text-amber-300">Select a project to run its diagnostics.</p>)}
      <p className="sr-only" role="status">{loading ? 'Loading sessions…' : `${data?.total ?? 0} session(s) · refreshes automatically`}</p>

      {!showHealth && <div className="grid min-w-0 gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <aside aria-label="Session list" className="min-w-0 overflow-hidden rounded-lg border border-slate-800 bg-slate-900/70">
          <div className="flex items-center justify-between border-b border-slate-800 px-3 py-3">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-300">Recent sessions</h2>
            <span className="text-xs tabular-nums text-slate-500">{data?.total ?? 0}</span>
          </div>
          <div className="max-h-[calc(100vh-390px)] min-h-40 space-y-1 overflow-y-auto p-2">
            {!loading && data?.items.length === 0 && <p className="px-2 py-4 text-xs leading-5 text-slate-500">No sessions match these filters. Move a ticket to In Progress to start one.</p>}
            {data?.items.map((item) => {
              const isSelected = selectedRow?.taskId === item.taskId;
              return <button key={item.id} type="button" onClick={() => setSelected(item.taskId)}
                aria-current={isSelected ? 'true' : undefined}
                className={`w-full rounded-md border-l-2 px-3 py-3 text-left transition-colors ${isSelected ? 'border-indigo-400 bg-indigo-500/10' : 'border-transparent hover:bg-slate-800/80'}`}>
                <span className="flex items-center gap-2">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${statusColor(item.status)}`} />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-200">{item.taskTitle}</span>
                </span>
                <span className="mt-1.5 block truncate pl-4 text-xs text-slate-400">{item.projectName ?? 'No project'}{item.featureTitle ? ` · ${item.featureTitle}` : ''}</span>
                <span className="mt-1 block pl-4 text-[11px] text-slate-500">{SESSION_LABELS[item.status]} · {new Date(item.updatedAt).toLocaleDateString()}</span>
                {item.workflow && <div className="mt-3"><WorkflowTimeline workflow={item.workflow} compact label={`Agent workflow for ${item.taskTitle}`} /></div>}
              </button>;
            })}
          </div>
          {data && data.total > data.pageSize && <div className="flex items-center justify-between border-t border-slate-800 px-3 py-2 text-xs text-slate-400">
            <button type="button" disabled={data.page <= 1} className="disabled:opacity-40"
              onClick={() => { setFilters((value) => ({ ...value, page: data.page - 1 })); setSelected(null); }}>Previous</button>
            <span>{data.page} / {Math.ceil(data.total / data.pageSize)}</span>
            <button type="button" disabled={data.page * data.pageSize >= data.total} className="disabled:opacity-40"
              onClick={() => { setFilters((value) => ({ ...value, page: data.page + 1 })); setSelected(null); }}>Next</button>
          </div>}
        </aside>

        <main className="min-w-0">
          {selectedRow ? <>
            <header className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-900/70 px-4 py-3">
              <div className="min-w-0">
                <p className="mb-1 text-[11px] text-slate-500">{selectedRow.projectName ?? 'No project'}{selectedRow.featureTitle ? ` / ${selectedRow.featureTitle}` : ''}</p>
                <h2 className="truncate font-semibold text-slate-100">{selectedRow.taskTitle}</h2>
              </div>
              <span className="inline-flex items-center gap-2 rounded-full border border-slate-700 bg-slate-950/70 px-2.5 py-1 text-xs text-slate-300">
                <span className={`h-2 w-2 rounded-full ${statusColor(selectedRow.status)}`} />
                {SESSION_LABELS[selectedRow.status]}
              </span>
            </header>
            <TaskAgentSession key={selectedRow.taskId} taskId={selectedRow.taskId} workspaceLayout />
          </> : <div className="flex min-h-64 items-center justify-center rounded-lg border border-dashed border-slate-800 p-8 text-center">
            <div>
              <h2 className="font-medium text-slate-300">{loading ? 'Loading sessions…' : 'No session selected'}</h2>
              <p className="mt-2 text-sm text-slate-500">Start an agent run by moving a ticket to In Progress.</p>
            </div>
          </div>}
        </main>
      </div>}
    </section>
  );
}
