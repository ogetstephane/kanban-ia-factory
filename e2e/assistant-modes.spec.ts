import { expect, test, type Page } from '@playwright/test';
import { feature, project, release, tasks } from '../src/components/stories/fixtures';
import { projectSummarySchema } from '../shared/types/board';
import { calculateProjectStats } from '../src/utils/projectLogic';

const plan = '1. **Understanding**: revoke tokens on logout.\n2. **Proposed changes**: add the endpoint and its tests.';

async function mockApi(page: Page, handle: (path: string, body: unknown) => unknown) {
  const { doneTasks, ...stats } = calculateProjectStats(project.id, tasks, [feature]);
  const summary = projectSummarySchema.parse({
    ...project, repositoryUrl: 'https://example.com/repo.git', repositoryBranch: 'main', docsPath: 'docs',
    stats: { ...stats, completedTasks: doneTasks },
  });
  page.on('pageerror', (error) => { throw error; });
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/board/projects') return route.fulfill({ json: [summary] });
    if (path === `/api/board/projects/${project.id}/board`) return route.fulfill({ json: { features: [feature], tasks } });
    if (path === `/api/board/projects/${project.id}/releases`) return route.fulfill({ json: [release] });
    if (path === '/api/board/agent-options') return route.fulfill({ json: {
      providers: [{ id: 'copilot', name: 'GitHub Copilot', defaultModel: null, models: [] }],
    } });
    if (path === '/api/board/agent-workflows') return route.fulfill({ json: {} });
    const body = route.request().postDataJSON() as unknown;
    const json = handle(path, body);
    if (json === undefined) throw new Error(`Unexpected API request: ${path}`);
    return route.fulfill({ json });
  });
}

test('ticket Auto-Spec in Plan mode returns an editable plan, then fills the form from the approved plan', async ({ page }) => {
  const requests: Record<string, unknown>[] = [];
  await mockApi(page, (path, body) => {
    if (path !== `/api/board/projects/${project.id}/tasks/assistant`) return undefined;
    const input = body as Record<string, unknown>;
    requests.push(input);
    return input.approvedPlan
      ? {
        kind: 'proposal', title: 'Revoke tokens', description: 'Revoke tokens on logout.',
        acceptanceCriteria: ['Revoked tokens are rejected'], subtasks: ['Add endpoint'], suggestedWorkflow: 'TDD',
        estimatedStoryPoints: 3, suggestedTags: ['auth'], impactAnalysis: 'Touches the auth router.', graphAvailable: false,
      }
      : { kind: 'plan', plan, reason: 'Plan mode was selected.', graphAvailable: false };
  });
  await page.goto(`/projects/${project.id}/tasks/new`);
  await page.getByLabel('Task Title *').fill('Revoke tokens');
  const modes = page.getByRole('radiogroup', { name: 'Copilot assistant mode' });
  await expect(modes.getByRole('radio', { name: 'Auto' })).toBeChecked();
  await modes.getByText('Plan', { exact: true }).click();
  await page.getByRole('button', { name: 'Copilot Auto-Spec' }).click();

  const planPanel = page.getByRole('region', { name: 'Copilot specification plan' });
  await expect(planPanel.getByText('Plan mode was selected.')).toBeVisible();
  await planPanel.getByLabel('Plan (editable Markdown)').fill(`${plan}\n3. Document the endpoint.`);
  await planPanel.getByRole('button', { name: 'Generate specification from plan' }).click();

  await expect(planPanel).toHaveCount(0);
  await expect(page.getByLabel('Description & Context')).toHaveValue('Revoke tokens on logout.');
  expect(requests.map(({ mode, approvedPlan }) => ({ mode, approvedPlan }))).toEqual([
    { mode: 'plan', approvedPlan: undefined },
    { mode: 'plan', approvedPlan: `${plan}\n3. Document the endpoint.` },
  ]);
});

test('wiki assistant in Auto mode shows a plan when Copilot needs one and generates the page from it', async ({ page }) => {
  const requests: Record<string, unknown>[] = [];
  await mockApi(page, (path, body) => {
    const wiki = `/api/board/projects/${project.id}/wiki`;
    if (path === wiki) return { docsPath: 'docs', branch: 'main', files: [{ path: 'guide.md', size: 10, modifiedAt: '2026-11-04T10:00:00Z' }] };
    if (path === `${wiki}/file`) return { path: 'guide.md', content: '# Guide\n', sha: 'abc' };
    if (path === `${wiki}/status`) return { pending: [], ahead: 0 };
    if (path !== `${wiki}/assistant`) return undefined;
    const input = body as Record<string, unknown>;
    requests.push(input);
    return input.approvedPlan
      ? { kind: 'proposal', content: '# Guide\n\n## Setup\n', summary: 'Added the setup section.' }
      : { kind: 'plan', plan, reason: 'The request restructures most of the page.' };
  });
  await page.goto(`/projects/${project.id}/wiki`);
  await page.getByRole('button', { name: 'guide.md', exact: true }).click();
  await page.getByRole('button', { name: 'AI assistant' }).click();
  const assistant = page.getByRole('region', { name: 'Agent assistant' });
  await assistant.getByLabel('Assistant prompt').fill('Rewrite the guide');
  await assistant.getByRole('button', { name: 'Generate proposal' }).click();

  const planPanel = assistant.getByRole('region', { name: 'Copilot page plan' });
  await expect(planPanel.getByText('The request restructures most of the page.')).toBeVisible();
  await planPanel.getByRole('button', { name: 'Generate page from plan' }).click();
  await expect(assistant.getByText('Added the setup section.')).toBeVisible();
  await expect(planPanel).toHaveCount(0);
  expect(requests.map(({ mode, approvedPlan, prompt }) => ({ mode, approvedPlan, prompt }))).toEqual([
    { mode: 'auto', approvedPlan: undefined, prompt: 'Rewrite the guide' },
    { mode: 'auto', approvedPlan: plan, prompt: 'Rewrite the guide' },
  ]);
});
