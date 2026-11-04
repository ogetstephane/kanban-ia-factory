import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, ExternalLink, FileText, Loader2, Network, RefreshCw } from 'lucide-react';
import type { Project } from '../../shared/types/kanban';
import { codeGraphViewUrl, type CodeGraphSnapshot } from '../../shared/types/codeGraph';
import { graphApi } from '../data/graphApi';
import { MarkdownPreview } from './MarkdownPreview';

type Tab = 'visualization' | 'report';

const errorMessage = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback;

export function CodeGraphView({ project }: { project: Project }) {
  const [graph, setGraph] = useState<CodeGraphSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [rebuilding, setRebuilding] = useState(false);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<Tab>('visualization');

  const load = useCallback(async (rebuild: boolean, signal?: AbortSignal) => {
    if (rebuild) setRebuilding(true); else setLoading(true);
    setError('');
    try {
      const next = await (rebuild ? graphApi.rebuildCodeGraph(project.id, signal) : graphApi.codeGraph(project.id, signal));
      setGraph(next);
      if (!next.visualization) setTab('report');
    } catch (requestError) {
      if (!signal?.aborted) setError(errorMessage(requestError, 'Unable to build the code graph'));
    } finally {
      if (!signal?.aborted) { setLoading(false); setRebuilding(false); }
    }
  }, [project.id]);

  useEffect(() => {
    const controller = new AbortController();
    void load(false, controller.signal);
    return () => controller.abort();
  }, [load]);

  const viewUrl = graph ? codeGraphViewUrl(project.id, graph.generatedAt) : '';
  const busy = loading || rebuilding;

  return (
    <section className="w-full min-w-0 space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-slate-800 bg-gradient-to-br from-cyan-500/10 via-slate-900 to-slate-900 p-5">
        <div className="flex items-center gap-3">
          <span className="rounded-2xl border border-cyan-400/20 bg-cyan-400/10 p-2.5 text-cyan-200"><Network className="h-5 w-5" /></span>
          <div>
            <h1 className="text-xl font-semibold text-white">Code graph</h1>
            <p className="text-xs text-slate-400">
              Graphify knowledge graph of {project.name}
              {graph && <> · built {new Date(graph.generatedAt).toLocaleString()}</>}
              {graph?.commit && <> · commit <code className="rounded bg-slate-800 px-1 py-0.5 text-slate-200">{graph.commit.slice(0, 7)}</code></>}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div role="tablist" aria-label="Code graph display" className="flex rounded-lg border border-slate-700 p-0.5 text-xs">
            {([['visualization', 'Visualization', Network], ['report', 'Report', FileText]] as const).map(([value, label, Icon]) => (
              <button key={value} type="button" role="tab" aria-selected={tab === value} onClick={() => setTab(value)}
                disabled={value === 'visualization' && graph !== null && !graph.visualization}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1 font-medium disabled:opacity-40 ${tab === value ? 'bg-cyan-500/20 text-cyan-100' : 'text-slate-400 hover:text-slate-200'}`}>
                <Icon className="h-3.5 w-3.5" />{label}
              </button>
            ))}
          </div>
          {graph?.visualization && <a href={viewUrl} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:text-white">
            <ExternalLink className="h-3.5 w-3.5" />Full screen
          </a>}
          <button type="button" onClick={() => void load(true)} disabled={busy}
            title="Re-extract the code of the project's checked-out branch"
            className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-400/30 bg-cyan-400/10 px-3 py-1.5 text-xs font-semibold text-cyan-100 hover:bg-cyan-400/20 disabled:opacity-40">
            <RefreshCw className={`h-3.5 w-3.5 ${rebuilding ? 'animate-spin' : ''}`} />{rebuilding ? 'Rebuilding…' : 'Rebuild'}
          </button>
        </div>
      </header>

      {error && <p role="alert" className="flex items-start gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{error}
      </p>}

      {loading && !graph ? (
        <p role="status" className="flex items-center gap-2 rounded-2xl border border-slate-800 bg-slate-900/60 p-6 text-sm text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" />Mapping the project code with Graphify…
        </p>
      ) : graph && tab === 'visualization' && graph.visualization ? (
        // Generated from repository content: opaque-origin sandbox, scripts only, no access to this app.
        <iframe key={viewUrl} src={viewUrl} title={`Code graph of ${project.name}`} sandbox="allow-scripts" referrerPolicy="no-referrer"
          className="h-[calc(100vh-14rem)] min-h-[480px] w-full rounded-2xl border border-slate-800 bg-slate-950" />
      ) : graph ? (
        <article className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
          {!graph.visualization && <p className="mb-4 text-xs text-amber-200">The interactive visualization is not available for this graph (it may be too large); the report is shown instead.</p>}
          <MarkdownPreview source={graph.report} />
        </article>
      ) : null}
    </section>
  );
}

export default CodeGraphView;
