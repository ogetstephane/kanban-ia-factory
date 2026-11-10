import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { claudeNativeAnalysisArguments } from './test-analysis-claude-native.mjs';

export function claudePreparationArguments(root, executable, arguments_) {
  if (arguments_.length !== 1 || arguments_[0] !== '--prepare') {
    throw new Error('Only --prepare is available. Paid execution is blocked: a strict billing ceiling is not established; SDK maxBudgetUsd is not a guaranteed billing cap.');
  }
  return claudeNativeAnalysisArguments(root, executable);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    const root = fileURLToPath(new URL('../', import.meta.url));
    const args = claudePreparationArguments(root, process.execPath, process.argv.slice(2));
    if (process.platform !== 'linux' || Number(process.versions.node.split('.')[0]) < 22) {
      throw new Error('Preparation requires Linux, bubblewrap and Node 22+. Use make test-analysis-claude-prepare.');
    }
    console.log('Offline preparation only: synthetic analysis and active-stream cancellation. No host credentials or external network are passed.');
    const result = spawnSync('bwrap', args, { stdio: 'inherit', timeout: 90_000, env: {} });
    if (result.error || result.signal || result.status !== 0) {
      throw new Error(`Offline preparation failed: ${result.error?.message ?? result.signal ?? `exit ${result.status}`}`);
    }
    console.log('Offline rehearsal passed. Live model execution, live cancellation and billing cessation remain unqualified; paid execution is still blocked.');
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
