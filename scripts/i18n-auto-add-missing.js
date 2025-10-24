#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const SCRIPTS_DIR = __dirname;
const REPO_ROOT = path.resolve(SCRIPTS_DIR, '..');
const DETECT_SCRIPT = path.join(SCRIPTS_DIR, 'i18n-missing-keys.sh');
const RESULTS_FILE = path.join(SCRIPTS_DIR, 'i18n-missing-keys-results.txt');

function runDetection() {
  if (!fs.existsSync(DETECT_SCRIPT)) {
    console.error('Detection script not found:', DETECT_SCRIPT);
    process.exit(2);
  }
  console.log('Running i18n detection script to collect missing keys...');
  execSync(`bash "${DETECT_SCRIPT}"`, { stdio: 'inherit', cwd: REPO_ROOT });
}

function parseMissingKeys(resultsText) {
  const keys = new Set();
  resultsText.split(/\r?\n/).forEach((line) => {
    const m = line.match(/^MISSING_KEY\s+(.+)$/);
    if (m) keys.add(m[1].trim());
  });
  return Array.from(keys);
}

function loadJsonMaybe(p) {
  if (!fs.existsSync(p)) return {};
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    console.error('Failed to parse JSON:', p, e.message);
    process.exit(3);
  }
}

function setDeep(obj, key, value) {
  const parts = key.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (!(p in cur) || typeof cur[p] !== 'object') cur[p] = {};
    cur = cur[p];
  }
  const last = parts[parts.length - 1];
  if (!(last in cur)) cur[last] = value;
}

function existsDeep(obj, key) {
  try {
    const parts = key.split('.');
    let cur = obj;
    for (const p of parts) {
      if (cur == null || !(p in cur)) return false;
      cur = cur[p];
    }
    return true;
  } catch (e) {
    return false;
  }
}

function humanizeKey(key) {
  const last = key.split('.').pop();
  // split camelCase and separators
  const spaced = last
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[-_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const words = spaced.split(' ').filter(Boolean);
  const capitalized = words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  return capitalized;
}

function writeJsonAtomic(p, obj) {
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, p);
}

async function main() {
  runDetection();

  if (!fs.existsSync(RESULTS_FILE)) {
    console.error('Results file not found:', RESULTS_FILE);
    process.exit(4);
  }

  const resultsText = fs.readFileSync(RESULTS_FILE, 'utf8');
  const missingKeys = parseMissingKeys(resultsText);
  if (missingKeys.length === 0) {
    console.log('No missing keys found. Nothing to do.');
    return;
  }

  const enPath = path.join(REPO_ROOT, 'public', 'locales', 'en', 'common.json');
  const jaPath = path.join(REPO_ROOT, 'public', 'locales', 'ja', 'common.json');

  const enJson = loadJsonMaybe(enPath);
  const jaExists = fs.existsSync(jaPath);
  const jaJson = jaExists ? loadJsonMaybe(jaPath) : {};

  let addedEn = 0;
  let addedJa = 0;

  for (const k of missingKeys) {
    if (existsDeep(enJson, k)) continue; // skip if already present
    const defaultEn = humanizeKey(k);
    setDeep(enJson, k, defaultEn);
    addedEn++;
    if (jaExists) {
      setDeep(jaJson, k, `（未翻訳）${defaultEn}`);
      addedJa++;
    }
  }

  if (addedEn > 0) {
    writeJsonAtomic(enPath, enJson);
    console.log(`Wrote ${addedEn} new key(s) to ${enPath}`);
  } else {
    console.log('No new keys added to', enPath);
  }

  if (jaExists) {
    if (addedJa > 0) {
      writeJsonAtomic(jaPath, jaJson);
      console.log(`Wrote ${addedJa} new key(s) to ${jaPath}`);
    } else {
      console.log('No new keys added to', jaPath);
    }
  } else {
    console.log('Japanese locale not found at', jaPath, '- skipping ja updates');
  }

  console.log('Done. Please review and commit the changes.');
}

main().catch((e) => {
  console.error('Unexpected error:', e);
  process.exit(10);
});
