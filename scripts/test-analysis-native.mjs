import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function isolatedAnalysisArguments(root, executable, testFile, variables) {
  const args = [
    '--die-with-parent', '--new-session', '--unshare-all', '--clearenv',
    '--ro-bind', '/usr', '/usr', '--ro-bind', '/lib', '/lib',
    '--ro-bind', '/lib64', '/lib64',
    '--ro-bind', executable, '/usr/bin/node',
    '--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp', '--tmpfs', '/home',
    '--dir', '/home/analysis', '--dir', '/app',
  ];
  for (const relative of [
    'package.json', 'node_modules', 'server/agents/core', 'server/agents/adapters',
    testFile,
  ]) args.push('--ro-bind', path.join(root, relative), `/app/${relative}`);
  for (const [name, value] of Object.entries(variables)) args.push('--setenv', name, value);
  return [...args,
    '--setenv', 'PATH', '/usr/bin:/bin', '--setenv', 'HOME', '/home/analysis',
    '--chdir', '/app', '/usr/bin/node', '--import', 'tsx',
    '--test', '--test-timeout=60000', testFile,
  ];
}

export function nativeAnalysisArguments(root, executable) {
  return isolatedAnalysisArguments(root, executable, 'server/agents/copilotAnalysisNative.test.ts', {
    COPILOT_ANALYSIS_NATIVE_TEST: '1', COPILOT_ANALYSIS_ISOLATED: '1',
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  if (process.platform !== 'linux' || Number(process.versions.node.split('.')[0]) < 22) {
    console.error('Native analysis probes require Linux, bubblewrap and Node 22+. Use make test-analysis-native.');
    process.exitCode = 1;
  } else {
    const root = fileURLToPath(new URL('../', import.meta.url));
    const result = spawnSync('bwrap', nativeAnalysisArguments(root, process.execPath), {
      stdio: 'inherit', timeout: 90_000, env: {},
    });
    if (result.error || result.signal || result.status !== 0) {
      console.error(`Isolated native probes failed: ${result.error?.message ?? result.signal ?? `exit ${result.status}`}`);
      process.exitCode = 1;
    }
  }
}
