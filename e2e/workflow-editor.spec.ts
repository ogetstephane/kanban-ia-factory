import { expect, test, type Page } from '@playwright/test';
import { documentFixture } from '../shared/types/workflowEditor.fixture';
import { workflowEditorStateSchema, type WorkflowEditorState, type WorkflowScope } from '../shared/types/workflowEditor';
import { project } from '../src/components/stories/fixtures';

async function openWorkflow(page: Page) {
  if (!await page.getByRole('region', { name: 'Workflow controls' }).isVisible()) {
    await page.getByRole('button', { name: 'Workflow menu', exact: true }).click();
  }
}

async function configureWriter(page: Page, name = 'agent: Writer') {
  if (await page.getByRole('region', { name: 'Workflow controls' }).isVisible()) {
    await page.getByRole('button', { name: 'Workflow menu', exact: true }).click();
  }
  await page.getByRole('group', { name: 'Workflow graph' }).getByRole('button', { name, exact: true }).click();
  await page.getByRole('menuitem', { name: 'Configure node', exact: true }).click();
}

test('workflow studio edits visual definitions, validates connections and restores immutable versions', async ({ page }) => {
  page.on('pageerror', (error) => { throw error; });
  const states = new Map<string, WorkflowEditorState>();
  const saves: WorkflowEditorState[] = [];
  let version = 0;
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/api/board/projects') {
      await route.fulfill({ json: [{ ...project, revision: 0, stats: {
        totalTasks: 0, completedTasks: 0, inProgressTasks: 0, completionRate: 0, totalFeatures: 0,
      } }] }); return;
    }
    if (path.endsWith('/test-runs/options')) {
      await route.fulfill({ json: { realProviders: ['copilot'], previewOnly: true } }); return;
    }
    if (path.endsWith('/test-runs')) { await route.fulfill({ json: [] }); return; }
    const match = path.match(/^\/api\/board\/workflow-editor\/([^/]+)(?:\/(publish|select|resolve))?$/);
    if (!match) throw new Error(`Unexpected request: ${path}`);
    const scope = match[1] as WorkflowScope;
    let state = states.get(scope) ?? workflowEditorStateSchema.parse({
      scope, revision: 0, draft: documentFixture(), selectedVersionId: null, versions: [],
    });

    const body = request.method() === 'GET' ? {} : request.postDataJSON();
    if (match[2] === 'resolve') {
      await route.fulfill({ json: { scope, version: state.versions.find((item) => item.id === body.versionId), runtimeConnected: false } }); return;
    }
    if (request.method() !== 'GET' && body.revision !== state.revision) {
      await route.fulfill({ status: 409, json: { error: 'Workflow changed elsewhere. Reload explicitly.' } }); return;
    }
    if (request.method() === 'PUT') {
      state = workflowEditorStateSchema.parse({ ...state, revision: state.revision + 1, draft: body.document });
      saves.push(structuredClone(state));
    }
    if (match[2] === 'publish') {
      version++;
      const id = `00000000-0000-4000-8000-${String(version).padStart(12, '0')}`;
      state = { ...state, revision: state.revision + 1, selectedVersionId: id,
        versions: [{ id, number: version, createdAt: new Date().toISOString(), document: structuredClone(state.draft) }, ...state.versions] };
    }
    if (match[2] === 'select') state = { ...state, revision: state.revision + 1, selectedVersionId: body.versionId };
    states.set(scope, state);
    await route.fulfill({ json: state });
  });
  await page.goto(`/projects/${project.id}/workflows`);
  const editor = page.getByRole('region', { name: 'Agent workflow editor' });
  await openWorkflow(page);
  await expect(editor.getByRole('heading', { name: 'Agent workflow studio' })).toBeVisible();
  await editor.getByText('Preview environment · production isolated · global configuration', { exact: true }).click();
  await expect(editor.getByText('Scripts and production writes are disabled.', { exact: false })).toBeVisible();
  const save = editor.getByRole('button', { name: 'Save draft', exact: true });
  await editor.getByLabel('Workflow name', { exact: true }).fill('Ticket pipeline v1');
  const graph = editor.getByRole('group', { name: 'Workflow graph' });
  const writer = graph.getByRole('button', { name: 'agent: Writer' });
  await editor.getByRole('button', { name: 'Workflow menu', exact: true }).click();
  await writer.focus();
  await writer.press('ArrowRight');
  await expect(writer).toHaveAttribute('transform', 'translate(70,80)');
  const bounds = await writer.boundingBox();
  expect(bounds).not.toBeNull();
  await page.mouse.move(bounds!.x + 80, bounds!.y + 40);
  await page.mouse.down();
  await page.mouse.move(bounds!.x + 120, bounds!.y + 70, { steps: 4 });
  await page.mouse.up();
  await expect(writer).toHaveAttribute('transform', 'translate(110,110)');
  await writer.click();
  await editor.getByRole('menuitem', { name: 'Configure node' }).click();
  await editor.getByLabel('Agent role', { exact: true }).fill('Write precise tickets with verified evidence.');
  await editor.getByLabel('Runtime provider', { exact: true }).selectOption('codex');
  await editor.getByLabel('Definition type', { exact: true }).selectOption('prompts');
  await editor.getByLabel('Definition', { exact: true }).selectOption('prompt');
  await editor.getByLabel('Prompt template', { exact: true }).fill('Draft {{request}} for {{audience}}');
  await openWorkflow(page);
  await expect(editor.getByRole('heading', { name: 'Fix workflow validation errors' })).toBeVisible();
  await expect(save).toBeDisabled();
  await configureWriter(page);
  await editor.getByLabel('Definition type', { exact: true }).selectOption('prompts');
  await editor.getByLabel('Definition', { exact: true }).selectOption('prompt');
  await editor.getByLabel('Template variables (comma separated)', { exact: true }).fill('request, audience');
  await editor.getByLabel('Template variables (comma separated)', { exact: true }).blur();
  await openWorkflow(page);
  await expect(editor.getByRole('heading', { name: 'Design is structurally valid' })).toBeVisible();
  await configureWriter(page);
  await editor.getByLabel('Definition type', { exact: true }).selectOption('skills');
  await editor.getByLabel('Definition', { exact: true }).selectOption('skill');
  await editor.getByLabel('Skill instructions (Markdown)', { exact: true }).fill('Preserve requirements and report unknowns.');
  await editor.getByLabel('Definition type', { exact: true }).selectOption('hooks');
  await editor.getByLabel('Definition', { exact: true }).selectOption('hook');
  await editor.getByLabel('Hook script (inactive)', { exact: true }).fill('echo "manual authorization needed"');
  await editor.getByText('Connections (2)', { exact: true }).click();
  await editor.getByRole('button', { name: 'Remove connection 1' }).click();
  await openWorkflow(page);
  await expect(save).toBeDisabled();
  await configureWriter(page);
  await editor.getByLabel('Connect from', { exact: true }).selectOption('writer');
  await editor.getByLabel('Connect to', { exact: true }).selectOption('check');
  await editor.getByRole('button', { name: 'Connect steps' }).click();
  await editor.getByRole('button', { name: '+ Add element', exact: true }).click();
  await editor.getByRole('button', { name: 'Add approval step' }).click();
  await expect(graph.getByRole('button', { name: 'approval: Human approval' })).toBeVisible();
  await editor.getByRole('button', { name: 'Remove step', exact: true }).click();
  await expect(graph.getByRole('button', { name: 'approval: Human approval' })).toHaveCount(0);
  await openWorkflow(page);
  await save.click();
  await expect(editor.getByText('Draft saved.', { exact: true })).toBeVisible();
  expect(saves[0].draft.nodes[0].x).toBe(110);
  expect(saves[0].draft.nodes[0].y).toBe(110);
  expect(saves[0].draft.agents[0].provider).toBe('codex');
  expect(saves[0].draft.skills[0].instructions).toContain('report unknowns');
  await editor.getByRole('button', { name: 'Publish saved draft' }).click();
  await expect(editor.getByLabel('Published version').locator('option')).toHaveCount(2);
  const firstVersion = states.get('ticket-authoring')!.versions[0];
  await editor.getByLabel('Workflow name', { exact: true }).fill('Ticket pipeline v2');
  await save.click();
  await editor.getByRole('button', { name: 'Publish saved draft' }).click();
  await expect(editor.getByLabel('Published version').locator('option')).toHaveCount(3);
  await editor.getByLabel('Published version').selectOption(firstVersion.id);
  await editor.getByRole('button', { name: 'Select as default' }).click();
  await expect(editor.getByText('Default version restored.', { exact: false })).toBeVisible();
  await expect(editor.getByLabel('Workflow name', { exact: true })).toHaveValue('Ticket pipeline v2');
  await editor.getByRole('button', { name: 'Preview launch snapshot' }).click();
  await expect(editor.locator('pre')).toContainText('Ticket pipeline v1');
  expect(states.get('ticket-authoring')!.versions[1]).toEqual(firstVersion);
  await editor.getByRole('button', { name: 'Copy version to draft' }).click();
  await expect(editor.getByLabel('Workflow name', { exact: true })).toHaveValue('Ticket pipeline v1');
  await save.click();
  await expect(editor.getByText('Draft saved.', { exact: true })).toBeVisible();
  await expect(editor.getByLabel('Published version').locator('option')).toHaveCount(3);
  await editor.getByLabel('Application scope').selectOption('wiki');
  await expect(editor.getByLabel('Workflow name', { exact: true })).toHaveValue('Authoring');
  await expect(editor.getByLabel('Published version').locator('option')).toHaveCount(1);
});

