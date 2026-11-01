import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDiff, unifiedDiffRows, type DiffRow } from './diffView';

const lines = (rows: DiffRow[]) => rows.filter((row) => row.kind === 'line');

test('aligns replacements, unchanged context and unequal added/deleted blocks with accurate numbers', () => {
  const diff = parseDiff('diff --git a/file b/file\n--- a/file\n+++ b/file\n@@ -10,4 +10,5 @@\n same\n-old\n-removed\n+new\n+extra\n+another\n tail\n');
  const actual = lines(diff.rows);
  assert.deepEqual(actual.map((row) => [row.before?.number ?? null, row.before?.text ?? null, row.after?.number ?? null, row.after?.text ?? null]), [
    [10, 'same', 10, 'same'], [11, 'old', 11, 'new'], [12, 'removed', 12, 'extra'],
    [null, null, 13, 'another'], [13, 'tail', 14, 'tail'],
  ]);
  assert.equal(diff.additions, 3);
  assert.equal(diff.deletions, 2);
  assert.equal(actual[1].before?.kind, 'removed');
  assert.equal(actual[1].after?.kind, 'added');
});

test('preserves independent hunk offsets, blank lines, CRLF and header-like source lines', () => {
  const diff = parseDiff('@@ -1 +1 @@\n--- source\n+++ source\n@@ -90,2 +95,2 @@ section\n \n-old\\value\r\n+new\\value\r\n');
  assert.equal(diff.rows.filter((row) => row.kind === 'hunk').length, 2);
  const actual = lines(diff.rows);
  assert.equal(actual[0].before?.text, '-- source');
  assert.equal(actual[0].after?.text, '++ source');
  assert.equal(actual[1].before?.text, '');
  assert.equal(actual[2].before?.number, 91);
  assert.equal(actual[2].after?.number, 96);
  assert.equal(actual[2].after?.text, 'new\\value\r');
});

test('represents file addition and deletion as an absent version, with no phantom final line', () => {
  const added = lines(parseDiff('--- /dev/null\n+++ b/new\n@@ -0,0 +1,2 @@\n+one\n+\n').rows);
  assert.equal(added.length, 2);
  assert.ok(added.every((row) => row.before === null));
  assert.deepEqual(added.map((row) => row.after?.number), [1, 2]);
  const removed = lines(parseDiff('@@ -1,2 +0,0 @@\n-one\n-two\n').rows);
  assert.equal(removed.length, 2);
  assert.ok(removed.every((row) => row.after === null));
});

test('attaches missing-newline markers to their own version', () => {
  const actual = lines(parseDiff('@@ -1 +1 @@\n-old\n\\ No newline at end of file\n+new\n').rows);
  assert.equal(actual[0].before?.noNewline, true);
  assert.equal(actual[0].after?.noNewline, undefined);
  const context = lines(parseDiff('@@ -1 +1 @@\n same\n\\ No newline at end of file\n').rows);
  assert.equal(context[0].before?.noNewline, true);
  assert.equal(context[0].after?.noNewline, true);
});

test('unified mode groups removals before additions without losing context or line numbers', () => {
  const diff = parseDiff('@@ -1,4 +1,4 @@\n first\n-old one\n-old two\n+new one\n+new two\n last\n');
  const unified = lines(unifiedDiffRows(diff.rows));
  assert.deepEqual(unified.map((row) => [row.before?.number ?? null, row.after?.number ?? null]), [
    [1, 1], [2, null], [3, null], [null, 2], [null, 3], [4, 4],
  ]);
  assert.deepEqual(unified.map((row) => row.after?.text ?? row.before?.text), ['first', 'old one', 'old two', 'new one', 'new two', 'last']);
  assert.equal(diff.rows.length, 5, 'switching layouts must not mutate the source rows');
});

test('keeps metadata-only changes explicit and enforces the exact rendering limit', () => {
  const metadata = parseDiff('diff --git a/a b/a\nold mode 100644\nnew mode 100755\n');
  assert.equal(metadata.rows.length, 0);
  assert.ok(metadata.metadata.includes('new mode 100755'));
  const patch = '@@ -0,0 +1,5 @@\n+1\n+2\n+3\n+4\n+5\n';
  assert.equal(parseDiff(patch, 6).truncated, false);
  const bounded = parseDiff(patch, 5);
  assert.equal(bounded.rows.length, 5);
  assert.equal(bounded.truncated, true);
});
