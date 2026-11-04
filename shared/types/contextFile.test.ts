import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { contextFileSchema, contextFilesSchema, MAX_CONTEXT_FILE_BYTES } from './contextFile';
import { taskSchema } from './board';
import { INITIAL_TASKS } from '../data/initialData';

const file = (size = 4) => ({
  id: randomUUID(), name: 'reference.pdf', mimeType: 'application/pdf', size,
  data: Buffer.alloc(size, 65).toString('base64'),
});

test('context files validate binary bytes, empty files and legacy tasks', () => {
  const valid = file();
  assert.deepEqual(contextFileSchema.parse(valid), valid);
  assert.ok(contextFileSchema.safeParse(file(0)).success);
  assert.deepEqual(taskSchema.parse(INITIAL_TASKS[0]).contextFiles, []);
  assert.deepEqual(taskSchema.parse({ ...INITIAL_TASKS[0], contextFiles: [valid] }).contextFiles, [valid]);
});

test('context file limits accept exact boundaries and reject oversized uploads', () => {
  const full = file(MAX_CONTEXT_FILE_BYTES);
  assert.ok(contextFileSchema.safeParse(full).success);
  assert.ok(contextFilesSchema.safeParse([full, { ...full, id: randomUUID() }, { ...full, id: randomUUID() }]).success);
  assert.equal(contextFileSchema.safeParse(file(MAX_CONTEXT_FILE_BYTES + 1)).success, false);
  assert.equal(contextFilesSchema.safeParse([full, { ...full, id: randomUUID() }, { ...full, id: randomUUID() }, file(1)]).success, false);
  assert.ok(contextFilesSchema.safeParse(Array.from({ length: 10 }, () => file(0))).success);
  assert.equal(contextFilesSchema.safeParse(Array.from({ length: 11 }, () => file(0))).success, false);
});

test('invalid names, data, size mismatches and duplicate IDs are rejected', () => {
  const valid = file();
  for (const name of ['../reference.pdf', 'a/b', 'a\\b', 'bad\0.txt']) {
    assert.equal(contextFileSchema.safeParse({ ...valid, name }).success, false);
  }
  assert.equal(contextFileSchema.safeParse({ ...valid, data: 'not base64' }).success, false);
  assert.equal(contextFileSchema.safeParse({ ...valid, size: 3 }).success, false);
  assert.equal(contextFilesSchema.safeParse([valid, valid]).success, false);
  assert.equal(contextFileSchema.safeParse({ ...valid, mimeType: 'text/html\r\n' }).success, false);
});
