import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TicketClarification } from './TicketClarification';

const noop = () => undefined;
const props = {
  clarification: { kind: 'clarification' as const, reason: 'Missing scope', questions: ['Format?', 'Who uses it?'] },
  answers: ['CSV', ''], onChange: noop, onGenerate: noop, onDiscard: noop, disabled: false,
};

test('clarification requires every answer, labels editable fields and exposes explicit generation cost', () => {
  const incomplete = renderToStaticMarkup(createElement(TicketClarification, props));
  assert.match(incomplete, /aria-label="Ticket clarification"/);
  assert.match(incomplete, /another AI request, not ticket execution/);
  assert.match(incomplete, /<label[^>]*>Format\?<\/label>/);
  assert.match(incomplete, /maxLength="4000"/);
  assert.match(incomplete, /<button[^>]*disabled=""[^>]*>Generate from answers/);
  const complete = renderToStaticMarkup(createElement(TicketClarification, { ...props, answers: ['CSV', 'Editors'] }));
  assert.doesNotMatch(complete, /disabled=""/);
  const running = renderToStaticMarkup(createElement(TicketClarification, { ...props, disabled: true }));
  assert.match(running, /<textarea[^>]*disabled=""/);
  assert.match(running, /<button[^>]*disabled=""[^>]*>Discard questions/);
});
