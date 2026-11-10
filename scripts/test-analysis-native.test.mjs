import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeAnalysisArguments } from './test-analysis-native.mjs';
import { liveAnalysisArguments } from './test-analysis-live.mjs';
import { claudeNativeAnalysisArguments } from './test-analysis-claude-native.mjs';
import { claudePreparationArguments } from './test-analysis-claude-prepare.mjs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('Claude preparation cannot enable network or paid execution', () => {
  const args = claudePreparationArguments('/fixture/repository', '/fixture/node22', ['--prepare']);
  assert.deepEqual(args, claudeNativeAnalysisArguments('/fixture/repository', '/fixture/node22'));
  for (const arguments_ of [[], ['--run'], ['--prepare', '--run'], ['--prepare', '--budget=1']]) {
    assert.throws(() => claudePreparationArguments('/fixture/repository', '/fixture/node22', arguments_), /Paid execution is blocked/);
  }
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./test-analysis-claude-prepare.mjs', import.meta.url)), '--run'], {
    encoding: 'utf8', timeout: 5000,
    env: { ANTHROPIC_API_KEY: 'synthetic-must-not-be-read-or-disclosed' },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Paid execution is blocked/);
  assert.ok(!`${result.stdout}${result.stderr}`.includes('synthetic-must-not-be-read-or-disclosed'));
});

test('native probe launcher exposes only explicit sources and dependencies, without network or host credentials', () => {
  const args = nativeAnalysisArguments('/fixture/repository', '/fixture/node22');
  for (const flag of ['--unshare-all', '--clearenv', '--die-with-parent', '--new-session']) assert.ok(args.includes(flag));
  assert.ok(!args.includes('--share-net'));
  const bindings = args.flatMap((arg, index) => arg === '--ro-bind' ? [args.slice(index + 1, index + 3)] : []);
  assert.deepEqual(bindings, [
    ['/usr', '/usr'], ['/lib', '/lib'], ['/lib64', '/lib64'],
    ['/fixture/node22', '/usr/bin/node'],
    ['/fixture/repository/package.json', '/app/package.json'],
    ['/fixture/repository/node_modules', '/app/node_modules'],
    ['/fixture/repository/server/agents/core', '/app/server/agents/core'],
    ['/fixture/repository/server/agents/adapters', '/app/server/agents/adapters'],
    ['/fixture/repository/server/agents/copilotAnalysisNative.test.ts', '/app/server/agents/copilotAnalysisNative.test.ts'],
  ]);
  assert.ok(!args.includes('/fixture/repository'));
  assert.ok(!args.some((arg) => arg.includes('.env') || arg.includes('.copilot') || arg.includes('docker.sock')));
  assert.ok(args.includes('--test-timeout=60000'));
});

test('Claude launcher uses the same no-network isolation with only its own probe entrypoint', () => {
  const copilot = nativeAnalysisArguments('/fixture/repository', '/fixture/node22');
  const claude = claudeNativeAnalysisArguments('/fixture/repository', '/fixture/node22');
  assert.deepEqual(claude, copilot.map((argument) => argument
    .replaceAll('copilotAnalysisNative.test.ts', 'claudeAnalysisNative.test.ts')
    .replaceAll('COPILOT_ANALYSIS_', 'CLAUDE_ANALYSIS_')));
  assert.ok(claude.indexOf('CLAUDE_ANALYSIS_NATIVE_TEST') > claude.indexOf('--clearenv'));
  assert.ok(!claude.includes('--share-net'));
});

test('live launcher retains filesystem isolation and only adds explicit API-network prerequisites', () => {
  const args = liveAnalysisArguments('/fixture/repository', '/fixture/node22');
  assert.ok(args.indexOf('--share-net') > args.indexOf('--unshare-all'));
  for (const flag of ['--clearenv', '--die-with-parent', '--new-session']) assert.ok(args.includes(flag));
  assert.ok(args.includes('/etc/resolv.conf'));
  assert.ok(args.includes('/etc/ssl/certs'));
  assert.deepEqual(args.slice(-4), ['/usr/bin/node', '--import', 'tsx', 'server/agents/copilotAnalysisLive.test.ts']);
  assert.ok(!args.some((arg) => arg.includes('.env') || arg.includes('.copilot') || arg.includes('TOKEN')));
  assert.ok(!args.includes('--test'), 'Read ephemeral authentication on stdin in the direct test process.');
  assert.ok(args.indexOf('COPILOT_ANALYSIS_LIVE_TEST') > args.indexOf('--clearenv'),
    'Live opt-in must not be erased by the environment reset.');
});
