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

test('ticket runtime selection offers experimental Claude and resets provider-specific models without leaking them to Auto-Spec', async ({ page }) => {
  await page.route('**/api/board/agent-options', (route) => route.fulfill({ json: { providers: [
    { id: 'copilot', name: 'GitHub Copilot', defaultModel: null, models: [{ id: 'copilot-fixture', name: 'Copilot fixture' }] },
    { id: 'claude-code', name: 'Claude Code', available: true, experimental: true,
      defaultModel: null, issue: null, models: [{ id: 'claude-fixture', name: 'Claude fixture' }] },
  ] } }));
  await page.route('**/tasks/assistant', async (route) => {
    const body = route.request().postDataJSON();
    expect(body.agentModel).toBeUndefined();
    await route.fulfill({ json: { kind: 'plan', plan: 'Read the sources and document the change.', reason: 'Shared change.', graphAvailable: false } });
  });
  await page.goto(`/projects/${project.id}/tasks/new`);
  const provider = page.getByLabel('Agent provider', { exact: true });
  const model = page.getByLabel('Model', { exact: true });
  await model.selectOption('copilot-fixture');
  await provider.selectOption('claude-code');
  await expect(model).toHaveValue('');
  await expect(page.getByText('Experimental runtime:', { exact: false })).toBeVisible();
  await expect(model.locator('option[value="copilot-fixture"]')).toHaveCount(0);
  await model.selectOption('claude-fixture');
  await page.getByLabel('Task Title *').fill('Offline ticket runtime UI test');
  await page.getByRole('button', { name: 'Copilot Auto-Spec', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Copilot specification plan' })).toBeVisible();
  await provider.selectOption('copilot');
  await expect(model).toHaveValue('');
});

test('disabled Claude cannot be selected for a new ticket', async ({ page }) => {
  await page.route('**/api/board/agent-options', (route) => route.fulfill({ json: { providers: [
    { id: 'copilot', name: 'GitHub Copilot', defaultModel: null, models: [] },
    { id: 'claude-code', name: 'Claude Code', available: false, experimental: true,
      defaultModel: null, issue: 'Experimental runtime disabled.', models: [] },
  ] } }));
  await page.goto(`/projects/${project.id}/tasks/new`);
  const provider = page.getByLabel('Agent provider', { exact: true });
  await expect(provider).toBeEnabled();
  await expect(provider.locator('option[value="claude-code"]')).toBeDisabled();
  await expect(provider).toHaveValue('copilot');
});

test('feature breakdown reviews a plan and prerequisites before explicit atomic save', async ({ page }) => {
  const task = {
    title: 'Define export format', description: 'Document the requested format.',
    acceptanceCriteria: ['The format covers an empty selection.'], subtasks: ['Document cases', 'Add checks'],
    suggestedWorkflow: 'Verify the format against examples.', estimatedStoryPoints: 3, suggestedTags: ['export'],
    impactAnalysis: 'Sources are not verified.', priority: 'Medium', id: 'format', dependsOn: [],
  };
  let generated = 0;
  let saved: { feature: typeof feature; tasks: typeof tasks } | undefined;
  let finishSave!: () => void;
  const allowSave = new Promise<void>((resolve) => { finishSave = resolve; });
  await page.route('**/tasks/breakdown', async (route) => {
    generated++;
    const body = route.request().postDataJSON();
    if (!body.approvedPlan) {
      await route.fulfill({ json: { kind: 'plan', plan: 'Define format, then implement export.', reason: 'Two dependent slices.', graphAvailable: false } });
    } else {
      expect(body.approvedPlan).toBe('Define format, then implement export.');
      await route.fulfill({ json: { kind: 'proposal', graphAvailable: false, summary: 'Two slices',
        impactAnalysis: 'No source verification', openQuestions: ['Confirm the export limit'],
        tasks: [task, { ...task, id: 'implementation', title: 'Implement export', dependsOn: ['format'],
          openQuestions: ['Confirm the filename'] }] } });
    }
  });
  await page.route('**/api/board/breakdown', async (route) => {
    saved = route.request().postDataJSON();
    await allowSave;
    await route.fulfill({ json: saved });
  });
  await page.goto(boardPath);
  await page.getByRole('button', { name: `Split feature ${feature.title} with Copilot` }).click();
  const modal = page.getByRole('dialog', { name: 'Feature Decomposition & Task Breakdown' });
  await modal.getByRole('button', { name: '+ Write New Feature' }).click();
  await modal.getByLabel('Feature Title *').fill('Export feature');
  await modal.getByRole('button', { name: 'Auto-Split Feature with Copilot' }).click();
  await expect(modal.getByRole('region', { name: 'Ticket breakdown plan' })).toBeVisible();
  expect(saved).toBeUndefined();
  await modal.getByRole('button', { name: 'Generate tickets from plan' }).click();
  await expect(modal.getByText('Implement export', { exact: true })).toBeVisible();
  const checks = modal.getByRole('region', { name: 'Ticket proposal checks' });
  await expect(checks.getByRole('heading', { name: 'Needs clarification' })).toBeVisible();
  await expect(checks.getByText('openQuestions.0', { exact: true })).toBeVisible();
  await expect(checks.getByText('tasks.1.openQuestions.0', { exact: true })).toBeVisible();
  expect(generated).toBe(2);
  expect(saved).toBeUndefined();
  const checkboxes = modal.getByRole('checkbox');
  await checkboxes.first().uncheck();
  await modal.getByRole('button', { name: 'Add Selected Tasks to Board' }).click();
  await expect(modal.getByText(/Select all prerequisites/)).toBeVisible();
  await expect(checks.getByText(/Dependencies must name unique earlier tickets/)).toBeVisible();
  expect(saved).toBeUndefined();
  await checkboxes.first().check();
  await modal.getByRole('button', { name: 'Add Selected Tasks to Board' }).click();
  await expect.poll(() => saved?.tasks.length).toBe(2);
  await expect(modal).toBeVisible();
  await expect(modal.getByRole('button', { name: 'Add Selected Tasks to Board' })).toBeDisabled();
  expect(saved?.tasks.every((item) => item.status === 'To Do')).toBe(true);
  expect(saved?.tasks[1].description).toContain('## Prerequisites\n\n- Define export format');
  expect(saved?.tasks[1].description).toContain('Confirm the export limit');
  expect(saved?.tasks[1].description).toContain('Confirm the filename');
  finishSave();
  await expect(modal).not.toBeVisible();
});

test('breakdown avoids active epics and clears proposals when the need changes', async ({ page }) => {
  await page.route('**/tasks/breakdown', (route) => route.fulfill({ json: {
    kind: 'proposal', graphAvailable: false, summary: 'One slice', impactAnalysis: 'No graph', openQuestions: [],
    tasks: [{ id: 'first', title: 'A proposed slice', description: 'Scoped work', priority: 'Medium', dependsOn: [],
      acceptanceCriteria: ['Observable outcome'], subtasks: ['Verify outcome'], suggestedWorkflow: 'Verify',
      estimatedStoryPoints: 1, suggestedTags: [], impactAnalysis: 'No source access' }],
  } }));
  await page.goto(boardPath);
  await page.getByRole('button', { name: `Split feature ${feature.title} with Copilot` }).click();
  const modal = page.getByRole('dialog', { name: 'Feature Decomposition & Task Breakdown' });
  await expect(modal.getByRole('button', { name: 'Auto-Split Feature with Copilot' })).toBeDisabled();
  await modal.getByRole('button', { name: '+ Write New Feature' }).click();
  await modal.getByLabel('Feature Title *').fill('Initial need');
  await modal.getByRole('button', { name: 'Auto-Split Feature with Copilot' }).click();
  await expect(modal.getByText('A proposed slice', { exact: true })).toBeVisible();
  await expect(modal.getByRole('heading', { name: 'Ready for human review' })).toBeVisible();
  await modal.getByLabel('Feature Title *').fill('A different need');
  await expect(modal.getByText('A proposed slice', { exact: true })).not.toBeVisible();
  await expect(modal.getByRole('button', { name: 'Add Selected Tasks to Board' })).toBeDisabled();
  await expect(modal.getByRole('region', { name: 'Ticket proposal checks' })).not.toBeVisible();
});

test('Auto-Spec shows limited quality checks, preserves decisions and replaces reports on regeneration', async ({ page }) => {
  let generation = 0;
  await page.route('**/tasks/assistant', async (route) => {
    generation++;
    await route.fulfill({ json: generation === 3
      ? { kind: 'plan', plan: 'Confirm the scope.', reason: 'A new decision', graphAvailable: false }
      : { kind: 'proposal', graphAvailable: false, title: 'Export selection',
        description: 'Export rows in selection order.', acceptanceCriteria: ['Ordering is preserved'],
        subtasks: ['Cover ordering'], suggestedWorkflow: 'Run project tests', estimatedStoryPoints: 3,
        suggestedTags: [], impactAnalysis: 'Sources need review',
        openQuestions: generation === 1 ? ['Which export format?'] : [] } });
  });
  await page.goto(`/projects/${project.id}/tasks/new`);
  await page.getByLabel('Task Title *').fill('Export selection');
  const generate = page.getByRole('button', { name: 'Copilot Auto-Spec', exact: true });
  await generate.click();
  const checks = page.getByRole('region', { name: 'Ticket proposal checks' });
  await expect(checks.getByRole('heading', { name: 'Needs clarification' })).toBeVisible();
  await expect(checks.getByText(/Which export format/)).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Description & Context' })).toHaveValue(/## Open decisions\n\n- Which export format/);
  await expect(page.getByText('Checks for the last generated proposal, before your edits.')).toBeVisible();
  await generate.click();
  await expect(checks.getByRole('heading', { name: 'Ready for human review' })).toBeVisible();
  await expect(checks.getByText(/Which export format/)).not.toBeVisible();
  await expect(checks.getByText(/does not verify business completeness/)).toBeVisible();
  await generate.click();
  await expect(page.getByRole('region', { name: 'Copilot specification plan' })).toBeVisible();
  await expect(checks).not.toBeVisible();
});

test('Auto-Spec asks before drafting, submits answers explicitly and retains them through cancellation', async ({ page }) => {
  let generation = 0;
  const proposal = { kind: 'proposal', graphAvailable: false, title: 'Export selection',
    description: 'Export in CSV format.', acceptanceCriteria: ['Rows retain selection order'],
    subtasks: ['Cover CSV output'], suggestedWorkflow: 'Run project tests', estimatedStoryPoints: 3,
    suggestedTags: [], impactAnalysis: 'Sources need review', openQuestions: [] };
  await page.route('**/tasks/assistant', async (route) => {
    generation++;
    const body = route.request().postDataJSON();
    if (generation === 1) {
      expect(body.clarificationAnswers).toBeUndefined();
      await route.fulfill({ json: { kind: 'clarification', graphAvailable: false,
        reason: 'Output format and users are unspecified.', questions: ['Which format?', 'Who uses it?'] } });
    } else {
      expect(body.clarificationAnswers).toEqual([
        { question: 'Which format?', answer: 'CSV' }, { question: 'Who uses it?', answer: 'Editors' },
      ]);
      expect(body.approvedPlan).toBeUndefined();
      if (generation === 2) await new Promise((resolve) => setTimeout(resolve, 500));
      await route.fulfill({ json: proposal });
    }
  });
  await page.goto(`/projects/${project.id}/tasks/new`);
  await page.getByLabel('Task Title *').fill('Export selection');
  await page.getByLabel('Description & Context').fill('Keep my original notes.');
  await page.getByRole('button', { name: 'Copilot Auto-Spec', exact: true }).click();
  const questions = page.getByRole('region', { name: 'Ticket clarification' });
  await expect(questions).toBeVisible();
  await expect(page.getByLabel('Description & Context')).toHaveValue('Keep my original notes.');
  await expect(page.getByRole('region', { name: 'Ticket proposal checks' })).not.toBeVisible();
  const generate = questions.getByRole('button', { name: 'Generate from answers' });
  await expect(generate).toBeDisabled();
  await questions.getByLabel('Which format?').fill('CSV');
  await expect(generate).toBeDisabled();
  await questions.getByLabel('Who uses it?').fill('Editors');
  expect(generation).toBe(1);
  await generate.click();
  await expect.poll(() => generation).toBe(2);
  await page.getByRole('button', { name: 'Cancel generation', exact: true }).click();
  await expect(questions.getByLabel('Which format?')).toHaveValue('CSV');
  await generate.click();
  await expect(questions).not.toBeVisible();
  await expect(page.getByLabel('Description & Context')).toHaveValue(/## Clarifications\n\n### Which format\?\n\nCSV/);
  await expect(page.getByLabel('Description & Context')).toHaveValue(/### Who uses it\?\n\nEditors/);
  await expect(page.getByRole('heading', { name: 'Ready for human review' })).toBeVisible();
});

test('changing a ticket need discards clarification and never reuses unrelated answers', async ({ page }) => {
  let generation = 0;
  await page.route('**/tasks/assistant', async (route) => {
    generation++;
    expect(route.request().postDataJSON().clarificationAnswers).toBeUndefined();
    await route.fulfill({ json: { kind: 'clarification', graphAvailable: false, reason: 'Need scope', questions: ['Which users?'] } });
  });
  await page.goto(`/projects/${project.id}/tasks/new`);
  await page.getByLabel('Task Title *').fill('Initial need');
  await page.getByRole('button', { name: 'Copilot Auto-Spec', exact: true }).click();
  const questions = page.getByRole('region', { name: 'Ticket clarification' });
  await questions.getByLabel('Which users?').fill('Editors');
  await page.getByLabel('Task Title *').fill('Another need');
  await expect(questions).not.toBeVisible();
  await page.getByRole('button', { name: 'Copilot Auto-Spec', exact: true }).click();
  await expect(questions.getByLabel('Which users?')).toHaveValue('');
  await questions.getByRole('button', { name: 'Discard questions' }).click();
  await expect(questions).not.toBeVisible();
  expect(generation).toBe(2);
});

test('breakdown clarifications survive plan approval and are preserved only on explicit save', async ({ page }) => {
  let generation = 0;
  let saved: { tasks: typeof tasks } | undefined;
  await page.route('**/tasks/breakdown', async (route) => {
    generation++;
    const body = route.request().postDataJSON();
    if (generation === 1) {
      await route.fulfill({ json: { kind: 'clarification', reason: 'Need scope',
        questions: ['Which format?'], graphAvailable: false } });
      return;
    }
    expect(body.clarificationAnswers).toEqual([{ question: 'Which format?', answer: 'CSV' }]);
    if (generation === 2) {
      await route.fulfill({ json: { kind: 'plan', plan: 'Define CSV, then export.', reason: 'Review the split', graphAvailable: false } });
      return;
    }
    expect(body.approvedPlan).toBe('Define CSV, then export.');
    await route.fulfill({ json: { kind: 'proposal', graphAvailable: false, summary: 'One slice',
      impactAnalysis: 'No source verification', openQuestions: [], tasks: [{
        id: 'export', title: 'Export CSV', description: 'Provide CSV export', priority: 'Medium', dependsOn: [],
        acceptanceCriteria: ['Output preserves selection order'], subtasks: ['Cover order'],
        suggestedWorkflow: 'Run project checks', estimatedStoryPoints: 3, suggestedTags: [], impactAnalysis: 'Unverified',
      }] } });
  });
  await page.route('**/api/board/breakdown', async (route) => {
    saved = route.request().postDataJSON();
    await route.fulfill({ json: saved });
  });
  await page.goto(boardPath);
  await page.getByRole('button', { name: `Split feature ${feature.title} with Copilot` }).click();
  const modal = page.getByRole('dialog', { name: 'Feature Decomposition & Task Breakdown' });
  await modal.getByRole('button', { name: '+ Write New Feature' }).click();
  await modal.getByLabel('Feature Title *').fill('Exports');
  await modal.getByRole('button', { name: 'Auto-Split Feature with Copilot' }).click();
  const questions = modal.getByRole('region', { name: 'Ticket clarification' });
  await expect(questions.getByRole('button', { name: 'Generate from answers' })).toBeDisabled();
  await questions.getByLabel('Which format?').fill('CSV');
  expect(generation).toBe(1);
  expect(saved).toBeUndefined();
  await questions.getByRole('button', { name: 'Generate from answers' }).click();
  await modal.getByRole('button', { name: 'Generate tickets from plan' }).click();
  await expect(modal.getByText('Export CSV', { exact: true })).toBeVisible();
  expect(saved).toBeUndefined();
  await modal.getByRole('button', { name: 'Add Selected Tasks to Board' }).click();
  await expect(modal).not.toBeVisible();
  expect(saved?.tasks[0].description).toContain('## Clarifications\n\n### Which format?\n\nCSV');
});
