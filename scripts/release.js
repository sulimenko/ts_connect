'use strict';

const { spawnSync } = require('node:child_process');

const rawVersion = process.argv[2];
const isWindows = process.platform === 'win32';

if (!rawVersion) {
  console.error('Usage: npm run release -- <version>');
  process.exit(1);
}

const version = rawVersion.trim();
const tag = version;

if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
  console.error(`Invalid version: ${rawVersion}`);
  process.exit(1);
}

const resolveCommand = (command) => {
  if (!isWindows) return command;
  if (command === 'npm') return 'npm.cmd';
  return command;
};

const run = (command, args, options = {}) => {
  const result = spawnSync(resolveCommand(command), args, {
    stdio: 'inherit',
    ...options,
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
};

const capture = (command, args) => {
  const result = spawnSync(resolveCommand(command), args, {
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    process.stderr.write(result.stderr ?? '');
    process.exit(result.status ?? 1);
  }
  return (result.stdout ?? '').trim();
};

const status = capture('git', ['status', '--short']);
if (status) {
  console.error('Git worktree must be clean before release.');
  process.exit(1);
}

const existingTag = capture('git', ['tag', '--list', tag]);
if (existingTag) {
  console.error(`Git tag already exists: ${tag}`);
  process.exit(1);
}

run('npm', ['test']);
run('npm', ['version', version, '--no-git-tag-version']);
run('git', ['add', 'package.json', 'package-lock.json']);
run('git', ['commit', '-m', `release: ${version}`]);
run('git', ['tag', tag]);
run('git', ['push', 'origin', 'HEAD', '--follow-tags']);
