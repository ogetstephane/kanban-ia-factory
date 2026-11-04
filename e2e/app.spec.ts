import { expect, test } from '@playwright/test';
import { feature, project, release, tasks } from '../src/components/stories/fixtures';
import { projectSummarySchema } from '../shared/types/board';
import { KANBAN_STATUSES } from '../shared/utils/kanbanLogic';
import { calculateProjectStats } from '../src/utils/projectLogic';

const boardPath = `/projects/${project.id}/board`;
const { doneTasks, ...stats } = calculateProjectStats(project.id, tasks, [feature]);
const projectSummary = projectSummarySchema.parse({
  ...project,
  repositoryUrl: undefined,
  repositoryBranch: undefined,
  stats: { ...stats, completedTasks: doneTasks },
});

const responses: Record<string, unknown> = {
  'GET /api/board/projects': [projectSummary],
  [`GET /api/board/projects/${project.id}/board`]: { features: [feature], tasks },
  [`GET /api/board/projects/${project.id}/releases`]: [release],
  'GET /api/board/agent-workflows': {},
  'GET /api/board/agent-options': {
    providers: [{ id: 'copilot', name: 'GitHub Copilot', defaultModel: null, models: [] }],
  },
};

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (error) => { throw error; });
  page.on('console', (message) => {
    if (message.type() === 'error') throw new Error(`Browser console error: ${message.text()}`);
  });
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const key = `${request.method()} ${new URL(request.url()).pathname}`;
    if (!Object.hasOwn(responses, key)) {
      const error = `Unexpected API request in browser smoke test: ${key}`;
      await route.fulfill({ status: 501, json: { error } });
      throw new Error(error);
    }
    await route.fulfill({ json: responses[key] });
  });
});

test('loads and filters the project board', async ({ page }) => {
  await page.goto(boardPath);
  const columns = page.getByRole('region', { name: 'Kanban columns' });
  await expect(columns).toBeVisible();
  for (const status of KANBAN_STATUSES) {
    await expect(columns.getByRole('heading', { name: status, exact: true })).toBeVisible();
  }

  const featureCard = columns.getByText(feature.title, { exact: true });
  await expect(featureCard).toBeVisible();
  await page.getByRole('textbox', { name: 'Search tasks', exact: true }).fill('No matching smoke test ticket');
  await expect(featureCard).not.toBeVisible();
  await page.getByRole('button', { name: 'Clear search', exact: true }).click();
  await expect(featureCard).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('opens a new task and cancels back to the board', async ({ page }) => {
  await page.goto(boardPath);
  await page.getByRole('button', { name: 'Create new task', exact: true }).click();
  await expect(page).toHaveURL(`/projects/${project.id}/tasks/new?status=To+Do`);
  await expect(page).toHaveTitle('New task - Kanban Flow');
  await expect(page.getByRole('heading', { name: 'Create New Task', exact: true })).toBeVisible();
  await expect(page.getByLabel('Parent Feature')).toHaveValue(feature.id);
  await expect(page.getByLabel('Workflow Stage')).toHaveValue(feature.status);
  await expect(page.getByLabel('Model', { exact: true })).toBeEnabled();
  await expect(page.getByLabel('Release version (required before delivery)')).toBeEnabled();

  await page.getByRole('textbox', { name: 'Task Title' }).fill('Playwright UI smoke test');
  await page.getByRole('textbox', { name: 'Description & Context' }).fill('A disposable browser-only draft.');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page).toHaveURL(boardPath);
  await expect(page.getByRole('region', { name: 'Kanban columns' })).toBeVisible();
});

test('shows a not-found page for an unknown route', async ({ page }) => {
  await page.goto('/missing/page');
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Return to the cockpit' })).toHaveAttribute('href', '/');
});
