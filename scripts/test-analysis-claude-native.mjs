import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isolatedAnalysisArguments } from './test-analysis-native.mjs';

export function claudeNativeAnalysisArguments(root, executable) {
  return isolatedAnalysisArguments(root, executable, 'server/agents/claudeAnalysisNative.test.ts', {
    CLAUDE_ANALYSIS_NATIVE_TEST: '1', CLAUDE_ANALYSIS_ISOLATED: '1',
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  if (process.platform !== 'linux' || Number(process.versions.node.split('.')[0]) < 22) {
    console.error('Claude native probes require Linux, bubblewrap and Node 22+. Use make test-analysis-claude-native.');
    process.exitCode = 1;
  } else {
    const root = fileURLToPath(new URL('../', import.meta.url));
    const result = spawnSync('bwrap', claudeNativeAnalysisArguments(root, process.execPath), {
      stdio: 'inherit', timeout: 90_000, env: {},
    });
    if (result.error || result.signal || result.status !== 0) {
      console.error(`Isolated Claude probes failed: ${result.error?.message ?? result.signal ?? `exit ${result.status}`}`);
      process.exitCode = 1;
    }
  }
}
