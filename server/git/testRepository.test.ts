import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createSourceRepository, TEST_GIT_CONFIG } from './testRepository';

test('Git fixtures ignore ambient signing without modifying user configuration or opening an editor', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'kanban-test-git-'));
  const configuration = path.join(directory, 'gitconfig');
  const contents = '[commit]\n\tgpgsign = true\n[tag]\n\tgpgsign = true\n[core]\n\teditor = false\n[gpg]\n\tprogram = /nonexistent/kanban-test-signer\n';
  await writeFile(configuration, contents);
  const previous = process.env.GIT_CONFIG_GLOBAL;
  process.env.GIT_CONFIG_GLOBAL = configuration;
  t.after(async () => {
    if (previous === undefined) delete process.env.GIT_CONFIG_GLOBAL;
    else process.env.GIT_CONFIG_GLOBAL = previous;
    await rm(directory, { recursive: true, force: true });
  });
  const source = await createSourceRepository(path.join(directory, 'source'));
  const git = (...args: string[]) => execFileSync('git', args, {
    cwd: source.url, encoding: 'utf8', timeout: 5000,
  }).trim();
  assert.equal(git('config', '--get', 'tag.gpgsign'), 'true');
  assert.equal(git('config', '--get', 'commit.gpgsign'), 'true');
  git(...TEST_GIT_CONFIG, 'tag', 'fixture-tag');
  assert.equal(git('cat-file', '-t', 'refs/tags/fixture-tag'), 'commit');
  assert.doesNotMatch(git('cat-file', '-p', 'HEAD'), /^gpgsig /m);
  assert.equal(await readFile(configuration, 'utf8'), contents);
});
