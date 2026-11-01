export interface DiffLine {
  number: number;
  text: string;
  kind: 'context' | 'added' | 'removed';
  noNewline?: boolean;
}

export type DiffRow =
  | { kind: 'hunk'; label: string }
  | { kind: 'line'; before: DiffLine | null; after: DiffLine | null };

export const MAX_DIFF_ROWS = 3000;

export function unifiedDiffRows(rows: DiffRow[]): DiffRow[] {
  const result: DiffRow[] = [];
  let removed: DiffRow[] = [];
  let added: DiffRow[] = [];
  const flush = () => { result.push(...removed, ...added); removed = []; added = []; };
  for (const row of rows) {
    if (row.kind === 'hunk' || row.before?.kind === 'context') {
      flush(); result.push(row);
    } else {
      if (row.before) removed.push({ kind: 'line', before: row.before, after: null });
      if (row.after) added.push({ kind: 'line', before: null, after: row.after });
    }
  }
  flush();
  return result;
}

/** Git supplies the actual comparison; this only aligns its hunks for display. */
export function parseDiff(patch: string, limit = MAX_DIFF_ROWS) {
  const rows: DiffRow[] = [];
  const metadata: string[] = [];
  let before = 0;
  let after = 0;
  let inHunk = false;
  let truncated = false;
  let removed: DiffLine[] = [];
  let added: DiffLine[] = [];
  let last: DiffLine[] = [];
  let additions = 0;
  let deletions = 0;
  const push = (row: DiffRow) => {
    if (rows.length >= limit) truncated = true;
    else rows.push(row);
  };
  const flush = () => {
    for (let index = 0; index < Math.max(removed.length, added.length); index++) {
      push({ kind: 'line', before: removed[index] ?? null, after: added[index] ?? null });
    }
    removed = []; added = [];
  };
  for (const raw of patch.split('\n')) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (hunk) {
      flush();
      before = Number(hunk[1]); after = Number(hunk[2]);
      inHunk = true; last = [];
      push({ kind: 'hunk', label: raw });
    } else if (!inHunk) {
      if (raw) metadata.push(raw);
    } else if (raw.startsWith('\\ No newline at end of file')) {
      for (const line of last) line.noNewline = true;
    } else if (raw.startsWith('-')) {
      const line: DiffLine = { number: before++, text: raw.slice(1), kind: 'removed' };
      removed.push(line); last = [line]; deletions++;
    } else if (raw.startsWith('+')) {
      const line: DiffLine = { number: after++, text: raw.slice(1), kind: 'added' };
      added.push(line); last = [line]; additions++;
    } else if (raw.startsWith(' ')) {
      flush();
      const left: DiffLine = { number: before++, text: raw.slice(1), kind: 'context' };
      const right: DiffLine = { number: after++, text: raw.slice(1), kind: 'context' };
      push({ kind: 'line', before: left, after: right }); last = [left, right];
    }
  }
  flush();
  return { rows, metadata, truncated, additions, deletions };
}
