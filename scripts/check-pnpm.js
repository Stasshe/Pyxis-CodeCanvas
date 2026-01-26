#!/usr/bin/env node
'use strict';

// Enforce pnpm usage during installs and explicitly disable npm/yarn.
// Run as `preinstall` from package.json. To bypass (not recommended),
// set SKIP_PNPM_CHECK=1 in the environment.

const ua = process.env.npm_config_user_agent || '';
const execPath = process.env.npm_execpath || process.env.NPM_EXECPATH || '';
const skip = process.env.SKIP_PNPM_CHECK === '1';

if (skip) {
  console.warn('SKIP_PNPM_CHECK=1 detected — skipping pnpm enforcement.');
  process.exit(0);
}

const isPnpm = ua.includes('pnpm') || execPath.includes('pnpm');
if (isPnpm) {
  process.exit(0);
}

console.error('\n\u001b[31mERROR:\u001b[0m npm/yarn are disabled for this repository.');
console.error('This project requires pnpm to install dependencies and run scripts.');
console.error('Please run:');
console.error('  pnpm install\n');
console.error('If you absolutely must bypass this check (e.g., special CI), set: SKIP_PNPM_CHECK=1');
console.error('\nOperation aborted to prevent accidental use of npm or yarn.');
process.exit(1);
