const { spawnSync } = require('node:child_process');
const path = require('node:path');

// Test-only SSH transport: Git still performs a real tag push to an isolated bare repository.
const command = process.argv.at(-1);
const match = /^git-(upload|receive)-pack '([^']+)'$/.exec(command);
if (!match || !process.env.TEST_RELEASE_REMOTE_ROOT || !process.argv.includes('release.test')) process.exit(1);
const root = path.resolve(process.env.TEST_RELEASE_REMOTE_ROOT);
const directory = path.resolve(match[2]);
if (!directory.startsWith(`${root}${path.sep}`)) process.exit(1);
const result = spawnSync(`git-${match[1]}-pack`, [directory], { stdio: 'inherit' });
process.exit(result.status ?? 1);
