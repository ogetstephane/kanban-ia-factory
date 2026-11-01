import React from 'react';
import { MermaidDiagram } from './MermaidDiagram';

const SAFE_LINK = /^(https?:\/\/|mailto:|#|\.{0,2}\/)/i;

function inline(text: string, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const pattern = /(`[^`]+`)|(\*\*[^*]+\*\*|__[^_]+__)|(\*[^*\s][^*]*\*|_[^_\s][^_]*_)|(!?\[[^\]]*\]\([^)\s]+\))/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let index = 0;
  while ((match = pattern.exec(text))) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    const token = match[0];
    const key = `${keyPrefix}-${index++}`;
    if (match[1]) nodes.push(<code key={key} className="rounded bg-slate-800 px-1 py-0.5 text-[0.85em] text-indigo-200">{token.slice(1, -1)}</code>);
    else if (match[2]) nodes.push(<strong key={key} className="font-semibold text-slate-100">{inline(token.slice(2, -2), key)}</strong>);
    else if (match[3]) nodes.push(<em key={key}>{inline(token.slice(1, -1), key)}</em>);
    else {
      const parts = /^(!?)\[([^\]]*)\]\(([^)\s]+)\)$/.exec(token);
      if (parts && SAFE_LINK.test(parts[3])) {
        nodes.push(parts[1]
          ? <span key={key} className="text-slate-500">[image: {parts[2] || parts[3]}]</span>
          : <a key={key} href={parts[3]} target="_blank" rel="noopener noreferrer" className="text-indigo-300 underline decoration-indigo-400/40 hover:text-indigo-200">{parts[2] || parts[3]}</a>);
      } else nodes.push(token);
    }
    last = match.index + token.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

/** Small renderer that only creates React elements, so document content can never inject HTML. Mermaid is lazy-loaded and rendered in strict mode. */
export function MarkdownPreview({ source }: { source: string }) {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: React.ReactNode[] = [];
  let i = 0;
  const key = () => `b${blocks.length}`;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    const fence = /^(```|~~~)\s*(\S*)/.exec(line);
    if (fence) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith(fence[1])) code.push(lines[i++]);
      i++;
      if (fence[2].toLowerCase() === 'mermaid') { blocks.push(<MermaidDiagram key={key()} code={code.join('\n')} />); continue; }
      blocks.push(<pre key={key()} className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950 p-4 text-xs leading-relaxed text-slate-200"><code>{code.join('\n')}</code></pre>);
      continue;
    }
    const heading = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const sizes = ['text-2xl', 'text-xl', 'text-lg', 'text-base', 'text-sm', 'text-sm'];
      blocks.push(React.createElement(`h${level}`, {
        key: key(),
        className: `${sizes[level - 1]} mt-6 mb-2 font-semibold text-white ${level <= 2 ? 'border-b border-slate-800 pb-1' : ''}`,
      }, inline(heading[2], key())));
      i++; continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { blocks.push(<hr key={key()} className="my-6 border-slate-800" />); i++; continue; }
    if (/^\s*>/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) quote.push(lines[i++].replace(/^\s*>\s?/, ''));
      blocks.push(<blockquote key={key()} className="my-3 border-l-2 border-indigo-400/50 pl-4 text-slate-400">{inline(quote.join(' '), key())}</blockquote>);
      continue;
    }
    const list = /^(\s*)([-*+]|\d+[.)])\s+/.exec(line);
    if (list) {
      const ordered = /\d/.test(list[2]);
      const items: string[] = [];
      while (i < lines.length && /^(\s*)([-*+]|\d+[.)])\s+/.test(lines[i])) items.push(lines[i++].replace(/^(\s*)([-*+]|\d+[.)])\s+/, ''));
      const Tag = ordered ? 'ol' : 'ul';
      blocks.push(<Tag key={key()} className={`my-3 space-y-1 pl-6 text-slate-300 ${ordered ? 'list-decimal' : 'list-disc'}`}>
        {items.map((item, n) => <li key={n}>{inline(item.replace(/^\[( |x)\]\s+/i, (_m, v: string) => (v === ' ' ? '☐ ' : '☑ ')), `${key()}-${n}`)}</li>)}
      </Tag>);
      continue;
    }
    if (line.includes('|') && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1] ?? '')) {
      const cells = (row: string) => row.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim());
      const head = cells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(cells(lines[i++]));
      blocks.push(<div key={key()} className="my-4 overflow-x-auto"><table className="w-full text-left text-sm">
        <thead><tr>{head.map((cell, n) => <th key={n} className="border-b border-slate-700 px-3 py-2 font-semibold text-slate-100">{inline(cell, `${key()}h${n}`)}</th>)}</tr></thead>
        <tbody>{rows.map((row, r) => <tr key={r}>{row.map((cell, n) => <td key={n} className="border-b border-slate-800 px-3 py-2 text-slate-300">{inline(cell, `${key()}r${r}c${n}`)}</td>)}</tr>)}</tbody>
      </table></div>);
      continue;
    }
    const paragraph: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|```|~~~|\s*>|\s*([-*+]|\d+[.)])\s)/.test(lines[i])) paragraph.push(lines[i++]);
    if (!paragraph.length) paragraph.push(lines[i++]);
    blocks.push(<p key={key()} className="my-3 leading-7 text-slate-300">{inline(paragraph.join(' '), key())}</p>);
  }
  return <div className="max-w-none break-words text-sm">{blocks.length ? blocks : <p className="text-slate-500">Nothing to preview yet.</p>}</div>;
}
