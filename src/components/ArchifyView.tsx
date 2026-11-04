import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, ExternalLink, Loader2, RefreshCw, Workflow } from 'lucide-react';
import { archifyViewUrl, type ArchifyDiagram } from '../../shared/types/archify';
import { graphApi } from '../data/graphApi';

const errorMessage = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback;

export function ArchifyView() {
  const [diagrams, setDiagrams] = useState<ArchifyDiagram[] | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError('');
    try {
      const next = await graphApi.archifyDiagrams(signal);
      setDiagrams(next);
      setSelectedId((current) => next.some((diagram) => diagram.id === current) ? current
        : (next.find((diagram) => diagram.generatedAt) ?? next[0])?.id ?? '');
    } catch (requestError) {
      if (!signal?.aborted) setError(errorMessage(requestError, 'Unable to load the Archify diagrams'));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const selected = diagrams?.find((diagram) => diagram.id === selectedId);
  const viewUrl = selected?.generatedAt ? archifyViewUrl(selected) : '';

  return (
    <section className="w-full min-w-0 space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-slate-800 bg-gradient-to-br from-violet-500/10 via-slate-900 to-slate-900 p-5">
        <div className="flex items-center gap-3">
          <span className="rounded-2xl border border-violet-400/20 bg-violet-400/10 p-2.5 text-violet-200"><Workflow className="h-5 w-5" /></span>
          <div>
            <h1 className="text-xl font-semibold text-white">Diagrams</h1>
            <p className="text-xs text-slate-400">
              Archify diagrams of this application&apos;s repository, shared across project selections.
              {' '}Regenerate committed code with <code className="rounded bg-slate-800 px-1 py-0.5 text-slate-200">make archify</code>.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {viewUrl && <a href={viewUrl} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:text-white">
            <ExternalLink className="h-3.5 w-3.5" />Full screen
          </a>}
          <button type="button" onClick={() => void load()} disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-violet-400/30 bg-violet-400/10 px-3 py-1.5 text-xs font-semibold text-violet-100 hover:bg-violet-400/20 disabled:opacity-40">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />Refresh
          </button>
        </div>
      </header>

      {error && <p role="alert" className="flex items-start gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{error}
      </p>}

      {loading && !diagrams ? (
        <p role="status" className="flex items-center gap-2 rounded-2xl border border-slate-800 bg-slate-900/60 p-6 text-sm text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" />Loading Archify diagrams…
        </p>
      ) : diagrams && diagrams.length === 0 ? (
        <p className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 text-sm text-slate-400">
          No diagram yet. Add an Archify source such as <code className="text-slate-200">doc/archify/my-flow.json</code>, then run <code className="text-slate-200">make archify</code>.
        </p>
      ) : diagrams ? (
        <div className="grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
          <nav aria-label="Archify diagrams" className="space-y-1 rounded-2xl border border-slate-800 bg-slate-900/60 p-2">
            {diagrams.map((diagram) => (
              <button key={diagram.id} type="button" onClick={() => setSelectedId(diagram.id)} aria-current={diagram.id === selectedId}
                className={`w-full rounded-xl px-3 py-2 text-left ${diagram.id === selectedId ? 'bg-violet-500/20 text-violet-50' : 'text-slate-300 hover:bg-slate-800'}`}>
                <span className="block truncate text-sm font-medium">{diagram.title}</span>
                <span className="block text-[11px] text-slate-500">
                  {diagram.origin === 'analysis' ? 'automatic analysis · ' : ''}{diagram.type}
                  {diagram.revision && <> · commit {diagram.revision.slice(0, 7)}</>}
                  {' '}· {diagram.generatedAt ? new Date(diagram.generatedAt).toLocaleString() : 'not generated'}
                </span>
              </button>
            ))}
          </nav>
          {viewUrl && selected ? (
            // Generated HTML: opaque-origin sandbox, scripts and export downloads only, no access to this app.
            <iframe key={viewUrl} src={viewUrl} title={selected.title} sandbox="allow-scripts allow-downloads" referrerPolicy="no-referrer"
              className="h-[calc(100vh-14rem)] min-h-[480px] w-full rounded-2xl border border-slate-800 bg-slate-950" />
          ) : selected ? (
            <p className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-6 text-sm text-amber-100">
              “{selected.title}” has not been generated yet. Run <code>make archify NAME={selected.id}</code>, then refresh.
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

export default ArchifyView;
