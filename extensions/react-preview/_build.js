#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const distDir = process.argv[2];
if (!distDir) {
  console.error('Usage: node _build.js <distDir>');
  process.exit(1);
}

try {
  fs.mkdirSync(distDir, { recursive: true });
} catch (e) {
  // ignore
}

const destWasm = path.join(distDir, 'esbuild.wasm');
if (fs.existsSync(destWasm)) {
  console.log(`esbuild.wasm already present at ${destWasm}`);
  process.exit(0);
}

let resolvedWasm = null;
try {
  resolvedWasm = require.resolve('esbuild-wasm/esbuild.wasm');
} catch (e) {
  try {
    const pkgEntry = require.resolve('esbuild-wasm');
    const pkgDir = path.dirname(pkgEntry);
    const candidate = path.join(pkgDir, '..', 'esbuild.wasm');
    if (fs.existsSync(candidate)) resolvedWasm = candidate;
  } catch (e2) {
    // ignore
  }
}

if (resolvedWasm && fs.existsSync(resolvedWasm)) {
  try {
    fs.copyFileSync(resolvedWasm, destWasm);
    console.log(`📦 Copied esbuild.wasm to ${path.relative(process.cwd(), destWasm)}`);
  } catch (e) {
    console.error('❌ Failed to copy esbuild.wasm:', e && e.message ? e.message : e);
    process.exit(1);
  }
} else {
  console.log('⚠️  esbuild.wasm not found in node_modules; place esbuild.wasm into the extension source if you want to ship it with the extension.');
}

process.exit(0);
