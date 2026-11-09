import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import {
  ASSISTANT_PLANNING_SKILL, AUTO_ASSISTANT_AGENT, PLAN_ASSISTANT_AGENT,
  assistantAgentName, assistantModeConfiguration, parseAssistantOutput,
} from './assistantModes';
import { BUNDLED_SKILLS_DIRECTORY } from './graphifySkill';

const proposalSchema = z.object({ content: z.string().min(1) });
const plan = JSON.stringify({ kind: 'plan', plan: '1. Restructure the page.', reason: 'Most content changes.' });
const proposal = JSON.stringify({ kind: 'proposal', content: '# Page' });

test('auto mode and approved plans use the auto agent; plan mode starts with the planner', () => {
  assert.equal(assistantAgentName({ mode: 'auto' }), AUTO_ASSISTANT_AGENT);
  assert.equal(assistantAgentName({ mode: 'plan' }), PLAN_ASSISTANT_AGENT);
  assert.equal(assistantAgentName({ mode: 'plan', approvedPlan: 'Plan' }), AUTO_ASSISTANT_AGENT);
  const config = assistantModeConfiguration({ mode: 'plan' }, 'wiki page');
  assert.equal(config.agent, PLAN_ASSISTANT_AGENT);
  assert.deepEqual(config.skillDirectories, [BUNDLED_SKILLS_DIRECTORY]);
  assert.equal(config.enableConfigDiscovery, false);
  assert.ok(config.customAgents.every((agent) => agent.infer === false && agent.skills?.includes(ASSISTANT_PLANNING_SKILL)));
  assert.match(config.customAgents[0].prompt, /AUTO MODE/);
  assert.match(config.customAgents[1].prompt, /PLAN MODE/);
});

test('the bundled planning skill is discoverable by name and documents when to plan', async () => {
  const skill = await readFile(path.join(BUNDLED_SKILLS_DIRECTORY, ASSISTANT_PLANNING_SKILL, 'SKILL.md'), 'utf8');
  assert.match(skill, new RegExp(`^---\\nname: ${ASSISTANT_PLANNING_SKILL}\\ndescription: ".+"\\n---\\n`));
  assert.match(skill, /## When a plan is needed/);
  assert.match(skill, /approvedPlan/);
});

test('output parsing enforces the requested mode', () => {
  assert.deepEqual(parseAssistantOutput(proposal, proposalSchema, { mode: 'auto' }, 'wiki proposal'), { kind: 'proposal', content: '# Page' });
  assert.deepEqual(parseAssistantOutput('{"content":"# Legacy"}', proposalSchema, { mode: 'auto' }, 'wiki proposal'), { kind: 'proposal', content: '# Legacy' });
  assert.equal(parseAssistantOutput(plan, proposalSchema, { mode: 'auto' }, 'wiki proposal').kind, 'plan');
  assert.equal(parseAssistantOutput(plan, proposalSchema, { mode: 'plan' }, 'wiki proposal').kind, 'plan');
  assert.throws(() => parseAssistantOutput(proposal, proposalSchema, { mode: 'plan' }, 'wiki proposal'), { status: 502, message: /requested plan/ });
  assert.throws(() => parseAssistantOutput(plan, proposalSchema, { mode: 'plan', approvedPlan: 'Plan' }, 'wiki proposal'), { status: 502, message: /another plan/ });
  assert.equal(parseAssistantOutput(proposal, proposalSchema, { mode: 'plan', approvedPlan: 'Plan' }, 'wiki proposal').kind, 'proposal');
  for (const raw of [undefined, ' ', 'not JSON', '{"kind":"plan","plan":""}', '{"kind":"proposal"}']) {
    assert.throws(() => parseAssistantOutput(raw, proposalSchema, { mode: 'auto' }, 'wiki proposal'), { status: 502 });
  }
});
