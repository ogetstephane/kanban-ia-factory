import { test, expect } from '@playwright/test';
import { builtInWorkflow, currentWorkflowModel } from '../server/agents/currentWorkflowModels';
import { documentFixture } from '../shared/types/workflowEditor.fixture';
import { workflowEditorStateSchema, type WorkflowEditorState, type WorkflowScope } from '../shared/types/workflowEditor';
import { project } from '../src/components/stories/fixtures';

test('current orchestration imports are explicit, source-backed, locked and disconnected from execution', async ({ page }, testInfo) => {
  const states = new Map<string, WorkflowEditorState>();
  const references = {
    'ticket-authoring': await currentWorkflowModel('ticket-authoring'),
    'ticket-processing': await currentWorkflowModel('ticket-processing'),
    wiki: await currentWorkflowModel('wiki'),
  };
  let writes = 0;
  page.on('pageerror', (error) => { throw error; });
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/api/board/projects') {
      await route.fulfill({ json: [{ ...project, revision: 0, stats: {
        totalTasks: 0, completedTasks: 0, inProgressTasks: 0, completionRate: 0, totalFeatures: 0,
      } }] }); return;
    }
    if (path.endsWith('/test-runs/options')) {
      await route.fulfill({ json: { realProviders: [], previewOnly: true } }); return;
    }
    if (path.endsWith('/test-runs') && request.method() === 'GET') {
      await route.fulfill({ json: [] }); return;
    }
    const match = path.match(/^\/api\/board\/workflow-editor\/([^/]+)(?:\/(current-orchestration|publish))?$/);
    if (!match) throw new Error(`Unexpected request: ${path}`);
    const scope = match[1] as WorkflowScope;
    if (match[2] === 'current-orchestration') {
      if (scope === 'releases') throw new Error('Unsupported import');
      await route.fulfill({ json: references[scope] }); return;
    }
    let state = states.get(scope) ?? workflowEditorStateSchema.parse({
      scope, revision: 1, draft: { ...documentFixture(), name: 'Existing custom draft' },
      selectedVersionId: '00000000-0000-4000-8000-000000000001',
      versions: [{ id: '00000000-0000-4000-8000-000000000001', number: 1, createdAt: new Date().toISOString(), document: documentFixture() }],
    });
    if (request.method() === 'PUT') {
      writes++;
      state = { ...state, revision: state.revision + 1, draft: request.postDataJSON().document };
    }
    if (match[2] === 'publish') {
      writes++;
      const version = { id: '00000000-0000-4000-8000-000000000002', number: 2, createdAt: new Date().toISOString(), document: state.draft };
      state = { ...state, revision: state.revision + 1, selectedVersionId: version.id, versions: [version, ...state.versions] };
    }
    states.set(scope, state);
    await route.fulfill({ json: state });
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`/projects/${project.id}/workflows`);
  const editor = page.getByRole('region', { name: 'Agent workflow editor' });
  const controls = editor.getByRole('region', { name: 'Workflow controls' });
  const graph = editor.getByRole('group', { name: 'Workflow graph' });
  const menu = editor.getByRole('button', { name: 'Workflow menu', exact: true });
  await menu.click();
  await editor.getByLabel('Workflow name', { exact: true }).fill('Unsaved local draft');
  page.once('dialog', (dialog) => dialog.dismiss());
  await editor.getByRole('button', { name: 'Import current orchestration' }).click();
  await expect(editor.getByLabel('Workflow name', { exact: true })).toHaveValue('Unsaved local draft');
  expect(writes).toBe(0);
  for (const scope of ['ticket-authoring', 'ticket-processing', 'wiki'] as const) {
    if (scope !== 'ticket-authoring') await editor.getByLabel('Application scope').selectOption(scope);
    page.once('dialog', (dialog) => dialog.accept());
    await editor.getByRole('button', { name: 'Import current orchestration' }).click();
    await expect(editor.getByRole('region', { name: 'Current orchestration model' })).toContainText('reference only');
    await expect(editor.getByLabel('Workflow name', { exact: true })).toHaveValue(references[scope].name);
    expect(writes).toBe(scope === 'ticket-authoring' ? 0 : scope === 'ticket-processing' ? 2 : 4);
    expect(states.get(scope)!.draft.name).toBe('Existing custom draft');
    const previousVersion = structuredClone(states.get(scope)!.versions[0]);
    await menu.click();
    await editor.getByRole('button', { name: 'Fit nodes', exact: true }).click();
    await graph.getByRole('button').first().click();
    const nodeMenu = editor.getByRole('menu', { name: 'Node actions' });
    await expect(nodeMenu.getByRole('menuitem', { name: 'Duplicate node' })).toBeDisabled();
    await expect(nodeMenu.getByRole('menuitem', { name: 'Connect to another node' })).toBeDisabled();
    await nodeMenu.getByRole('menuitem', { name: 'Inspect host operation' }).click();
    const inspector = editor.getByRole('complementary', { name: 'Node inspector' });
    await expect(inspector.getByRole('region', { name: 'Host operation' })).toContainText('Source evidence');
    await expect(inspector.getByRole('button', { name: 'Remove step', exact: true })).toBeDisabled();
    await page.keyboard.press('Escape');
    const agentNode = graph.getByRole('button', { name: scope === 'ticket-processing' ? 'agent: Read-only planner' : 'agent: Auto', exact: true });
    await agentNode.focus();
    await agentNode.press('Enter');
    await nodeMenu.getByRole('menuitem', { name: 'Configure node' }).click();
    await expect(inspector.getByLabel('Autonomy', { exact: true })).toBeDisabled();
    await expect(inspector.getByLabel('Allowed tools (comma separated)', { exact: true })).toBeDisabled();
    await expect(inspector.getByText('Iteration budget: runtime-managed', { exact: false })).toBeVisible();
    await inspector.getByRole('button', { name: 'Edit linked prompt' }).click();
    await inspector.getByLabel('Prompt template', { exact: true }).fill('Proposed future instructions. No activation.');
    await page.keyboard.press('Escape');
    await page.screenshot({ path: testInfo.outputPath(`${scope}-reference.png`), fullPage: true });
    await menu.click();
    await editor.getByRole('button', { name: 'Save draft', exact: true }).click();
    await expect(editor.getByText('Draft saved.', { exact: true })).toBeVisible();
    await editor.getByRole('button', { name: 'Publish saved draft' }).click();
    await expect(editor.getByLabel('Published version').locator('option')).toHaveCount(3);
    expect(states.get(scope)!.versions[1]).toEqual(previousVersion);
    await editor.getByRole('button', { name: 'Test & results', exact: true }).click();
    await expect(page.locator('#workflow-test-dock')).toContainText('reference-only');
    await expect(editor.getByRole('button', { name: 'Start test run', exact: true })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await menu.click();
    await expect(controls).toBeVisible();
  }
  await editor.getByLabel('Application scope').selectOption('releases');
  await expect(editor.getByRole('button', { name: 'Import current orchestration' })).toBeEnabled();
});

