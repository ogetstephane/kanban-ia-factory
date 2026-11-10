import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TicketProposalQuality } from './TicketProposalQuality';

test('proposal checks show limited review readiness, never an implementation approval', () => {
  const ready = renderToStaticMarkup(createElement(TicketProposalQuality, {
    report: { status: 'ready-for-review', issues: [] },
  }));
  assert.match(ready, /aria-label="Ticket proposal checks"/);
  assert.match(ready, /Ready for human review/);
  assert.match(ready, /does not verify business completeness/);
  const clarify = renderToStaticMarkup(createElement(TicketProposalQuality, {
    report: { status: 'needs-clarification', issues: [
      { code: 'open-decision', path: 'openQuestions.0', message: 'Confirm <format>' },
    ] },
  }));
  assert.match(clarify, /Needs clarification/);
  assert.match(clarify, /openQuestions\.0/);
  assert.match(clarify, /Confirm &lt;format&gt;/);
});
