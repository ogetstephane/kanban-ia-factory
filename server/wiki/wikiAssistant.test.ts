import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CopilotClient, type MessageOptions } from '@github/copilot-sdk';
import { WikiAssistant, wikiAssistantMessage } from './wikiAssistant';
import { wikiAssistantInputSchema, MAX_WIKI_ASSISTANT_CONTEXT_BYTES, wikiAssistantContextBytes } from '../../src/types/wiki';
import { boardApi } from '../../src/data/boardApi';

const input = wikiAssistantInputSchema.parse({
  path: 'guide.md', content: '# Existing\n', prompt: 'Improve the introduction',
  files: [
    { id: '83b55352-1a04-4fb7-9ec0-72cd6ca7269b', name: 'requirements.md', mimeType: 'text/markdown', size: 4, data: 'dGVzdA==' },
    { id: 'aeebafcd-f014-481b-9659-e3951be21488', name: 'design.pdf', mimeType: 'application/pdf', size: 3, data: 'AP8K' },
  ],
});

test('wiki proposal request includes the unsaved draft, instruction, readable text and binary attachments', () => {
  const message = wikiAssistantMessage(input);
  const prompt = JSON.parse(message.prompt);
  assert.equal(prompt.instruction, input.prompt);
  assert.deepEqual(prompt.document, { path: input.path, content: input.content });
  assert.equal(prompt.contextFiles[0].content, 'test');
  assert.equal(prompt.contextFiles[0].data, undefined);
  assert.deepEqual(message.attachments, [{ type: 'blob', data: 'AP8K', mimeType: 'application/pdf', displayName: 'design.pdf' }]);
  assert.equal(wikiAssistantInputSchema.safeParse({ ...input, prompt: ' ' }).success, false);
  assert.equal(wikiAssistantInputSchema.safeParse({ ...input, files: [{ ...input.files[0], size: 99 }] }).success, false);
});

test('wiki assistant is tool-free, returns a proposal and always stops its runtime', async (t) => {
  const start = t.mock.method(CopilotClient.prototype, 'start', async () => {});
  const stop = t.mock.method(CopilotClient.prototype, 'stop', async () => []);
  t.mock.method(CopilotClient.prototype, 'getAuthStatus', async () => ({ isAuthenticated: true }));
  const result = { content: '# Improved\n', summary: 'Improved introduction' };
  const send = t.mock.fn(async (_message: MessageOptions, _timeout?: number) => ({ data: { content: JSON.stringify(result) } }));
  const create = t.mock.method(CopilotClient.prototype, 'createSession', async () => ({ sendAndWait: send }));
  assert.deepEqual(await new WikiAssistant().generate(input, new AbortController().signal), result);
  assert.equal(start.mock.callCount(), 1);
  assert.equal(stop.mock.callCount(), 1);
  const config = create.mock.calls[0].arguments[0];
  assert.deepEqual(config?.tools, []);
  assert.deepEqual(config?.availableTools, []);
  assert.equal(config?.skipCustomInstructions, true);
  assert.equal(send.mock.calls[0].arguments[1], 120000);
  assert.deepEqual(send.mock.calls[0].arguments[0], wikiAssistantMessage(input));
});

test('context preflight accepts the exact byte boundary and rejects one byte over including multibyte text and attachments', () => {
  const base = { path: 'a.md', prompt: 'x', content: '', files: [] };
  const exact = { ...base, content: 'a'.repeat(MAX_WIKI_ASSISTANT_CONTEXT_BYTES - 5) };
  assert.equal(wikiAssistantContextBytes(exact), MAX_WIKI_ASSISTANT_CONTEXT_BYTES);
  assert.ok(wikiAssistantInputSchema.safeParse(exact).success);
  assert.equal(wikiAssistantInputSchema.safeParse({ ...exact, content: exact.content + 'a' }).success, false);
  assert.equal(wikiAssistantContextBytes({ ...base, content: '\u00e9', files: [{ size: 10 }] }), 17);
  assert.equal(wikiAssistantInputSchema.safeParse({
    ...base, files: [{ ...input.files[0], size: 100000, data: Buffer.alloc(100000).toString('base64') }],
  }).success, false);
});

