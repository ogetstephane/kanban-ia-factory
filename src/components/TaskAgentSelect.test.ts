import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import TaskAgentSelect from './TaskAgentSelect';

test('ticket agent selector labels provider and model and retains saved choices while loading', () => {
  const html = renderToStaticMarkup(createElement(TaskAgentSelect, {
    provider: 'copilot', model: 'saved-model',
    onProviderChange: () => undefined, onModelChange: () => undefined,
  }));
  assert.match(html, /Agent provider/);
  assert.match(html, /GitHub Copilot/);
  assert.match(html, /Loading models/);
  assert.match(html, /value="saved-model" selected=""/);
  assert.match(html, /saved selection/);
  assert.match(html, /Applies to Auto-Spec, planning, execution and AI review/);
});