test('workflow editor preserves the local draft on revision conflicts', async ({ page }) => {
  await page.route('**/api/board/projects', (route) => route.fulfill({ json: [{ ...project, revision: 0, stats: {
    totalTasks: 0, completedTasks: 0, inProgressTasks: 0, completionRate: 0, totalFeatures: 0,
  } }] }));
  await page.route('**/api/board/workflow-editor/*', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: { scope: 'ticket-authoring', revision: 2, draft: documentFixture(), selectedVersionId: null, versions: [] } });
    } else await route.fulfill({ status: 409, json: { error: 'Workflow changed elsewhere. Reload explicitly.' } });
  });

  await page.goto(`/projects/${project.id}/workflows`);
  await openWorkflow(page);
  await page.getByLabel('Workflow name', { exact: true }).fill('My unsaved draft');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Workflow changed elsewhere');
  await expect(page.getByLabel('Workflow name', { exact: true })).toHaveValue('My unsaved draft');
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByLabel('Application scope').selectOption('wiki');
  await expect(page.getByLabel('Application scope')).toHaveValue('ticket-authoring');
  await expect(page.getByLabel('Workflow name', { exact: true })).toHaveValue('My unsaved draft');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Exit fullscreen', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Workflows', exact: true })).toBeVisible();
});

