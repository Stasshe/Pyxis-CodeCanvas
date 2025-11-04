#!/usr/bin/env node
"use strict";

// remove_unused_i18n_keys.js
// Scan `src` for used translation keys (t('key')) and remove unused keys
// from JSON files under `locales/**/*.json` (located at the repository root).
// Usage:
//   node scripts/remove_unused_i18n_keys.js --dry-run    # show what would be removed (default)
//   node scripts/remove_unused_i18n_keys.js --apply      # perform removals (creates backups when --backup)
//   node scripts/remove_unused_i18n_keys.js --apply --backup

const fs = require("fs");
const path = require("path");

// Resolve repository root relative to this script so behavior does not depend on
// the current working directory when the script is invoked.
const ROOT = path.resolve(__dirname, '..');

const argv = process.argv.slice(2);
const OPTS = {
  apply: argv.includes("--apply"),
  dryRun: !argv.includes("--apply"),
  backup: argv.includes("--backup"),
  rootDir: ROOT,
};

function log(...args) {
  console.log(...args);
}

async function getFiles(dir, exts) {
  const out = [];
  try {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name === ".git") continue;
        out.push(...(await getFiles(full, exts)));
      } else if (e.isFile()) {
        if (!exts || exts.includes(path.extname(e.name))) out.push(full);
      }
    }
  } catch (e) {
    // ignore missing dirs
  }
  return out;
}

function extractKeysFromSource(content) {
  // match patterns like t('key'), t("key"), t(`key`), i18n.t('key')
  const re = /(?:\b|\.|\s)(?:t|i18n\.t|intl\.t)\s*\(\s*(['"`])((?:\\.|(?!\1).)*?)\1/gms;
  const keys = new Set();
  let m;
  while ((m = re.exec(content)) !== null) {
    const raw = m[2];
    if (raw.includes("${")) continue; // skip template interpolations
    try {
      // decode escape sequences safely
      const normalized = '"' + raw.replace(/\\/g, "\\\\").replace(/\"/g, '\\\"').replace(/\n/g, "\\n") + '"';
      const decoded = JSON.parse(normalized);
      keys.add(decoded);
    } catch (e) {
      keys.add(raw);
    }
  }
  return keys;
}

function flattenKeys(obj, prefix = "") {
  const res = [];
  if (typeof obj !== "object" || obj === null) return res;
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    const newKey = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "object" && v !== null && !Array.isArray(v)) {
      res.push(...flattenKeys(v, newKey));
    } else {
      res.push(newKey);
    }
  }
  return res;
}

function deleteKeyByPath(obj, pathParts) {
  if (!obj || pathParts.length === 0) return false;
  const [head, ...rest] = pathParts;
  if (!(head in obj)) return false;
  if (rest.length === 0) {
    delete obj[head];
    return true;
  }
  const deleted = deleteKeyByPath(obj[head], rest);
  if (deleted && typeof obj[head] === "object" && obj[head] !== null && Object.keys(obj[head]).length === 0) {
    delete obj[head];
  }
  return deleted;
}

async function main() {
  const srcRoot = path.join(OPTS.rootDir, "src");
  const localesRoot = path.join(OPTS.rootDir, "locales");

  log(`Scanning source files under: ${srcRoot}`);
  const srcFiles = await getFiles(srcRoot, [".js", ".jsx", ".ts", ".tsx"]);
  const usedKeys = new Set();
  for (const f of srcFiles) {
    try {
      const c = await fs.promises.readFile(f, "utf8");
      for (const k of extractKeysFromSource(c)) usedKeys.add(k);
    } catch (e) {
      // skip unreadable
    }
  }
  log(`Found ${usedKeys.size} unique used keys in source.`);

  log(`Scanning JSON files under: ${localesRoot}`);
  const jsonFiles = await getFiles(localesRoot, [".json"]);
  if (!jsonFiles.length) {
    log("No JSON files found under locales/. Nothing to do.");
    return;
  }

  let totalRemoved = 0;
  for (const jf of jsonFiles) {
    let raw;
    try { raw = await fs.promises.readFile(jf, "utf8"); } catch (e) { log(`  [skip] ${jf}: ${e.message}`); continue; }
    let parsed;
    try { parsed = JSON.parse(raw); } catch (e) { log(`  [skip] ${jf}: invalid JSON`); continue; }

    const allKeys = flattenKeys(parsed);
    const unused = allKeys.filter(k => !usedKeys.has(k));
    if (unused.length === 0) { log(`  [ok] ${jf} - no unused keys`); continue; }

    log(`  [found] ${jf} - ${unused.length}/${allKeys.length} unused keys`);
    if (OPTS.dryRun) {
      for (const k of unused) log(`    would remove: ${k}`);
      continue;
    }

    if (OPTS.backup) {
      const bak = `${jf}.bak.${Date.now()}`;
      try { await fs.promises.writeFile(bak, raw, 'utf8'); log(`    backup: ${bak}`); } catch(e){ log(`    backup failed: ${e.message}`); }
    }

    let removed = 0;
    for (const k of unused) {
      const parts = k.split('.');
      if (deleteKeyByPath(parsed, parts)) removed++;
    }

    if (removed > 0) {
      try {
        await fs.promises.writeFile(jf, JSON.stringify(parsed, null, 2) + "\n", 'utf8');
        log(`    removed ${removed} keys from ${jf}`);
        totalRemoved += removed;
      } catch (e) {
        log(`    write failed for ${jf}: ${e.message}`);
      }
    } else {
      log(`    nothing removed from ${jf}`);
    }
  }

  log('Done.');
  if (OPTS.dryRun) log('Dry-run: no files modified.'); else log(`Total keys removed: ${totalRemoved}`);
}

main().catch(err => { console.error('Fatal:', err && err.stack ? err.stack : err); process.exit(2); });
