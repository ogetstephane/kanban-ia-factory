import { expect, test } from '@playwright/test';
import { agentSession, feature, project, release, tasks } from '../src/components/stories/fixtures';
import { projectSummarySchema } from '../shared/types/board';
import { agentRuntimeSchema } from '../shared/types/agent';
import { calculateProjectStats } from '../src/utils/projectLogic';

for (const phase of ['plan', 'execute', 'review'] as const) {
test(`streams ${phase} activity in the matching step and preserves interaction state`, async ({ page }) => {
  const { doneTasks, ...stats } = calculateProjectStats(project.id, tasks, [feature]);
  const projectSummary = projectSummarySchema.parse({
    ...project, repositoryUrl: undefined, repositoryBranch: undefined,
    stats: { ...stats, completedTasks: doneTasks },
  });
  const timestamp = '2026-11-04T10:00:00Z';
  const step = phase === 'plan' ? 'Plan' : phase === 'execute' ? 'Execution' : 'Review';
  const phaseLabel = phase === 'plan' ? 'planning' : phase === 'execute' ? 'execution' : 'ai review';
  const status = phase === 'plan' ? 'planning' : phase === 'execute' ? 'executing' : 'completed';
  const toolName = phase === 'execute' ? 'ticket_write_file' : 'ticket_read_file';
  const toolLabel = phase === 'execute' ? 'Write file' : 'Read file';
  const reads = Array.from({ length: 25 }, (_, index) => [
    { id: `start-${index}`, type: 'tool.execution_start', timestamp, data: {
      toolCallId: `read-${index}`, toolName: 'ticket_read_file', arguments: { path: `src/file-${index}.ts` },
    } },
    { id: `done-${index}`, type: 'tool.execution_complete', timestamp, data: {
      toolCallId: `read-${index}`, success: true, result: { content: 'File read' },
    } },
  ]).flat();
  const initialEvents = [
    { id: 'reason', type: 'assistant.reasoning', timestamp, data: { reasoningId: 'reason', content: 'Checking the implementation.' } },
    { id: 'message', type: 'assistant.message_delta', timestamp, data: { messageId: 'message', deltaContent: 'Inspecting the project.' } },
    ...reads,
    { id: 'write', type: 'tool.execution_start', timestamp, data: {
      toolCallId: 'write', toolName, arguments: { path: 'src/changed.ts', ...(phase === 'execute' ? { content: 'export const ok = true;' } : {}) },
    } },
  ];
  const updatedEvents = [
    ...initialEvents,
    { id: 'write-done', type: 'tool.execution_complete', timestamp, data: {
      toolCallId: 'write', success: true, result: { detailedContent: 'Saved successfully.' },
    } },
    { id: 'message-delta', type: 'assistant.message_delta', timestamp, data: { messageId: 'message', deltaContent: ' Changes are ready.' } },
  ];
  let releaseUpdate = false;
  const session = (updated: boolean) => ({
    ...agentSession, status, resumeStatus: phase === 'plan' ? 'planning' : 'executing', workspace: null,
    plan: phase === 'plan' ? updated ? 'Inspecting the project. Changes are ready.' : 'Inspecting the project.' : agentSession.plan,
    output: phase === 'execute' ? updated ? 'Inspecting the project. Changes are ready.' : 'Inspecting the project.' : '',
    runtimes: [agentRuntimeSchema.parse({
      id: 'live-runtime', phase, providerSessionId: 'live', status: 'running',
      startedAt: timestamp, endedAt: null, error: '', metadata: {},
      events: updated ? updatedEvents : initialEvents,
    })],
  });

  page.on('pageerror', (error) => { throw error; });
  page.on('console', (message) => {
    if (message.type() === 'error') throw new Error(`Browser console error: ${message.text()}`);
  });
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/board/projects') return route.fulfill({ json: [projectSummary] });
    if (path === `/api/board/projects/${project.id}/board`) return route.fulfill({ json: { features: [feature], tasks } });
    if (path === `/api/board/projects/${project.id}/releases`) return route.fulfill({ json: [release] });
    if (path === '/api/board/agent-options') return route.fulfill({ json: {
      providers: [{ id: 'copilot', name: 'GitHub Copilot', defaultModel: null, models: [] }],
    } });
    if (path === '/api/board/agent-sessions') return route.fulfill({ json: {
      items: [{
        ...agentSession, status, resumeStatus: phase === 'plan' ? 'planning' : 'executing',
        taskTitle: tasks[0].title, taskStatus: tasks[0].status, priority: tasks[0].priority,
        projectName: project.name, featureId: feature.id, featureTitle: feature.title,
      }],
      total: 1, page: 1, pageSize: 25, actionCount: 0,
      projects: [{ id: project.id, name: project.name }],
      features: [{ id: feature.id, title: feature.title, projectId: project.id }],
    } });
    if (path === `/api/board/tasks/${agentSession.taskId}/session`) return route.fulfill({ json: session(releaseUpdate) });
    if (path === `/api/board/tasks/${agentSession.taskId}/session/history`) return route.fulfill({ json: [] });
    throw new Error(`Unexpected API request: ${path}`);
  });

  await page.goto(`/projects/${project.id}/sessions`);
  const panel = page.getByRole('region', { name: `${step} step`, exact: true });
  const feed = panel.getByRole('log', { name: `Copilot ${phaseLabel} activity feed` });
  await expect(feed).toBeVisible();
  await expect(page.getByText('Live · refreshes every 2 seconds')).toBeVisible();
  await expect.poll(() => feed.evaluate((element) =>
    element.scrollHeight - element.scrollTop - element.clientHeight)).toBeLessThan(2);
  await expect(feed.getByText('Checking the implementation.')).toHaveCount(0);
  await feed.getByText('Reasoning', { exact: true }).click();
  await expect(feed.getByText('Checking the implementation.')).toBeVisible();

  const write = feed.locator('details').filter({ hasText: toolLabel }).filter({ hasText: 'src/changed.ts' });
  await expect(write).toContainText('Running');
  await write.locator('summary').click();
  await expect(write).toHaveAttribute('open', '');
  await expect(write).toContainText('src/changed.ts');

  await feed.evaluate((element) => { element.scrollTop = 0; element.dispatchEvent(new Event('scroll')); });
  await expect(page.getByRole('button', { name: 'Jump to latest' })).toBeVisible();
  releaseUpdate = true;
  await expect(feed.getByText('Inspecting the project. Changes are ready.')).toBeVisible({ timeout: 10_000 });
  await expect(write).toHaveAttribute('open', '');
  await expect(write).toContainText('Completed');
  await expect(write).toContainText('Saved successfully.');
  await expect.poll(() => feed.evaluate((element) => element.scrollTop)).toBeLessThan(2);

  await page.getByRole('button', { name: 'Jump to latest' }).click();
  await expect.poll(() => feed.evaluate((element) =>
    element.scrollHeight - element.scrollTop - element.clientHeight)).toBeLessThan(2);
  await expect(page.getByRole('button', { name: 'Jump to latest' })).toHaveCount(0);

  await page.goto(`/projects/${project.id}/tasks/${agentSession.taskId}/edit`);
  const taskFeed = page.getByRole('region', { name: `${step} step`, exact: true })
    .getByRole('log', { name: `Copilot ${phaseLabel} activity feed` });
  await expect(taskFeed.getByText('Inspecting the project. Changes are ready.')).toBeVisible();
  await expect(taskFeed.locator('details').filter({ hasText: 'src/changed.ts' })).toContainText('Completed');
});
}