test('all scopes have a built-in base and explicit version activation preserves drafts and history', async ({ page }, testInfo) => {
  const scopes = ['ticket-authoring', 'ticket-processing', 'wiki', 'releases'] as const;
  const bases = new Map(await Promise.all(scopes.map(async (scope) => [scope, await builtInWorkflow(scope)] as const)));
  const states = new Map<WorkflowScope, WorkflowEditorState>(scopes.map((scope) => [scope, {
    scope, revision: 0, draft: bases.get(scope)!, versions: [], selectedVersionId: null, activeVersionId: null,
  }]));
  let activations = 0;
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/api/board/projects') {
      await route.fulfill({ json: [{ ...project, revision: 0, stats: {
        totalTasks: 0, completedTasks: 0, inProgressTasks: 0, completionRate: 0, totalFeatures: 0,
      } }] }); return;
    }
    if (path.endsWith('/test-runs/options')) {
      await route.fulfill({ json: { realProviders: [], previewOnly: true } }); return;
    }
    if (path.endsWith('/test-runs')) { await route.fulfill({ json: [] }); return; }
    const match = path.match(/^\/api\/board\/workflow-editor\/([^/]+)(?:\/(base|publish|activate))?$/);
    if (!match) throw new Error(`Unexpected API request: ${path}`);
    const scope = match[1] as typeof scopes[number];
    if (match[2] === 'base') { await route.fulfill({ json: bases.get(scope) }); return; }
    let state = states.get(scope)!;
    if (request.method() === 'PUT') state = { ...state, revision: state.revision + 1, draft: request.postDataJSON().document };
    if (match[2] === 'publish') {
      const version = { id: `00000000-0000-4000-8000-00000000000${scopes.indexOf(scope) + 1}`,
        number: 1, createdAt: new Date().toISOString(), document: structuredClone(state.draft) };
      state = { ...state, revision: state.revision + 1, versions: [version], selectedVersionId: version.id };
    }
    if (match[2] === 'activate') {
      activations++;
      state = { ...state, revision: state.revision + 1, activeVersionId: request.postDataJSON().versionId };
    }
    states.set(scope, state);
    await route.fulfill({ json: state });
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`/projects/${project.id}/workflows`);
  const editor = page.getByRole('region', { name: 'Agent workflow editor' });
  await editor.getByRole('button', { name: 'Workflow menu', exact: true }).click();
  for (const [index, scope] of scopes.entries()) {
    if (index) {
      page.once('dialog', (dialog) => dialog.accept());
      await editor.getByLabel('Application scope').selectOption(scope);
    }
    await expect(editor.getByText('Active workflow: Prebuilt default', { exact: true })).toBeVisible();
    await expect(editor.getByLabel('Workflow name', { exact: true })).toHaveValue(bases.get(scope)!.name);
    await expect(editor.getByRole('region', { name: 'Executable workflow' })).toContainText('Editable skill-based workflow');
    await editor.getByRole('button', { name: 'Workflow menu', exact: true }).click();
    await editor.getByRole('button', { name: '+ Add element', exact: true }).click();
    await editor.getByRole('button', { name: scope === 'releases' ? 'Add release checkpoint' : 'Add agent step', exact: scope === 'releases' }).click();
    const inspector = editor.getByRole('complementary', { name: 'Node inspector' });
    await expect(inspector.getByRole('region', { name: 'Step execution settings' })).toBeVisible();
    await expect(inspector.getByLabel('Step output', { exact: true })).toHaveValue('context');
    if (scope === 'releases') await expect(inspector.getByLabel('Step tool policy', { exact: true })).toHaveCount(0);
    else await expect(inspector.getByLabel('Step tool policy', { exact: true })).toHaveValue('read-only');
    await expect(inspector.getByRole('checkbox', { name: scope === 'releases' ? 'release' : scope === 'ticket-processing' ? 'plan' : 'author', exact: true })).toBeChecked();
    await inspector.getByLabel('Step label', { exact: true }).fill('Custom pre-result step');
    if (scope === 'releases') await expect(inspector.getByRole('combobox', { name: 'Host operation', exact: true })).toHaveValue('release-checkpoint');
    await page.keyboard.press('Escape');
    await editor.getByRole('button', { name: 'Workflow menu', exact: true }).click();
    await expect(editor.getByRole('region', { name: 'Workflow validation' })).toContainText('Ready to activate');
    await editor.getByLabel('Workflow name', { exact: true }).fill(`${scope} customized`);
    await editor.getByRole('button', { name: 'Save draft', exact: true }).click();
    await expect(editor.getByText('Draft saved.', { exact: true })).toBeVisible();
    expect(states.get(scope)!.draft.nodes).toHaveLength(bases.get(scope)!.nodes.length + 1);
    expect(states.get(scope)!.draft.nodes.at(-1)!.label).toBe('Custom pre-result step');
    await editor.getByRole('button', { name: 'Publish saved draft' }).click();
    await expect(editor.getByLabel('Published version').locator('option')).toHaveCount(2);
    await expect(editor.getByText('Active workflow: Prebuilt default', { exact: true })).toBeVisible();
    page.once('dialog', (dialog) => dialog.dismiss());
    await editor.getByRole('button', { name: 'Activate version', exact: true }).click();
    expect(activations).toBe(index * 2);
    page.once('dialog', (dialog) => dialog.accept());
    await editor.getByRole('button', { name: 'Activate version', exact: true }).click();
    await expect(editor.getByText('Active workflow: v1', { exact: true })).toBeVisible();
    await expect(editor.getByRole('button', { name: 'Activate version', exact: true })).toBeDisabled();
    await editor.getByLabel('Workflow name', { exact: true }).fill('Unsaved draft kept');
    page.once('dialog', (dialog) => dialog.accept());
    await editor.getByRole('button', { name: 'Activate prebuilt default', exact: true }).click();
    await expect(editor.getByText('Active workflow: Prebuilt default', { exact: true })).toBeVisible();
    await expect(editor.getByLabel('Workflow name', { exact: true })).toHaveValue('Unsaved draft kept');
    expect(states.get(scope)!.draft.name).toBe(`${scope} customized`);
    expect(states.get(scope)!.versions).toHaveLength(1);
    expect(activations).toBe((index + 1) * 2);
    await page.screenshot({ path: testInfo.outputPath(`${scope}-activation.png`), fullPage: true });
  }
  page.once('dialog', (dialog) => dialog.accept());
  await editor.getByRole('button', { name: 'Load prebuilt workflow', exact: true }).click();
  await expect(editor.getByLabel('Workflow name', { exact: true })).toHaveValue(bases.get('releases')!.name);
});
