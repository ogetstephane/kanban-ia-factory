import { Fragment, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, Maximize2, Minimize2, WrapText } from 'lucide-react';
import { MAX_DIFF_ROWS, parseDiff, unifiedDiffRows, type DiffLine } from '../utils/diffView';

interface FileOption { path: string; status: string }
interface Props {
  files: FileOption[];
  selected: string;
  onSelect: (path: string) => void;
  baseCommit: string;
  file: { path: string; patch: string; binary: boolean; truncated: boolean } | null;
  error: string;
  allowFullscreen?: boolean;
}

const numberClass = 'w-14 select-none border-r border-slate-800 px-2 py-0.5 text-right align-top text-slate-500 tabular-nums';
const buttonClass = 'inline-flex items-center gap-1.5 rounded-md border border-slate-700 px-2.5 py-1.5 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed';

function LineContent({ line, wrap }: { line: DiffLine | null; wrap: boolean }) {
  return <td className={`align-top px-2 py-0.5 ${wrap ? 'whitespace-pre-wrap [overflow-wrap:anywhere]' : 'whitespace-pre'} ${
    !line ? 'bg-slate-900/80' : line.kind === 'removed' ? 'bg-rose-950/60 text-rose-200' : line.kind === 'added' ? 'bg-emerald-950/60 text-emerald-200' : 'text-slate-300'
  }`}>
    {line && <><span aria-hidden="true" className="mr-2 select-none opacity-60">{line.kind === 'added' ? '+' : line.kind === 'removed' ? '-' : ' '}</span>{line.text || ' '}
      {line.noNewline && <span className="block text-xs italic text-amber-300">No newline at end of file</span>}
    </>}
  </td>;
}

