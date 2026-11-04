import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import TicketReview from './TicketReview';
import FileDiff from './FileDiff';
import { agentSession } from './stories/fixtures';

test('session review starts with a compact summary instead of an inline diff', () => {
  const markup = renderToStaticMarkup(createElement(TicketReview, {
    session: agentSession, onChange: () => {}, summaryOnly: true,
  }));
  assert.match(markup, /aria-label="Modified files summary"/);
  assert.match(markup, /Loading modified files/);
  assert.match(markup, /disabled=""[^>]*>.*Open diff in full screen/);
  assert.doesNotMatch(markup, /aria-label="Ticket code review"/);
  assert.doesNotMatch(markup, /aria-label="File diff"/);
});

test('existing inline review keeps its AI review action', () => {
  const markup = renderToStaticMarkup(createElement(TicketReview, {
    session: agentSession, onChange: () => {},
  }));
  assert.match(markup, /aria-label="Ticket code review"/);
  assert.match(markup, /Run AI review/);
  assert.doesNotMatch(markup, /aria-label="Modified files summary"/);
});

test('the full-screen review can suppress a nested diff full-screen control', () => {
  const props = { files: [], selected: '', onSelect: () => {}, baseCommit: '1234567', file: null, error: '' };
  const inline = renderToStaticMarkup(createElement(FileDiff, props));
  const fullscreen = renderToStaticMarkup(createElement(FileDiff, { ...props, allowFullscreen: false }));
  assert.match(inline, /Full screen/);
  assert.doesNotMatch(fullscreen, /Full screen/);
  assert.match(fullscreen, /aria-label="File diff"/);
});