test('studio integrates editable nodes with palette, inspector, scaled dragging and a responsive dock', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    let saved = documentFixture();
    await page.route('**/api/board/projects', (route) => route.fulfill({ json: [{ ...project, revision: 0, stats: {
      totalTasks: 0, completedTasks: 0, inProgressTasks: 0, completionRate: 0, totalFeatures: 0,
    } }] }));
    await page.route('**/api/board/workflow-editor/*', async (route) => {
      if (route.request().method() === 'PUT') saved = route.request().postDataJSON().document;
      await route.fulfill({ json: { scope: 'ticket-authoring', revision: 1, draft: saved, selectedVersionId: null, versions: [] } });
    });
    await page.goto(`/projects/${project.id}/workflows`);
    const editor = page.getByRole('region', { name: 'Agent workflow editor' });
    const palette = editor.getByRole('complementary', { name: 'Workflow palette' });
    const inspector = editor.getByRole('complementary', { name: 'Node inspector' });
    const graph = editor.getByRole('group', { name: 'Workflow graph' });
    await expect(palette).toBeHidden();
    await expect(inspector).toBeHidden();
    await expect(editor.getByRole('region', { name: 'Workflow controls' })).toBeHidden();
    await expect(graph.getByRole('button', { pressed: true })).toHaveCount(0);
    const canvasBounds = await editor.getByLabel('Canvas viewport').boundingBox();
    expect(canvasBounds!.height).toBe(1000);
    await page.screenshot({ path: testInfo.outputPath('studio-clean-desktop.png'), fullPage: true });
    await editor.getByRole('button', { name: '+ Add element', exact: true }).click();
    const paletteBounds = await palette.boundingBox();
    expect(paletteBounds!.x).toBeGreaterThan(canvasBounds!.x);
    expect(paletteBounds!.x + paletteBounds!.width).toBeLessThan(canvasBounds!.x + canvasBounds!.width);
    await editor.getByRole('button', { name: 'Close add element' }).click();
    const workspaceBounds = await editor.boundingBox();
    expect(workspaceBounds!.x).toBe(0);
    expect(workspaceBounds!.y).toBe(0);
    expect(workspaceBounds!.width).toBe(1440);
    expect(workspaceBounds!.height).toBe(1000);
    await expect(page.getByRole('button', { name: 'Switch to Kanban Board view' })).toBeHidden();
    const writer = graph.getByRole('button', { name: 'agent: Writer' });
    await writer.click();
    await expect(inspector).toBeHidden();
    await expect(editor.getByRole('menu', { name: 'Node actions' })).toBeVisible();
    await editor.getByRole('menuitem', { name: 'Configure node' }).click();
    await inspector.getByLabel('Step label', { exact: true }).fill('Ticket architect');
    await expect(graph.getByRole('button', { name: 'agent: Ticket architect' })).toBeVisible();
    await inspector.getByRole('button', { name: 'Edit linked prompt' }).click();
    await inspector.getByLabel('Prompt template', { exact: true }).fill('Review {{request}} carefully.');
    await editor.getByRole('button', { name: 'Zoom out', exact: true }).click();
    await expect(editor.getByLabel('Canvas zoom')).toHaveText('90%');
    const architect = graph.getByRole('button', { name: 'agent: Ticket architect' });
    const nodeBounds = await architect.boundingBox();
    expect(nodeBounds).not.toBeNull();
    await page.mouse.move(nodeBounds!.x + 50, nodeBounds!.y + 35);
    await page.mouse.down();
    await page.mouse.move(nodeBounds!.x + 86, nodeBounds!.y + 53, { steps: 4 });
    await page.mouse.up();
    const transform = await architect.getAttribute('transform');
    const coordinates = transform!.match(/translate\(([^,]+),([^)]+)\)/)!;
    expect(Number(coordinates[1])).toBeCloseTo(90, 5);
    expect(Number(coordinates[2])).toBeCloseTo(100, 5);
    await expect(editor.getByRole('menu', { name: 'Node actions' })).toBeHidden();
    await openWorkflow(page);
    await editor.getByRole('button', { name: 'Save draft', exact: true }).click();
    await expect(editor.getByText('Draft saved.', { exact: true })).toBeVisible();
    expect(saved.nodes[0].label).toBe('Ticket architect');
    expect(saved.prompts[0].template).toBe('Review {{request}} carefully.');
    expect(saved.nodes[0].x).toBeCloseTo(90, 5);
    await editor.getByRole('button', { name: 'Workflow menu', exact: true }).click();
    await editor.getByRole('button', { name: 'Fit nodes', exact: true }).click();
    await expect(architect).toBeVisible();
    await editor.getByRole('button', { name: 'Reset view', exact: true }).click();
    await expect(editor.getByLabel('Canvas zoom')).toHaveText('100%');
    const viewport = editor.getByLabel('Canvas viewport');
    const viewportBounds = await viewport.boundingBox();
    await page.mouse.move(viewportBounds!.x + 300, viewportBounds!.y + 250);
    await page.mouse.down();
    await page.mouse.move(viewportBounds!.x + 240, viewportBounds!.y + 210);
    await page.mouse.up();
    await expect.poll(() => viewport.evaluate((element) => element.scrollLeft)).toBeGreaterThan(40);
    await editor.getByRole('button', { name: 'Reset view', exact: true }).click();
    await page.screenshot({ path: testInfo.outputPath('studio-desktop.png'), fullPage: true });
    const dock = page.locator('#workflow-test-dock');
    await expect(dock).toBeHidden();
    await openWorkflow(page);
    await editor.getByRole('button', { name: 'Test & results', exact: true }).click();
    await expect(dock).toContainText('Save and publish a version');
    await editor.getByRole('button', { name: 'Test console & results', exact: false }).click();
    await expect(dock).toBeHidden();
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await architect.click();
    const nodeMenu = editor.getByRole('menu', { name: 'Node actions' });
    const menuBounds = await nodeMenu.boundingBox();
    expect(menuBounds!.x).toBeGreaterThanOrEqual(0);
    expect(menuBounds!.x + menuBounds!.width).toBeLessThanOrEqual(390);
    expect(menuBounds!.y + menuBounds!.height).toBeLessThanOrEqual(844);
    await page.screenshot({ path: testInfo.outputPath('studio-mobile-node-menu.png'), fullPage: true });
    await nodeMenu.getByRole('menuitem', { name: 'Configure node' }).click();
    await inspector.getByLabel('Step label', { exact: true }).fill('Mobile architect');
    await expect(graph.getByRole('button', { name: 'agent: Mobile architect' })).toHaveCount(1);
    await page.screenshot({ path: testInfo.outputPath('studio-mobile.png'), fullPage: true });
    await page.keyboard.press('Escape');
    await expect(inspector).toBeHidden();
    await expect(graph.getByRole('button', { pressed: true })).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('studio-clean-mobile.png'), fullPage: true });
    await openWorkflow(page);
    await editor.getByRole('button', { name: 'Exit fullscreen', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Workflows', exact: true })).toBeVisible();
    await editor.getByRole('button', { name: 'Enter fullscreen', exact: true }).click();
    await editor.getByRole('button', { name: 'Workflow menu', exact: true }).click();
    await configureWriter(page, 'agent: Mobile architect');
    await expect(inspector.getByLabel('Step label', { exact: true })).toHaveValue('Mobile architect');
    await page.keyboard.press('Escape');
    await expect(inspector).toBeHidden();
    await page.keyboard.press('Escape');
    await openWorkflow(page);
    await expect(editor.getByRole('button', { name: 'Enter fullscreen', exact: true })).toBeVisible();
});