export default function FileDiff({ files, selected, onSelect, baseCommit, file, error, allowFullscreen = true }: Props) {
  const [fullscreen, setFullscreen] = useState(false);
  const [mode, setMode] = useState<'split' | 'unified'>('split');
  const [wrap, setWrap] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const expand = useRef<HTMLButtonElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const scroll = useRef({ top: 0, left: 0 });
  const restoreFocus = useRef(false);
  const displayedFile = file?.path === selected ? file : null;
  const parsed = useMemo(() => parseDiff(displayedFile?.patch ?? ''), [displayedFile?.patch]);
  const rows = useMemo(() => mode === 'split' ? parsed.rows : unifiedDiffRows(parsed.rows), [parsed, mode]);
  const index = files.findIndex((entry) => entry.path === selected);
  const selectedStatus = files[index]?.status;
  const setExpanded = (value: boolean) => {
    if (viewport.current) scroll.current = { top: viewport.current.scrollTop, left: viewport.current.scrollLeft };
    restoreFocus.current = true;
    setFullscreen(value);
  };
  useLayoutEffect(() => {
    if (!fullscreen) return;
    const element = dialog.current!;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    element.showModal();
    return () => {
      element.close();
      document.body.style.overflow = overflow;
    };
  }, [fullscreen]);
  useLayoutEffect(() => {
    if (!fullscreen && restoreFocus.current) { expand.current?.focus(); restoreFocus.current = false; }
    if (viewport.current) {
      viewport.current.scrollTop = scroll.current.top;
      viewport.current.scrollLeft = scroll.current.left;
    }
  }, [fullscreen]);
  useLayoutEffect(() => {
    scroll.current = { top: 0, left: 0 };
    if (viewport.current) { viewport.current.scrollTop = 0; viewport.current.scrollLeft = 0; }
  }, [selected]);

  const comparison = <div className={`flex min-h-0 flex-col overflow-hidden bg-slate-950 text-slate-100 ${fullscreen ? 'h-full' : 'rounded-lg border border-slate-700'}`}>
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-700 bg-slate-900 p-3 text-xs">
      <div className="min-w-0">
        <h3 id={fullscreen ? 'fullscreen-diff-title' : undefined} className="font-semibold">File comparison</h3>
        <p className="mt-1 break-all text-slate-400">{selected || 'No changed files'}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1" role="group" aria-label="Diff layout">
          <button type="button" className={`${buttonClass} ${mode === 'split' ? 'bg-indigo-700' : ''}`} aria-pressed={mode === 'split'} onClick={() => setMode('split')}>Side by side</button>
          <button type="button" className={`${buttonClass} ${mode === 'unified' ? 'bg-indigo-700' : ''}`} aria-pressed={mode === 'unified'} onClick={() => setMode('unified')}>Unified</button>
        </div>
        <button type="button" className={`${buttonClass} ${wrap ? 'bg-slate-700' : ''}`} aria-pressed={wrap} onClick={() => setWrap((value) => !value)}>
          <WrapText className="h-4 w-4" />Wrap lines
        </button>
        {allowFullscreen && <button ref={fullscreen ? undefined : expand} type="button" className={buttonClass} onClick={() => setExpanded(!fullscreen)}>
          {fullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          {fullscreen ? 'Exit full screen' : 'Full screen'}
        </button>}
      </div>
    </div>
    <div className="flex items-center gap-2 border-b border-slate-800 p-2 text-xs">
      <button type="button" aria-label="Previous changed file" className={buttonClass} disabled={index <= 0} onClick={() => onSelect(files[index - 1].path)}><ChevronLeft className="h-4 w-4" /></button>
      <select aria-label="Changed file" value={selected} onChange={(event) => onSelect(event.target.value)} className="min-w-0 flex-1 rounded bg-slate-800 p-2">
        {!files.length && <option value="">No changed files</option>}
        {files.map((entry) => <option key={entry.path} value={entry.path}>{entry.status} · {entry.path}</option>)}
      </select>
      <span className="shrink-0 text-slate-400">{index < 0 ? 0 : index + 1} / {files.length}</span>
      <button type="button" aria-label="Next changed file" className={buttonClass} disabled={index < 0 || index >= files.length - 1} onClick={() => onSelect(files[index + 1].path)}><ChevronRight className="h-4 w-4" /></button>
    </div>
    {error && <p role="alert" className="p-3 text-sm text-rose-300">{error}</p>}
    {displayedFile?.truncated && <p className="border-b border-amber-900 p-2 text-xs text-amber-300">Preview truncated at 128,000 characters. Inspect the complete file locally before accepting.</p>}
    {parsed.truncated && <p className="border-b border-amber-900 p-2 text-xs text-amber-300">Display limited to {MAX_DIFF_ROWS.toLocaleString()} comparison rows. Inspect the complete diff locally.</p>}
    <div className={`flex min-h-0 flex-col sm:flex-row ${fullscreen ? 'flex-1' : ''}`}>
      {files.length > 0 && <nav aria-label="All modified files" className="max-h-40 shrink-0 overflow-auto border-b border-slate-800 bg-slate-900/50 p-2 sm:max-h-[32rem] sm:w-64 sm:border-b-0 sm:border-r">
        <p className="mb-2 text-xs font-semibold text-slate-400">Modified files ({files.length})</p>
        {files.map((entry) => <button key={entry.path} type="button" aria-current={selected === entry.path ? 'true' : undefined}
          onClick={() => onSelect(entry.path)}
          className={`mb-1 block w-full break-all rounded p-2 text-left text-xs ${selected === entry.path ? 'bg-indigo-500/20 text-indigo-200' : 'text-slate-300 hover:bg-slate-800'}`}>
          <span className="mr-2 font-mono text-amber-300">{entry.status}</span>{entry.path}
        </button>)}
      </nav>}
    <div ref={viewport} tabIndex={0} role="region" aria-label="File diff" className={`min-h-0 min-w-0 flex-1 overflow-auto overscroll-contain outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-400 ${fullscreen ? '' : 'max-h-[32rem]'}`}>
      {!files.length ? <p className="p-6 text-sm text-slate-400">No changed files.</p>
        : !displayedFile ? !error && <p role="status" className="p-6 text-sm text-slate-400">Loading file diff…</p>
        : displayedFile.binary ? <p className="p-6 text-sm text-amber-200">Binary file — text comparison is not available. Inspect this file locally.</p>
        : !rows.length ? <div className="p-4 text-sm text-slate-400"><p>No text lines changed (empty file or file metadata change).</p><pre className="mt-3 whitespace-pre-wrap">{parsed.metadata.join('\n')}</pre></div>
        : <table className={`w-full border-separate border-spacing-0 font-mono text-xs leading-5 ${mode === 'split' ? wrap ? 'table-fixed min-w-[32rem]' : 'min-w-[48rem]' : wrap ? 'table-fixed' : 'min-w-[32rem]'}`} aria-label={mode === 'split' ? 'Side-by-side file comparison' : 'Unified file comparison'}>
          <colgroup><col className="w-14" />{mode === 'split' ? <><col /><col className="w-14" /><col /></> : <><col className="w-14" /><col /></>}</colgroup>
          <thead className="sticky top-0 z-10 bg-slate-800 text-left">
            <tr>{mode === 'split' ? <>
              <th colSpan={2} className="border-r border-slate-600 px-3 py-2 font-sans font-medium">Before · Base {baseCommit.slice(0, 7)}{selectedStatus === 'A' || selectedStatus === 'untracked' ? ' · File did not exist' : ''}</th>
              <th colSpan={2} className="px-3 py-2 font-sans font-medium">After · Ticket worktree{selectedStatus === 'D' ? ' · File deleted' : ''}</th>
            </> : <th colSpan={3} className="px-3 py-2 font-sans font-medium">Base {baseCommit.slice(0, 7)} → Ticket worktree · − removed / + added</th>}</tr>
          </thead>
          <tbody>{rows.map((row, rowIndex) => row.kind === 'hunk'
            ? <tr key={rowIndex}><td colSpan={mode === 'split' ? 4 : 3} className="bg-indigo-950/60 px-3 py-1 text-indigo-300 whitespace-pre-wrap">{row.label}</td></tr>
            : <tr key={rowIndex}>
              <td className={`${numberClass} ${row.before?.kind === 'removed' ? 'bg-rose-950/40' : 'bg-slate-900'}`}>{row.before?.number ?? ''}</td>
              {mode === 'split' ? <LineContent line={row.before} wrap={wrap} /> : null}
              <td className={`${numberClass} border-l ${row.after?.kind === 'added' ? 'bg-emerald-950/40' : 'bg-slate-900'}`}>{row.after?.number ?? ''}</td>
              <LineContent line={mode === 'split' ? row.after : row.after ?? row.before} wrap={wrap} />
            </tr>)}</tbody>
        </table>}
    </div>
    </div>
    <div className="flex flex-wrap justify-between gap-2 border-t border-slate-800 bg-slate-900 px-3 py-2 text-xs text-slate-400">
      <span>Read-only · Base commit vs current ticket worktree</span>
      {displayedFile && !displayedFile.binary && <span>
        <span className="text-emerald-300">+{parsed.additions}</span>{' / '}
        <span className="text-rose-300">−{parsed.deletions}</span>
        {displayedFile.truncated ? ' (partial preview)' : ''}
      </span>}
      {fullscreen && <span>Esc to exit full screen</span>}
    </div>
  </div>;

  return <Fragment>
    {fullscreen ? <div className="rounded border border-slate-700 p-3 text-slate-400">Comparison open in full screen.</div> : comparison}
    {fullscreen && createPortal(<dialog ref={dialog} aria-labelledby="fullscreen-diff-title"
      onCancel={(event) => { event.preventDefault(); event.stopPropagation(); setExpanded(false); }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setExpanded(false); }
      }}
      className="fixed inset-0 m-0 h-dvh max-h-none w-screen max-w-none border-0 bg-slate-950 p-0 text-slate-100 backdrop:bg-slate-950/80">
      {comparison}
    </dialog>, document.body)}
  </Fragment>;
}