test('oversized context is rejected in browser API and generator before fetch or runtime start', async (t) => {
  const oversized = { ...input, content: 'a'.repeat(MAX_WIKI_ASSISTANT_CONTEXT_BYTES) };
  const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new Error('Must not fetch'); });
  const start = t.mock.method(CopilotClient.prototype, 'start', async () => {});
  await assert.rejects(boardApi.assistWiki('project', oversized), /context is too large/);
  await assert.rejects(new WikiAssistant().generate(oversized, new AbortController().signal), /context is too large/);
  assert.equal(fetch.mock.callCount(), 0);
  assert.equal(start.mock.callCount(), 0);
});

test('model-budget rejection for expanded attachments returns actionable guidance rather than a generic 502', async (t) => {
  t.mock.method(CopilotClient.prototype, 'start', async () => {});
  t.mock.method(CopilotClient.prototype, 'stop', async () => []);
  t.mock.method(CopilotClient.prototype, 'getAuthStatus', async () => ({ isAuthenticated: true }));
  t.mock.method(CopilotClient.prototype, 'createSession', async () => ({
    sendAndWait: async () => { throw new Error("Execution failed: Request exceeds the model's prompt budget after reserving output (430051 tokens; limit 200000)."); },
  }));
  await assert.rejects(new WikiAssistant().generate(input, new AbortController().signal), (error: unknown) => {
    assert.ok(error instanceof Error && 'status' in error);
    assert.equal(error.status, 413);
    assert.match(error.message, /Remove attachments or shorten/);
    assert.match(error.message, /No content has been truncated/);
    return true;
  });
});

test('authentication and malformed or empty responses fail explicitly and stop the runtime', async (t) => {
  t.mock.method(CopilotClient.prototype, 'start', async () => {});
  const stop = t.mock.method(CopilotClient.prototype, 'stop', async () => []);
  const auth = t.mock.method(CopilotClient.prototype, 'getAuthStatus', async () => ({ isAuthenticated: false }));
  const assistant = new WikiAssistant();
  await assert.rejects(assistant.generate(input, new AbortController().signal), /not authenticated/);
  auth.mock.mockImplementation(async () => ({ isAuthenticated: true }));
  for (const content of ['', 'not JSON', '{"content":"","summary":"No content"}']) {
    t.mock.method(CopilotClient.prototype, 'createSession', async () => ({ sendAndWait: async () => ({ data: { content } }) }));
    await assert.rejects(assistant.generate(input, new AbortController().signal), /no wiki proposal|invalid wiki proposal|invalid or oversized/);
  }
  assert.equal(stop.mock.callCount(), 4);
});

test('runtime timeouts and cancellation stop Copilot without a success-shaped fallback', async (t) => {
  t.mock.method(CopilotClient.prototype, 'start', async () => {});
  const stop = t.mock.method(CopilotClient.prototype, 'stop', async () => []);
  const forceStop = t.mock.method(CopilotClient.prototype, 'forceStop', async () => []);
  t.mock.method(CopilotClient.prototype, 'getAuthStatus', async () => ({ isAuthenticated: true }));
  const controller = new AbortController();
  t.mock.method(CopilotClient.prototype, 'createSession', async () => ({
    sendAndWait: async () => { throw new Error('Timed out waiting for response'); },
  }));
  await assert.rejects(new WikiAssistant().generate(input, controller.signal), {
    status: 502,
    message: 'Copilot wiki generation failed: Timed out waiting for response',
  });
  t.mock.method(CopilotClient.prototype, 'createSession', async () => ({
    sendAndWait: async () => { controller.abort(); controller.signal.throwIfAborted(); },
  }));
  await assert.rejects(new WikiAssistant().generate(input, controller.signal), { name: 'AbortError' });
  assert.equal(forceStop.mock.callCount(), 1);
  assert.equal(stop.mock.callCount(), 2);
});
