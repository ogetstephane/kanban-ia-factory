import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const views = [
  'CockpitView', 'DeliveryHistoryView', 'GitView', 'GitTaskDiffView', 'ReleasesView',
  'WikiView', 'ActivityView', 'SessionsView', 'VelocityDashboard', 'KanbanBoard',
];
const caps = /max-w-(7xl|6xl|5xl|\[1700px\])/;

for (const view of views) {
  test(`${view} fills the available width`, () => {
    const source = readFileSync(`src/components/${view}.tsx`, 'utf8');
    assert.match(source, /w-full min-w-0/);
    assert.doesNotMatch(source, caps);
  });
}

for (const file of ['App.tsx', 'components/Navbar.tsx', 'components/FeatureBar.tsx', 'components/TaskPage.tsx']) {
  test(`${file} chrome is not width-capped`, () => {
    assert.doesNotMatch(readFileSync(`src/${file}`, 'utf8'), caps);
  });
}

test('kanban columns no longer cap their width', () => {
  assert.doesNotMatch(readFileSync('src/components/KanbanColumn.tsx', 'utf8'), /max-w-\[340px\]/);
});
