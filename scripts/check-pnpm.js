#!/usr/bin/env node
'use strict';

/*
 * This repository is pnpm-only.
 * npm / yarn / bun are NOT supported, NOT tolerated, and NOT allowed.
 * Any attempt to use them will be treated as a hard error.
 */

const ua = process.env.npm_config_user_agent || '';
const execPath =
  process.env.npm_execpath ||
  process.env.NPM_EXECPATH ||
  process.argv[0] ||
  '';

const isPnpm =
  /\bpnpm\b/.test(ua) ||
  /\bpnpm\b/.test(execPath);

if (!isPnpm) {
  console.error(`
\x1b[31mFATAL ERROR\x1b[0m

This repository is \x1b[1mSTRICTLY pnpm-only\x1b[0m.

Detected package manager:
  user-agent : ${ua || '(unknown)'}
  exec path  : ${execPath || '(unknown)'}

npm, yarn, bun, and any non-pnpm toolchains are
\x1b[31mABSOLUTELY FORBIDDEN\x1b[0m in this project.

There is no fallback.
There is no bypass.
There is no exception.
If you don't have pnpm, check the packageManager field on the package.json, and use npm i -g pnpm.

If you are seeing this error, you are using the wrong tool.

Correct usage:
  pnpm install

Anything else is invalid.
`);
  process.exit(1);
}

// pnpm detected — continue silently
process.exit(0);
