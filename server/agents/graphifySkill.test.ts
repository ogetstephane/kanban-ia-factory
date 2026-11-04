import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CopilotClient } from '@github/copilot-sdk';
import { GRAPHIFY_SKILL_DIRECTORY, GRAPHIFY_SKILL_INSTRUCTION, GRAPHIFY_SKILL_NAME, graphifySkillConfiguration } from './graphifySkill';

test('the bundled skill is discoverable and covers drafting and all ticket phases', async () => {
  const skill = await readFile(path.join(GRAPHIFY_SKILL_DIRECTORY, GRAPHIFY_SKILL_NAME, 'SKILL.md'), 'utf8');
  assert.match(skill, /^---\nname: ticket-graphify\ndescription: ".+"\n---\n/);
  for (const phase of ['Draft', 'Plan', 'Execute', 'Review']) assert.ok(skill.includes(`**${phase}:**`));
  for (const tool of ['query', 'explain', 'path', 'affected']) assert.ok(skill.includes(`ticket_graph_${tool}`));
  assert.match(skill, /If graph tools are absent or a query fails/);
  assert.ok(GRAPHIFY_SKILL_INSTRUCTION.length < 200, 'only a short activation pointer belongs in the initial prompt');
  const configuration = graphifySkillConfiguration([]);
  assert.deepEqual(configuration.availableTools, ['skill']);
  assert.equal(configuration.enableConfigDiscovery, false);
  assert.equal(configuration.skipCustomInstructions, true);
  assert.equal(configuration.enableSkills, true);
  assert.doesNotMatch(JSON.stringify(configuration), /## Workflow|## Scope/);
});

test('native SDK loads the bundled skill on demand without an LLM request', {
  skip: process.env.COPILOT_SKILL_TEST !== '1', timeout: 60_000,
}, async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'kanban-skill-test-'));
  const repositorySkill = path.join(directory, '.github', 'skills', GRAPHIFY_SKILL_NAME);
  await mkdir(repositorySkill, { recursive: true });
  await writeFile(path.join(repositorySkill, 'SKILL.md'), '---\nname: ticket-graphify\ndescription: Repository replacement\n---\nUNTRUSTED_REPOSITORY_SKILL');
  const client = new CopilotClient();
  let sessionId: string | undefined;
  t.after(async () => {
    try { if (sessionId) await client.deleteSession(sessionId); }
    finally {
      await client.stop();
      await rm(directory, { recursive: true, force: true });
    }
  });
  await client.start();
  const session = await client.createSession({
    ...graphifySkillConfiguration([]),
    workingDirectory: directory,
    enableSessionStore: false,
    enableHostGitOperations: false,
    systemMessage: { mode: 'replace', content: GRAPHIFY_SKILL_INSTRUCTION },
  });
  sessionId = session.sessionId;
  await session.rpc.tools.initializeAndValidate();
  const metadata = await session.rpc.tools.getCurrentMetadata();
  assert.deepEqual(metadata.tools?.map((tool) => tool.name), ['skill']);
  const loaded = await session.rpc.tools.execute({ name: 'skill', arguments: { skill: GRAPHIFY_SKILL_NAME } });
  assert.match(JSON.stringify(loaded), /Ticket Graphify analysis/);
  assert.doesNotMatch(JSON.stringify(loaded), /UNTRUSTED_REPOSITORY_SKILL/);
  const refused = await session.rpc.tools.execute({ name: 'skill', arguments: { skill: 'untrusted-skill' } });
  assert.match(JSON.stringify(refused), /Only the bundled ticket-graphify skill/);
});
