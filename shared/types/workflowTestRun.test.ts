import test from 'node:test';
import assert from 'node:assert/strict';
import { workflowJsonObjectSchema, workflowTestAgentSchema, workflowTestLaunchSchema } from './workflowTestRun';

test('test mocks require bounded structured JSON or explicit errors, never implicit real calls', () => {
  const mock = { mode: 'mock', delayMs: 30_000, response: { kind: 'output', output: { success: true, nested: [1, null] } } };
  assert.equal(workflowTestAgentSchema.safeParse(mock).success, true);
  assert.equal(workflowTestAgentSchema.safeParse({ ...mock, delayMs: 30_001 }).success, false);
  assert.equal(workflowTestAgentSchema.safeParse({ ...mock, delayMs: -1 }).success, false);
  assert.equal(workflowTestAgentSchema.safeParse({ ...mock, response: { kind: 'output', output: 'plain text' } }).success, false);
  assert.equal(workflowTestAgentSchema.safeParse({ ...mock, response: { kind: 'error', error: 'Chosen failure' } }).success, true);
  assert.equal(workflowTestAgentSchema.safeParse({ ...mock, response: { kind: 'error', error: ' ' } }).success, false);
  assert.equal(workflowTestAgentSchema.safeParse({ mode: 'real', delayMs: 0 }).success, false);
  assert.equal(workflowTestAgentSchema.safeParse({}).success, false);
  for (const invalid of [null, [], 1, true, 'text', { number: Infinity }, { number: NaN }]) {
    assert.equal(workflowJsonObjectSchema.safeParse(invalid).success, false);
  }
  const exact = { a: 'x'.repeat(63_992) };
  assert.equal(JSON.stringify(exact).length, 64_000);
  assert.equal(workflowJsonObjectSchema.safeParse(exact).success, true);
  assert.equal(workflowJsonObjectSchema.safeParse({ a: `${exact.a}x` }).success, false);
  const launch = { versionId: '00000000-0000-4000-8000-000000000001', input: {}, agents: { writer: mock }, authorizeRealAgents: false };
  assert.equal(workflowTestLaunchSchema.safeParse(launch).success, true);
  assert.equal(workflowTestLaunchSchema.safeParse({ ...launch, input: { script: 'inert' }, executeScripts: true }).success, false);
  assert.equal(workflowTestLaunchSchema.safeParse({ ...launch, agents: Object.fromEntries(Array.from({ length: 101 }, (_, index) => [`agent-${index}`, mock])) }).success, false);
});
