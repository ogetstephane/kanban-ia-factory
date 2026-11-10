import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nativeAnalysisArguments } from './test-analysis-native.mjs';

export function liveAnalysisArguments(root, executable) {
  const args = nativeAnalysisArguments(root, executable);
  const commandIndex = args.lastIndexOf('/usr/bin/node');
  args.splice(commandIndex, args.length - commandIndex,
    '/usr/bin/node', '--import', 'tsx', 'server/agents/copilotAnalysisLive.test.ts');
  args.splice(0, 0,
    '--share-net',
    '--ro-bind', '/etc/resolv.conf', '/etc/resolv.conf',
    '--ro-bind', '/etc/ssl/certs', '/etc/ssl/certs',
    '--ro-bind', path.join(root, 'server/agents/copilotAnalysisLive.test.ts'), '/app/server/agents/copilotAnalysisLive.test.ts',
  );
  // --share-net must follow --unshare-all so only network isolation is relaxed.
  args.splice(args.indexOf('--share-net'), 1);
  args.splice(args.indexOf('--unshare-all') + 1, 0, '--share-net');
  args.splice(args.lastIndexOf('/usr/bin/node'), 0, '--setenv', 'COPILOT_ANALYSIS_LIVE_TEST', '1');
  return args;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  if (process.platform !== 'linux' || Number(process.versions.node.split('.')[0]) < 22) {
    console.error('Live cancellation requires Linux, bubblewrap and Node 22+. Use make test-analysis-live.');
    process.exitCode = 1;
  } else if (!process.env.COPILOT_ANALYSIS_MODEL?.trim()) {
    console.error('Select the live-test model explicitly: COPILOT_ANALYSIS_MODEL=<id> make test-analysis-live.');
    process.exitCode = 1;
  } else {
    // Capture only the token: never print it or place it in arguments or files.
    const auth = spawnSync('gh', ['auth', 'token', '--hostname', 'github.com'], { encoding: 'utf8', timeout: 10_000 });
    if (auth.error || auth.status !== 0 || !auth.stdout.trim()) {
      console.error('GitHub CLI authentication is required. Authenticate with gh auth login before this opt-in test.');
      process.exitCode = 1;
    } else {
      const root = fileURLToPath(new URL('../', import.meta.url));
      const result = spawnSync('bwrap', liveAnalysisArguments(root, process.execPath), {
        stdio: ['pipe', 'inherit', 'inherit'], timeout: 120_000, env: {},
        input: JSON.stringify({ token: auth.stdout.trim(), model: process.env.COPILOT_ANALYSIS_MODEL }),
      });
      if (result.error || result.signal || result.status !== 0) {
        console.error(`Live cancellation failed: ${result.error?.message ?? result.signal ?? `exit ${result.status}`}`);
        process.exitCode = 1;
      }
    }
  }
}
