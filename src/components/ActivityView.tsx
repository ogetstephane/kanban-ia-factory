import React, { useEffect, useState } from 'react';
import {
  Activity, CheckCircle, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, CircleDot,
  Clock3, Eye, Inbox, ListTodo, PlayCircle, Rows3, Search, Box, X,
} from 'lucide-react';
import type { Project } from '../types/kanban';
import type { ActivityEvent, ActivityQuery } from '../types/activity';
import { boardApi } from '../data/boardApi';
import { ALL_PROJECTS } from '../utils/projectLogic';

const entityTypes: Array<{ value: NonNullable<ActivityQuery['entityType']> | ''; label: string }> = [
  { value: '', label: 'All activity' },
  { value: 'project', label: 'Projects' },
  { value: 'feature', label: 'Features' },
  { value: 'task', label: 'Tickets' },
  { value: 'release', label: 'Releases' },
];

const dateTime = (value: string) => new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium', timeStyle: 'short',
}).format(new Date(value));

const STATUS_PRESENTATION: Record<string, {
  label: string;
  icon: React.ElementType;
  badge: string;
  iconColor: string;
  glowColor: string;
}> = {
  Backlog: { label: 'Backlog', icon: Inbox, badge: 'border-slate-500/30 bg-slate-500/10 text-slate-300', iconColor: 'text-slate-300', glowColor: 'rgb(100 116 139 / 0.35)' },
  'To Do': { label: 'To Do', icon: ListTodo, badge: 'border-sky-500/30 bg-sky-500/10 text-sky-300', iconColor: 'text-sky-300', glowColor: 'rgb(14 165 233 / 0.35)' },
  'In Progress': { label: 'In Progress', icon: PlayCircle, badge: 'border-amber-500/30 bg-amber-500/10 text-amber-300', iconColor: 'text-amber-300', glowColor: 'rgb(245 158 11 / 0.35)' },
  Review: { label: 'Review', icon: Eye, badge: 'border-purple-500/30 bg-purple-500/10 text-purple-300', iconColor: 'text-purple-300', glowColor: 'rgb(168 85 247 / 0.35)' },
  Done: { label: 'Done', icon: CheckCircle, badge: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300', iconColor: 'text-emerald-300', glowColor: 'rgb(16 185 129 / 0.35)' },
  upcoming: { label: 'Upcoming', icon: Inbox, badge: 'border-slate-500/30 bg-slate-500/10 text-slate-300', iconColor: 'text-slate-300', glowColor: 'rgb(100 116 139 / 0.35)' },
  in_progress: { label: 'In progress', icon: PlayCircle, badge: 'border-amber-500/30 bg-amber-500/10 text-amber-300', iconColor: 'text-amber-300', glowColor: 'rgb(245 158 11 / 0.35)' },
  published: { label: 'Published', icon: CheckCircle, badge: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300', iconColor: 'text-emerald-300', glowColor: 'rgb(16 185 129 / 0.35)' },
  cancelled: { label: 'Cancelled', icon: CircleDot, badge: 'border-slate-500/30 bg-slate-500/10 text-slate-400', iconColor: 'text-slate-400', glowColor: 'rgb(100 116 139 / 0.25)' },
};

function StatusBadge({ value }: { value: string | null }) {
  if (value === null) return <span className="text-slate-500">—</span>;
  const status = STATUS_PRESENTATION[value];
  if (!status) return <span className="text-slate-100">{value}</span>;
  const Icon = status.icon;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${status.badge}`}
    >
      <Icon className={`h-3 w-3 ${status.iconColor}`} />
      {status.label}
    </span>
  );
}

const DEFAULT_GLOW = 'rgb(99 102 241 / 0.35)';

function eventGlow(event: ActivityEvent) {
  const after = event.changes.find((change) => change.field === 'Status')?.after;
  return (after ? STATUS_PRESENTATION[after]?.glowColor : undefined) ?? DEFAULT_GLOW;
}

function ActivityRow({ event }: { event: ActivityEvent }) {
  const statusChange = event.changes.find((change) => change.field === 'Status');
  const statusPresentation = statusChange?.after ? STATUS_PRESENTATION[statusChange.after] : undefined;
  const EventIcon = statusPresentation?.icon ?? Activity;
  return (
    <article
      style={{ '--activity-glow': statusPresentation?.glowColor ?? 'rgb(99 102 241 / 0.35)' } as React.CSSProperties}
      className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 transition-[box-shadow,background-color,border-color] duration-200 hover:border-slate-700 hover:bg-slate-900 hover:shadow-[0_0_24px_var(--activity-glow)] sm:p-5"
    >
      <div className="flex items-start gap-3">
        <span className={`mt-0.5 rounded-xl border p-2 ${
          statusPresentation
            ? statusPresentation.badge
            : 'border-indigo-400/20 bg-indigo-400/10 text-indigo-200'
        }`}>
          <EventIcon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="truncate text-sm font-semibold text-slate-100">{event.entityTitle}</h3>
            <span className="rounded-full border border-slate-700 bg-slate-800 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-300">
              {event.entityType}
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-300">{event.summary}</p>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
            <span className="inline-flex items-center gap-1.5"><Clock3 className="h-3.5 w-3.5" />{dateTime(event.createdAt)}</span>
            <span>{event.actor}</span>
            {event.projectName !== 'Unassigned' && <span>{event.projectName}</span>}
          </div>
          {event.changes.length > 0 && (
            <dl className="mt-4 grid gap-2 border-t border-slate-800 pt-3 sm:grid-cols-2">
              {event.changes.map((change, index) => (
                <div key={`${change.field}-${index}`} className="min-w-0 rounded-xl bg-slate-950/60 px-3 py-2">
                  <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{change.field}</dt>
                  <dd className="mt-1 break-words text-xs text-slate-300">
                    {change.field === 'Status'
                      ? <StatusBadge value={change.before} />
                      : <span className="text-slate-500">{change.before ?? '—'}</span>}
                    <span className="mx-2 text-slate-600">→</span>
                    {change.field === 'Status'
                      ? <StatusBadge value={change.after} />
                      : <span className="text-slate-100">{change.after ?? '—'}</span>}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      </div>
    </article>
  );
}

export function ActivityView({ scopeId, projects }: { scopeId: string; projects: Project[] }) {
  const [entityType, setEntityType] = useState<NonNullable<ActivityQuery['entityType']> | ''>('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<Awaited<ReturnType<typeof boardApi.activityEvents>>>();
  const [layout, setLayout] = useState<'list' | 'timeline'>('list');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [historyEvent, setHistoryEvent] = useState<ActivityEvent | null>(null);
  const [historyPage, setHistoryPage] = useState(1);
  const [history, setHistory] = useState<Awaited<ReturnType<typeof boardApi.activityHistory>>>();
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const historyKey = historyEvent ? `${historyEvent.entityType}:${historyEvent.entityId}` : '';
  const activeProject = projects.find((project) => project.id === scopeId);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    void boardApi.activityEvents({
      projectId: scopeId && scopeId !== ALL_PROJECTS ? scopeId : undefined,
      entityType: entityType || undefined,
      search,
      page,
    }, controller.signal).then(setResult).catch((requestError: unknown) => {
      if (!controller.signal.aborted) setError(requestError instanceof Error ? requestError.message : 'Unable to load activity');
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [scopeId, entityType, search, page]);

  useEffect(() => {
    if (!historyEvent) return;
    const controller = new AbortController();
    setHistoryLoading(true);
    setHistoryError('');
    void boardApi.activityHistory(historyEvent.entityType, historyEvent.entityId, historyPage, controller.signal)
      .then((response) => setHistory((previous) => previous
        ? { ...response, items: [...previous.items, ...response.items] }
        : response)).catch((requestError: unknown) => {
        if (!controller.signal.aborted) setHistoryError(requestError instanceof Error ? requestError.message : 'Unable to load entity history');
      }).finally(() => {
        if (!controller.signal.aborted) setHistoryLoading(false);
      });
    return () => controller.abort();
  }, [historyKey, historyPage]);

  const toggleHistory = (event: ActivityEvent) => {
    if (historyKey === `${event.entityType}:${event.entityId}`) {
      setHistoryEvent(null);
      setHistory(undefined);
      return;
    }
    setHistoryEvent(event);
    setHistoryPage(1);
    setHistory(undefined);
  };

  const renderEvent = (event: ActivityEvent) => {
              const isOpen = historyKey === `${event.entityType}:${event.entityId}`;
              return <div key={event.id} className="space-y-2">
                <ActivityRow event={event} />
                <button type="button" onClick={() => toggleHistory(event)}
                  aria-expanded={isOpen}
                  className="ml-12 inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-indigo-300 transition hover:bg-indigo-400/10 hover:text-indigo-200">
                  {isOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                  {isOpen ? 'Hide entity history' : 'View entity history'}
                </button>
                {isOpen && <div className="ml-4 space-y-3 border-l border-indigo-400/20 pl-4 sm:ml-12">
                  {historyError && <p role="alert" className="text-sm text-rose-300">{historyError}</p>}
                  {historyLoading && <p role="status" className="text-sm text-slate-400">Loading entity history…</p>}
                  {!historyLoading && history?.items.map((historyItem) => <ActivityRow key={historyItem.id} event={historyItem} />)}
                  {history && history.total > historyPage * history.pageSize && <button type="button"
                    onClick={() => setHistoryPage((current) => current + 1)}
                    className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800">
                    Load older history
                  </button>}
                </div>}
              </div>;
  };

  const totalPages = result ? Math.max(1, Math.ceil(result.total / result.pageSize)) : 1;
  return (
    <section className="w-full min-w-0 space-y-6">
      <header className="overflow-hidden rounded-3xl border border-slate-800 bg-gradient-to-br from-indigo-500/10 via-slate-900 to-slate-900 p-5 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-indigo-400/20 bg-indigo-400/10 px-3 py-1 text-xs font-medium text-indigo-200">
              <Activity className="h-3.5 w-3.5" /> Project timeline
            </div>
            <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">Activity</h1>
            <p className="mt-2 text-sm leading-6 text-slate-400">
              A chronological record of changes to tickets, features, releases, and projects.
            </p>
          </div>
          <div className="rounded-2xl border border-slate-700/80 bg-slate-950/60 px-4 py-3 text-right">
            <p className="text-[11px] uppercase tracking-wider text-slate-500">Scope</p>
            <p className="mt-1 max-w-48 truncate text-sm font-medium text-slate-200">
              {scopeId === ALL_PROJECTS ? 'All projects' : activeProject?.name ?? 'Selected project'}
            </p>
          </div>
        </div>
        <div className="mt-6 grid gap-3 sm:grid-cols-[minmax(0,1fr)_200px]">
          <label className="relative block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }}
              placeholder="Search events, tickets, projects..."
              className="w-full rounded-xl border border-slate-700 bg-slate-950/80 py-2.5 pl-10 pr-10 text-sm text-slate-100 placeholder:text-slate-500 outline-none transition focus:border-indigo-400/70 focus:ring-2 focus:ring-indigo-500/20"
              aria-label="Search activity" />
            {search && <button type="button" onClick={() => { setSearch(''); setPage(1); }}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
              aria-label="Clear activity search"><X className="h-4 w-4" /></button>}
          </label>
          <select value={entityType} onChange={(event) => {
            setEntityType(event.target.value as typeof entityType); setPage(1);
          }} aria-label="Filter activity by entity"
            className="rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2.5 text-sm text-slate-200 outline-none focus:border-indigo-400/70">
            {entityTypes.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </div>
      </header>

      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <p className="text-sm text-slate-400">
          {loading ? 'Loading activity…' : `${result?.total ?? 0} ${result?.total === 1 ? 'event' : 'events'}`}
        </p>
        <div role="group" aria-label="Activity layout" className="inline-flex rounded-xl border border-slate-700 bg-slate-900/70 p-0.5 text-xs">
          {([['list', 'List', Rows3], ['timeline', '3D timeline', Box]] as const).map(([value, label, Icon]) => (
            <button key={value} type="button" aria-pressed={layout === value} onClick={() => setLayout(value)}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-medium transition ${layout === value ? 'bg-indigo-500/20 text-indigo-100' : 'text-slate-400 hover:text-slate-200'}`}>
              <Icon className="h-3.5 w-3.5" />{label}
            </button>
          ))}
        </div>
        <p className="w-full text-xs text-slate-500">Actor labels are categories (User, Copilot, System), not authenticated identities.</p>
      </div>

      {error && <div role="alert" className="rounded-xl border border-rose-400/20 bg-rose-400/10 p-4 text-sm text-rose-200">{error}</div>}
      {!error && loading && <p role="status" className="rounded-2xl border border-slate-800 bg-slate-900/50 p-8 text-center text-sm text-slate-400">Loading the project timeline…</p>}
      {!error && !loading && result?.items.length === 0 && (
        <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-900/40 px-6 py-12 text-center">
          <Activity className="mx-auto h-8 w-8 text-slate-600" />
          <h2 className="mt-3 text-sm font-semibold text-slate-200">No activity found</h2>
          <p className="mt-1 text-sm text-slate-500">{search || entityType ? 'Try another search or entity filter.' : 'Changes will appear here as work is recorded.'}</p>
        </div>
      )}
      {!error && !loading && result && result.items.length > 0 && (
        <>
          <div className={layout === 'timeline'
            ? 'relative space-y-6 py-2 [perspective:1400px] before:absolute before:bottom-0 before:left-[15px] before:top-0 before:w-px before:bg-gradient-to-b before:from-indigo-400/60 before:via-slate-700 before:to-transparent md:before:left-1/2'
            : 'space-y-3'}>
            {result.items.map((event, index) => layout === 'timeline'
              ? <div key={event.id} style={{
                '--tl-transform': `rotateY(${index % 2 === 0 ? 9 : -9}deg) translateZ(${-Math.min(index, 12) * 8}px)`,
                '--tl-glow': eventGlow(event),
              } as React.CSSProperties}
                className={`relative pl-10 md:w-1/2 md:pl-0 ${index % 2 === 0 ? 'md:pr-10' : 'md:ml-auto md:pl-10'}`}>
                <span aria-hidden className={`absolute top-6 h-3 w-3 rounded-full border-2 border-slate-950 bg-[var(--tl-glow)] shadow-[0_0_14px_var(--tl-glow)] left-[10px] ${index % 2 === 0 ? 'md:left-auto md:-right-1.5' : 'md:-left-1.5'}`} />
                <div className="origin-center transition-transform duration-300 ease-out [transform:var(--tl-transform)] hover:[transform:rotateY(0deg)_translateZ(36px)] motion-reduce:transform-none">
                  {renderEvent(event)}
                </div>
              </div>
              : renderEvent(event))}
          </div>
          <nav aria-label="Activity pages" className="flex items-center justify-between rounded-2xl border border-slate-800 bg-slate-900/60 p-3">
            <button type="button" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}
              className="inline-flex items-center gap-1 rounded-lg px-3 py-2 text-sm text-slate-300 transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40">
              <ChevronLeft className="h-4 w-4" /> Previous
            </button>
            <span className="text-xs text-slate-500">Page {page} of {totalPages}</span>
            <button type="button" disabled={page >= totalPages} onClick={() => setPage((current) => current + 1)}
              className="inline-flex items-center gap-1 rounded-lg px-3 py-2 text-sm text-slate-300 transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40">
              Next <ChevronRight className="h-4 w-4" />
            </button>
          </nav>
        </>
      )}
    </section>
  );
}
