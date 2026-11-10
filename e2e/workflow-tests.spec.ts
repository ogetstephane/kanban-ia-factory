import { test, expect, type Page } from '@playwright/test';
import { documentFixture } from '../shared/types/workflowEditor.fixture';
import { workflowTestRunSchema, type WorkflowTestLaunch, type WorkflowTestRun } from '../shared/types/workflowTestRun';
import { project } from '../src/components/stories/fixtures';

async function setup(page: Page) {
  const doc = documentFixture();
  doc.nodes.splice(1, 0, { ...doc.nodes[0], id: 'second', label: 'Second agent', x: 350 });
  doc.edges = [{ from: 'writer', to: 'second' }, { from: 'second', to: 'check' }, { from: 'check', to: 'review' }];
  const version = { id: '00000000-0000-4000-8000-000000000001', number: 1, createdAt: new Date().toISOString(), document: doc };
  let run: WorkflowTestRun | undefined;
  const launches: WorkflowTestLaunch[] = [];
  page.on('pageerror', (error) => { throw error; });
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/api/board/projects') {
      await route.fulfill({ json: [{ ...project, revision: 0, stats: {
        totalTasks: 0, completedTasks: 0, inProgressTasks: 0, completionRate: 0, totalFeatures: 0,
      } }] }); return;
    }
    const root = '/api/board/workflow-editor/ticket-authoring';
    if (path === root) {
      await route.fulfill({ json: { scope: 'ticket-authoring', revision: 2, draft: doc, selectedVersionId: version.id, versions: [version] } }); return;
    }
    if (path === `${root}/test-runs/options`) {
      await route.fulfill({ json: { realProviders: ['copilot'], previewOnly: true } }); return;
    }
    if (path === `${root}/test-runs` && request.method() === 'GET') {
      await route.fulfill({ json: run ? [{ id: run.id, status: run.status, versionNumber: 1, createdAt: run.createdAt }] : [] }); return;
    }
    if (path === `${root}/test-runs` && request.method() === 'POST') {
      const configuration = request.postDataJSON() as WorkflowTestLaunch;
      launches.push(configuration);
      const writer = configuration.agents.writer;
      const delayed = writer.mode === 'mock' && writer.delayMs > 0;
      const error = writer.mode === 'mock' && writer.response.kind === 'error' ? writer.response.error : undefined;
      run = workflowTestRunSchema.parse({
        id: '00000000-0000-4000-8000-000000000002', scope: 'ticket-authoring', revision: 1, versionId: version.id,
        versionNumber: 1, document: doc, configuration, previewOnly: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        status: delayed ? 'running' : error ? 'failed' : 'waiting', ...(error ? { error } : {}),
        steps: doc.nodes.map((node) => ({
          nodeId: node.id, mode: node.kind === 'agent' ? configuration.agents[node.id].mode : 'control',
          status: delayed ? node.id === 'writer' ? 'running' : 'pending'
            : error ? node.id === 'writer' ? 'failed' : 'skipped' : node.id === 'review' ? 'waiting' : node.id === 'check' ? 'skipped' : 'completed',
          ...(node.id === 'writer' && writer.mode === 'mock' && writer.response.kind === 'output' ? { output: writer.response.output } : {}),
          ...(node.id === 'check' ? { note: 'Custom scripts are disabled in preview-only test runs.' } : {}),
        })),
      });
      await route.fulfill({ json: run }); return;
    }
    if (run && path.startsWith(`${root}/test-runs/${run.id}`)) {
      if (request.method() === 'POST') {
        run.revision++;
        if (path.endsWith('/approve')) {
          run.status = 'completed'; run.steps.find((step) => step.nodeId === 'review')!.status = 'completed';
        } else if (path.endsWith('/cancel')) {
          run.status = 'cancelled';
          for (const step of run.steps) if (step.status === 'running' || step.status === 'pending') step.status = 'cancelled';
        } else throw new Error(`Unexpected mutation ${path}`);
      }
      await route.fulfill({ json: run }); return;
    }
    throw new Error(`Unexpected request ${path}`);
  });
  await page.goto(`/projects/${project.id}/workflows`);
  await page.getByRole('button', { name: 'Workflow menu', exact: true }).click();
  await page.getByRole('button', { name: 'Test & results', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Workflow test runner' });
  await expect(panel).toBeVisible();
  return { panel, launches };
}

test('per-node JSON mocks mix with explicitly authorized real agents and expose approval/results', async ({ page }) => {
  const { panel, launches } = await setup(page);
  const writer = panel.getByRole('group', { name: 'Test agent Writer' });
  const second = panel.getByRole('group', { name: 'Test agent Second agent' });
  const start = panel.getByRole('button', { name: 'Start test run', exact: true });
  await writer.getByLabel('Mock JSON output', { exact: true }).fill('{"title":"My exact mock","criteria":["measurable"]}');
  await second.getByLabel('Agent execution', { exact: true }).selectOption('real');
  await expect(start).toBeDisabled();
  expect(launches).toHaveLength(0);
  await panel.getByRole('checkbox', { name: 'I authorize real-agent calls', exact: false }).check();
  await start.click();
  await expect(panel.getByRole('heading', { name: 'Run status: waiting · pinned v1' })).toBeVisible();
  expect(launches).toHaveLength(1);
  expect(launches[0].agents.writer).toEqual({ mode: 'mock', delayMs: 0, response: { kind: 'output', output: { title: 'My exact mock', criteria: ['measurable'] } } });
  expect(launches[0].agents.second).toEqual({ mode: 'real' });
  expect(launches[0].authorizeRealAgents).toBe(true);
  await expect(panel.getByRole('checkbox')).not.toBeChecked();
  await page.getByRole('button', { name: 'Test console & results', exact: false }).click();
  await expect(panel).toBeHidden();
  await page.getByRole('button', { name: 'Workflow menu', exact: true }).click();
  await page.getByRole('button', { name: 'Test & results', exact: true }).click();
  await expect(writer.getByLabel('Mock JSON output', { exact: true })).toHaveValue('{"title":"My exact mock","criteria":["measurable"]}');
  expect(launches).toHaveLength(1);
  const results = panel.getByRole('region', { name: 'Test run results' });
  await results.getByRole('article', { name: 'Result writer' }).getByText('Step input / output', { exact: true }).click();
  await expect(results.getByRole('article', { name: 'Result writer' }).locator('pre')).toContainText('My exact mock');
  await expect(results.getByText('Custom scripts are disabled in preview-only test runs.', { exact: true })).toBeVisible();
  await results.getByRole('button', { name: 'Approve preview step' }).click();
  await expect(panel.getByRole('heading', { name: 'Run status: completed · pinned v1' })).toBeVisible();
  await results.getByRole('button', { name: 'Reuse test inputs and mocks' }).click();
  await expect(writer.getByLabel('Mock JSON output', { exact: true })).toContainText('My exact mock');
  await expect(panel.getByRole('checkbox')).not.toBeChecked();
});

test('test runner validates JSON, accepts chosen failures and cancels delayed mocks', async ({ page }) => {
  const { panel, launches } = await setup(page);
  const writer = panel.getByRole('group', { name: 'Test agent Writer' });
  const start = panel.getByRole('button', { name: 'Start test run', exact: true });
  await writer.getByLabel('Mock JSON output', { exact: true }).fill('{"broken":');
  await expect(start).toBeDisabled();
  await expect(panel.getByRole('status')).toContainText('Invalid test configuration');
  await writer.getByLabel('Mock response', { exact: true }).selectOption('error');
  await writer.getByLabel('Simulated error message', { exact: true }).fill('Missing acceptance criteria');
  await start.click();
  await expect(panel.getByRole('heading', { name: 'Run status: failed · pinned v1' })).toBeVisible();
  await expect(panel.getByRole('alert')).toHaveText('Missing acceptance criteria');
  expect(launches[0].agents.writer.mode).toBe('mock');
  await writer.getByLabel('Mock response', { exact: true }).selectOption('output');
  await writer.getByLabel('Mock JSON output', { exact: true }).fill('{"ok":true}');
  await writer.getByLabel('Mock delay (ms, 0–30000)', { exact: true }).fill('15000');
  await start.click();
  await expect(panel.getByRole('heading', { name: 'Run status: running · pinned v1' })).toBeVisible();
  await panel.getByRole('button', { name: 'Cancel test run' }).click();
  await expect(panel.getByRole('heading', { name: 'Run status: cancelled · pinned v1' })).toBeVisible();
  expect(launches[1].agents.writer).toEqual({ mode: 'mock', delayMs: 15000, response: { kind: 'output', output: { ok: true } } });
});