test('clean canvas offers keyboard and pointer node actions without opening an inspector on selection', async ({ page }) => {
  let saved = documentFixture();
  await page.route('**/api/board/projects', (route) => route.fulfill({ json: [{ ...project, revision: 0, stats: {
    totalTasks: 0, completedTasks: 0, inProgressTasks: 0, completionRate: 0, totalFeatures: 0,
  } }] }));
  await page.route('**/api/board/workflow-editor/*', async (route) => {
    if (route.request().method() === 'PUT') saved = route.request().postDataJSON().document;
    await route.fulfill({ json: { scope: 'ticket-authoring', revision: 1, draft: saved, selectedVersionId: null, versions: [] } });
  });
  await page.goto(`/projects/${project.id}/workflows`);
  const graph = page.getByRole('group', { name: 'Workflow graph' });
  const writer = graph.getByRole('button', { name: 'agent: Writer', exact: true });
  const actions = page.getByRole('menu', { name: 'Node actions' });
  const inspector = page.getByRole('complementary', { name: 'Node inspector' });
  await writer.click({ button: 'right' });
  await expect(actions).toBeVisible();
  await expect(inspector).toBeHidden();
  await expect(actions.getByRole('menuitem', { name: 'Configure node' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(actions.getByRole('menuitem', { name: 'Duplicate node' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(inspector.getByLabel('Step label', { exact: true })).toHaveValue('Writer copy');
  await expect(page.getByText('Step duplicated. Its definition is shared with the original.', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(inspector).toBeHidden();
  await expect(graph.getByRole('button', { pressed: true })).toHaveCount(0);
  const copy = graph.getByRole('button', { name: 'agent: Writer copy', exact: true });
  await copy.focus();
  await copy.press('Space');
  await actions.getByRole('menuitem', { name: 'Delete node' }).click();
  await expect(copy).toHaveCount(0);
  await writer.click();
  await actions.getByRole('menuitem', { name: 'Connect to another node' }).click();
  await graph.getByRole('button', { name: 'hook: Check' }).click();
  await expect(page.getByRole('alert')).toContainText('existing connection');
  await graph.getByRole('button', { name: 'approval: Review' }).click();
  await expect(page.getByRole('button', { name: 'Cancel connection' })).toBeHidden();
  await expect(actions).toBeHidden();
  const review = graph.getByRole('button', { name: 'approval: Review' });
  await review.focus();
  await review.press('Enter');
  await actions.getByRole('menuitem', { name: 'Connect to another node' }).click();
  await writer.click();
  await expect(page.getByRole('alert')).toContainText('create a cycle');
  await page.getByRole('button', { name: 'Cancel connection' }).click();
  await page.getByRole('button', { name: 'Dismiss error' }).click();
  await writer.click();
  await page.getByLabel('Canvas viewport').click({ position: { x: 1000, y: 450 } });
  await expect(actions).toBeHidden();
  await expect(graph.getByRole('button', { pressed: true })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Workflow controls' })).toBeHidden();
  await writer.click();
  await page.getByRole('button', { name: 'Zoom out', exact: true }).click();
  await expect(actions).toBeHidden();
  await openWorkflow(page);
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.getByText('Draft saved.', { exact: true })).toBeVisible();
  expect(saved.nodes).toHaveLength(3);
  expect(saved.agents).toHaveLength(1);
  expect(saved.edges).toEqual([...documentFixture().edges, { from: 'writer', to: 'review' }]);
  await page.getByRole('button', { name: 'Workflow menu', exact: true }).click();
  for (const name of ['approval: Review', 'hook: Check']) {
    await graph.getByRole('button', { name, exact: true }).click();
    await actions.getByRole('menuitem', { name: 'Delete node' }).click();
  }
  await writer.click();
  await expect(actions.getByRole('menuitem', { name: 'Delete node' })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(graph.getByRole('button', { pressed: true })).toHaveCount(0);
  await page.getByRole('button', { name: '+ Add element', exact: true }).click();
  await page.getByRole('button', { name: 'Manage definitions' }).click();
  await inspector.getByLabel('Definition type', { exact: true }).selectOption('skills');
  await inspector.getByRole('button', { name: 'Add definition' }).click();
  await expect(inspector.getByLabel('Definition name', { exact: true })).toHaveValue('New skill');
  await page.keyboard.press('Escape');
  await expect(inspector).toBeHidden();
});
