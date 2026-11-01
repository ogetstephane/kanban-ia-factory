import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { agentContextSchema } from '../../src/types/agent';

test('Copilot can inspect a fixture and implement only with execution tools', {
  skip: process.env.COPILOT_LIVE_TEST !== '1',
  timeout: 180_000,
}, async () => {
  const { CopilotProvider } = await import('./copilotProvider');
  const workspace = await mkdtemp(path.join(tmpdir(), 'kanban-copilot-live-'));
  const marker = randomUUID();
  const now = new Date().toISOString();
  try {
    await writeFile(path.join(workspace, 'README.md'), `Verification marker: ${marker}\n`);
    await writeFile(path.join(workspace, 'package.json'), JSON.stringify({
      private: true, scripts: { test: 'node -e "console.log(\'fixture check passed\')"' },
    }));
    const context = agentContextSchema.parse({
      project: null, feature: null,
      task: {
        id: 'fixture', title: 'Read README.md, include its verification marker in the plan, then copy that marker into result.txt after approval',
        description: 'Do not write during planning. First ask the user with ticket_ask_user which output filename to use, offering result.txt and other.txt. After implementation, run npm test using ticket_run_checks. This is a throwaway fixture.',
        status: 'In Progress', priority: 'Medium', tags: [], acceptanceCriteria: ['result.txt contains the marker from README.md'],
        subtasks: [], order: 0, storyPoints: 1, createdAt: now, updatedAt: now,
      },
    });
    const ids: string[] = [];
    const provider = new CopilotProvider();
    const onSession = async (id: string) => { ids.push(id); };
    let questions = 0;
    const ask = async () => { questions++; return 'result.txt'; };
    const plan = await provider.run({ context, workspace, phase: 'plan', plan: '', onSession, ask, answers: [] });
    assert.ok(plan.includes(marker), `Planning must read the fixture using the registered tool: ${plan}`);
    assert.ok(questions > 0, 'Copilot must route clarification through the provider-neutral ask callback');
    await assert.rejects(readFile(path.join(workspace, 'result.txt')));
    const checks: { script: 'test' | 'lint'; passed: boolean; output: string }[] = [];
    const output = await provider.run({
      context, workspace, phase: 'execute', plan, onSession, ask,
      answers: [{ question: 'Output filename?', answer: 'result.txt' }],
      recordCheck: async (result) => { checks.push(result); },
    });
    assert.ok(output.trim());
    assert.equal((await readFile(path.join(workspace, 'result.txt'), 'utf8')).trim(), marker);
    assert.equal(ids.length, 2);
    assert.ok(checks.some((check) => check.script === 'test' && check.passed && check.output.includes('fixture check passed')), 'Copilot must persist structured check outcomes');
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
