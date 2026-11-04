import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, BookOpen, CheckCircle2, CloudUpload, Columns2, Eye, ChevronDown, ChevronRight, FilePlus2, FileText, Folder, FolderPlus, GitCommitHorizontal,
  Loader2, Pencil, Save, Search, Sparkles,
} from 'lucide-react';
import type { Project } from '../../shared/types/kanban';
import type { DocFile, DocStatus, DocSyncResult } from '../../shared/types/wiki';
import { wikiApi } from '../data/wikiApi';
import { MarkdownPreview } from './MarkdownPreview';
import { AgentAssistant } from './AgentAssistant';

type Mode = 'edit' | 'split' | 'preview';
interface OpenDocument { path: string; content: string; sha: string | null }

const errorMessage = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback;

export function WikiView({ project }: { project: Project }) {
  const [docsPath, setDocsPath] = useState(project.docsPath ?? 'doc');
  const [branch, setBranch] = useState<string | null>(project.repositoryBranch ?? null);
  const [files, setFiles] = useState<DocFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState('');
  const [filter, setFilter] = useState('');
  const [current, setCurrent] = useState<OpenDocument | null>(null);
  const [draft, setDraft] = useState('');
  const [mode, setMode] = useState<Mode>('preview');
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [opening, setOpening] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [result, setResult] = useState<DocSyncResult | null>(null);
  const [status, setStatus] = useState<DocStatus>({ pending: [], ahead: null });
  const [syncing, setSyncing] = useState(false);
  const [newPath, setNewPath] = useState('');
  const [newFolder, setNewFolder] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const dirty = current !== null && draft !== current.content;

  const loadFiles = useCallback(async (signal?: AbortSignal) => {
    try {
      const [listing, nextStatus] = await Promise.all([wikiApi.wikiFiles(project.id, signal), wikiApi.wikiStatus(project.id, signal)]);
      setStatus(nextStatus);
      setFiles(listing.files); setDocsPath(listing.docsPath); setBranch(listing.branch); setListError('');
    } catch (requestError) {
      if (!signal?.aborted) setListError(errorMessage(requestError, 'Unable to load the documentation'));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [project.id]);

  useEffect(() => {
    const controller = new AbortController();
    void loadFiles(controller.signal);
    return () => controller.abort();
  }, [loadFiles]);

  useEffect(() => {
    setAssistantOpen(false);
  }, [project.id, current?.path]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const confirmDiscard = () => !dirty || window.confirm('Discard your unsaved changes?');

  const open = async (path: string) => {
    if (path === current?.path || !confirmDiscard()) return;
    setOpening(true); setError(''); setConflict(false); setResult(null);
    try {
      const doc = await wikiApi.wikiFile(project.id, path);
      setCurrent(doc); setDraft(doc.content);
    } catch (requestError) {
      setError(errorMessage(requestError, 'Unable to open this document'));
    } finally { setOpening(false); }
  };

  const reloadCurrent = async () => {
    if (!current) return;
    setOpening(true); setError(''); setConflict(false);
    try {
      const doc = await wikiApi.wikiFile(project.id, current.path);
      setCurrent(doc); setDraft(doc.content);
    } catch (requestError) {
      setError(errorMessage(requestError, 'Unable to reload this document'));
    } finally { setOpening(false); }
  };

  const createDocument = (event: React.FormEvent) => {
    event.preventDefault();
    let path = newPath.trim().replace(/^\/+/, '');
    if (!path || !confirmDiscard()) return;
    if (!/\.(md|markdown|mdx)$/i.test(path)) path += '.md';
    if (files.some((file) => file.path === path)) { void open(path); setNewPath(''); return; }
    setCurrent({ path, content: '', sha: null }); setDraft(`# ${path.split('/').pop()?.replace(/\.[^.]+$/, '') ?? 'Untitled'}\n\n`);
    setError(''); setConflict(false); setResult(null); setNewPath('');
  };

  // Git does not track empty folders, so a new folder starts with a README page.
  const createFolder = (event: React.FormEvent) => {
    event.preventDefault();
    const folder = newFolder.trim().replace(/^\/+|\/+$/g, '');
    if (!folder || !confirmDiscard()) return;
    const path = `${folder}/README.md`;
    setNewFolder('');
    if (files.some((file) => file.path === path)) { void open(path); return; }
    setCurrent({ path, content: '', sha: null }); setDraft(`# ${folder.split('/').pop()}\n\n`);
    setError(''); setConflict(false); setResult(null);
  };

  const toggleFolder = (folder: string) => setCollapsed((previous) => {
    const next = new Set(previous);
    if (!next.delete(folder)) next.add(folder);
    return next;
  });

  const save = async () => {
    if (!current || saving || !dirty) return;
    setSaving(true); setError(''); setConflict(false);
    try {
      const saved = await wikiApi.saveWikiFile(project.id, current.path, draft, current.sha);
      setCurrent({ path: current.path, content: draft, sha: saved.sha });
      setResult(null);
      await loadFiles();
    } catch (requestError) {
      setError(errorMessage(requestError, 'Unable to save this document'));
      setConflict(requestError instanceof Error && 'status' in requestError && (requestError as { status: number }).status === 409);
    } finally { setSaving(false); }
  };

  const sync = async () => {
    if (syncing || saving) return;
    setSyncing(true); setError(''); setConflict(false);
    try {
      setResult(await wikiApi.syncWiki(project.id));
      await loadFiles();
    } catch (requestError) {
      setError(errorMessage(requestError, 'Unable to sync the documentation'));
    } finally { setSyncing(false); }
  };

  const pendingPaths = useMemo(() => new Map(status.pending.map((change) => [change.path, change.status])), [status]);
  const unpushed = status.ahead ?? 0;
  const needsSync = status.pending.length > 0 || unpushed > 0;
  const visible = useMemo(() => {
    const term = filter.trim().toLowerCase();
    return term ? files.filter((file) => file.path.toLowerCase().includes(term)) : files;
  }, [files, filter]);
  const rows = useMemo(() => {
    const searching = filter.trim() !== '';
    const sorted = [...visible].sort((a, b) => a.path.localeCompare(b.path));
    const result: Array<{ type: 'folder'; path: string; depth: number } | { type: 'file'; file: DocFile; depth: number }> = [];
    const shown = new Set<string>();
    for (const file of sorted) {
      const parts = file.path.split('/');
      let hidden = false;
      for (let depth = 0; depth < parts.length - 1; depth++) {
        const folder = parts.slice(0, depth + 1).join('/');
        if (!shown.has(folder)) { shown.add(folder); if (!hidden) result.push({ type: 'folder', path: folder, depth }); }
        if (!searching && collapsed.has(folder)) hidden = true;
      }
      if (!hidden) result.push({ type: 'file', file, depth: parts.length - 1 });
    }
    return result;
  }, [visible, collapsed, filter]);
  const isNew = current !== null && current.sha === null;
  const modes: Array<[Mode, string, typeof Pencil]> = [['edit', 'Edit', Pencil], ['split', 'Split', Columns2], ['preview', 'Preview', Eye]];

  return (
    <section className="w-full min-w-0 space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-slate-800 bg-gradient-to-br from-emerald-500/10 via-slate-900 to-slate-900 p-5">
        <div className="flex items-center gap-3">
          <span className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-2.5 text-emerald-200"><BookOpen className="h-5 w-5" /></span>
          <div>
            <h1 className="text-xl font-semibold text-white">Wiki</h1>
            <p className="text-xs text-slate-400">
              <code className="rounded bg-slate-800 px-1 py-0.5 text-slate-200">{docsPath}/</code> in {project.name}
              {branch && <> · branch <code className="rounded bg-slate-800 px-1 py-0.5 text-slate-200">{branch}</code></>}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <p role="status" className={`flex items-center gap-1.5 text-xs ${needsSync ? 'text-amber-200' : 'text-emerald-300'}`}>
            {needsSync ? <AlertTriangle className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
            {!needsSync ? 'Everything is synced'
              : [status.pending.length ? `${status.pending.length} saved ${status.pending.length === 1 ? 'change' : 'changes'} to commit` : '', unpushed ? `${unpushed} ${unpushed === 1 ? 'commit' : 'commits'} to push` : ''].filter(Boolean).join(' · ')}
          </p>
          <button type="button" onClick={() => void sync()} disabled={!needsSync || syncing || saving || dirty}
            title={dirty ? 'Save your edit first' : 'Commit saved documents on the project branch and push to origin'}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3.5 py-1.5 text-xs font-semibold disabled:opacity-40 ${needsSync ? 'border-amber-400/40 bg-amber-400/15 text-amber-100 hover:bg-amber-400/25' : 'border-slate-700 text-slate-400'}`}>
            {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CloudUpload className="h-3.5 w-3.5" />}
            {syncing ? 'Syncing…' : 'Sync'}
            {needsSync && !syncing && <span className="rounded-full bg-amber-400/25 px-1.5 text-[10px]">{status.pending.length + unpushed}</span>}
          </button>
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900/60 p-3">
          <label className="relative block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
            <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Filter documents…" aria-label="Filter documents"
              className="w-full rounded-lg border border-slate-700 bg-slate-950/80 py-2 pl-9 pr-3 text-xs text-slate-100 placeholder:text-slate-500 outline-none focus:border-emerald-400/60" />
          </label>
          <form onSubmit={createDocument} className="flex gap-2">
            <input value={newPath} onChange={(event) => setNewPath(event.target.value)} placeholder="guides/new-page.md" aria-label="New document path"
              className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950/80 px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 outline-none focus:border-emerald-400/60" />
            <button type="submit" disabled={!newPath.trim()} aria-label="Create document"
              className="rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-2.5 text-emerald-200 hover:bg-emerald-400/20 disabled:opacity-40"><FilePlus2 className="h-4 w-4" /></button>
          </form>
          <form onSubmit={createFolder} className="flex gap-2">
            <input value={newFolder} onChange={(event) => setNewFolder(event.target.value)} placeholder="new-folder or guides/new-folder" aria-label="New folder path"
              className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950/80 px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 outline-none focus:border-emerald-400/60" />
            <button type="submit" disabled={!newFolder.trim()} aria-label="Create folder" title="Create folder (starts with a README.md)"
              className="rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-2.5 text-emerald-200 hover:bg-emerald-400/20 disabled:opacity-40"><FolderPlus className="h-4 w-4" /></button>
          </form>
          {loading && <p role="status" className="px-1 text-xs text-slate-400">Loading documents…</p>}
          {listError && <p role="alert" className="px-1 text-xs text-rose-300">{listError}</p>}
          {!loading && !listError && visible.length === 0 && (
            <p className="px-1 py-4 text-center text-xs text-slate-500">
              {files.length ? 'No document matches.' : `No Markdown file in ${docsPath}/ yet. Create the first page above.`}
            </p>
          )}
          <ul className="max-h-[60vh] space-y-0.5 overflow-y-auto">
            {rows.map((row) => {
              const indent = { paddingLeft: `${row.depth * 12 + 8}px` };
              if (row.type === 'folder') {
                const closed = !filter.trim() && collapsed.has(row.path);
                return <li key={`dir:${row.path}`} className="flex items-center">
                  <button type="button" onClick={() => toggleFolder(row.path)} aria-expanded={!closed} style={indent}
                    className="flex min-w-0 flex-1 items-center gap-1.5 rounded-lg py-1.5 pr-2 text-left text-xs font-medium text-slate-300 hover:bg-slate-800/70">
                    {closed ? <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-500" /> : <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-500" />}
                    <Folder className="h-3.5 w-3.5 shrink-0 text-emerald-300/70" />
                    <span className="truncate">{row.path.slice(row.path.lastIndexOf('/') + 1)}</span>
                  </button>
                  <button type="button" onClick={() => setNewPath(`${row.path}/`)} aria-label={`New page in ${row.path}`} title="New page in this folder"
                    className="rounded p-1 text-slate-500 hover:bg-slate-800 hover:text-emerald-200"><FilePlus2 className="h-3.5 w-3.5" /></button>
                </li>;
              }
              const { file } = row;
              const active = file.path === current?.path;
              return <li key={file.path}>
                <button type="button" onClick={() => void open(file.path)} aria-current={active ? 'true' : undefined} style={indent}
                  className={`flex w-full items-center gap-2 rounded-lg py-1.5 pr-2 text-left text-xs transition ${active ? 'bg-emerald-400/10 text-emerald-100 ring-1 ring-emerald-400/30' : 'text-slate-300 hover:bg-slate-800/70'}`}>
                  <FileText className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                  <span className="min-w-0 flex-1 truncate font-medium">{file.path.slice(file.path.lastIndexOf('/') + 1)}</span>
                  {pendingPaths.has(file.path) && <span title="Saved, not synced yet" aria-label="Waiting for sync" className="h-2 w-2 shrink-0 rounded-full bg-amber-300" />}
                </button>
              </li>;
            })}
          </ul>
        </aside>

        <div className="min-w-0 rounded-2xl border border-slate-800 bg-slate-900/60">
          {!current && !opening && (
            <div className="flex min-h-80 flex-col items-center justify-center gap-2 p-8 text-center">
              <BookOpen className="h-8 w-8 text-slate-600" />
              <p className="text-sm font-medium text-slate-200">Select or create a document</p>
              <p className="max-w-sm text-xs text-slate-500">Save writes the file in the project clone. Sync then commits saved documents on the project branch and pushes them to origin.</p>
            </div>
          )}
          {opening && <p role="status" className="flex items-center gap-2 p-6 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" /> Opening document…</p>}
          {current && !opening && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 p-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-100">{current.path}</p>
                  <p className="text-[11px] text-slate-500">{isNew ? 'New document (not saved yet)' : dirty ? 'Unsaved changes' : pendingPaths.has(current.path) ? 'Saved, waiting for sync' : 'Synced'}</p>
                </div>
                <div className="flex items-center gap-2">
                  <div role="group" aria-label="Editor layout" className="inline-flex rounded-lg border border-slate-700 bg-slate-950/60 p-0.5 text-xs">
                    {modes.map(([value, label, Icon]) => (
                      <button key={value} type="button" aria-pressed={mode === value} onClick={() => setMode(value)}
                        className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 ${mode === value ? 'bg-emerald-400/15 text-emerald-100' : 'text-slate-400 hover:text-slate-200'}`}>
                        <Icon className="h-3 w-3" />{label}
                      </button>
                    ))}
                  </div>
                  <button type="button" onClick={() => void save()} disabled={!dirty || saving}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-1.5 text-xs font-semibold text-white shadow-md shadow-emerald-600/20 hover:bg-emerald-500 disabled:opacity-40">
                    {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                    {saving ? 'Saving…' : 'Save'}
                  </button>
                  <button type="button" onClick={() => setAssistantOpen((open) => !open)}
                    aria-expanded={assistantOpen} aria-controls="wiki-ai-assistant"
                    className={`inline-flex items-center gap-1.5 rounded-lg border px-3.5 py-1.5 text-xs font-semibold ${assistantOpen ? 'border-indigo-400/40 bg-indigo-400/15 text-indigo-100' : 'border-slate-700 text-indigo-200 hover:bg-indigo-400/10'}`}>
                    <Sparkles className="h-3.5 w-3.5" />AI assistant
                  </button>
                </div>
              </div>

              {error && <div role="alert" className="m-3 flex flex-wrap items-start gap-2 rounded-xl border border-rose-400/20 bg-rose-400/10 p-3 text-xs text-rose-200">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span className="min-w-0 flex-1">{error}</span>
                {conflict && <button type="button" onClick={() => void reloadCurrent()} className="rounded-lg border border-rose-300/30 px-2 py-1 hover:bg-rose-400/10">Reload from repository (discard my edit)</button>}
              </div>}
              {result && !error && (
                <div role="status" className={`m-3 flex items-start gap-2 rounded-xl border p-3 text-xs ${result.pushed ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-100' : 'border-amber-400/20 bg-amber-400/10 text-amber-100'}`}>
                  {result.pushed ? <CloudUpload className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
                  <span>
                    {result.commit ? <>Committed <code>{result.commit.slice(0, 7)}</code> on <code>{result.branch}</code></> : 'Nothing new to commit'}
                    {result.pushed ? ' and pushed to origin.' : `. Not pushed: ${result.pushError ?? 'nothing to push'}. Commits are kept locally; sync again to retry.`}
                  </span>
                </div>
              )}

              <div id="wiki-ai-assistant" hidden={!assistantOpen} className="p-3">
                <AgentAssistant key={`${project.id}:${current.path}`} content={draft} disabled={saving || syncing}
                  onGenerate={(input, signal) => wikiApi.assistWiki(project.id, { ...input, path: current.path, content: draft }, signal)}
                  onApply={(content) => { setDraft(content); setMode('split'); setError(''); setResult(null); }} />
              </div>

              <div className={`grid min-h-[50vh] ${mode === 'split' ? 'xl:grid-cols-2 xl:divide-x xl:divide-slate-800' : ''}`}>
                {mode !== 'preview' && (
                  <textarea value={draft} onChange={(event) => setDraft(event.target.value)} spellCheck
                    onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); void save(); } }}
                    aria-label={`Markdown source of ${current.path}`}
                    className="min-h-[50vh] w-full resize-y bg-transparent p-4 font-mono text-xs leading-6 text-slate-100 outline-none placeholder:text-slate-600" />
                )}
                {mode !== 'edit' && <div className="min-w-0 overflow-y-auto p-5" aria-label="Preview"><MarkdownPreview source={draft} /></div>}
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

export default WikiView;
