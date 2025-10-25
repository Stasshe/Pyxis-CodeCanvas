#!/usr/bin/env node
/**
 * Update README.md and README_en.md to reflect package.json version.
 *
 * Behavior:
 *  - Replaces badge image filename that looks like: version-0.9.0-blue.svg (handles both
 *    URLs like ".../badge/version-0.9.0-blue.svg" and variants)
 *  - Replaces the first standalone semver line within the first 30 lines (e.g. a line containing only "0.9.0").
 */
const fs = require('fs');
const path = require('path');

function readPkgVersion() {
  const pkgPath = path.join(__dirname, '..', 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  return pkg.version;
}

function updateFile(filePath, version) {
  if (!fs.existsSync(filePath)) {
    console.warn(`skip (not found): ${filePath}`);
    return;
  }
  let s = fs.readFileSync(filePath, 'utf8');
  const original = s;

  // 1) badge update: handle variants like .../badge/version-0.9.0-blue.svg
  //    and any direct "version-0.9.0-blue.svg" occurrences.
  s = s.replace(/version-[0-9]+\.[0-9]+\.[0-9]+-blue\.svg/g, `version-${version}-blue.svg`);

  // 2) replace first standalone semver in the top portion (first 30 lines)
  const lines = s.split('\n');
  for (let i = 0; i < Math.min(30, lines.length); i++) {
    if (/^\s*[0-9]+\.[0-9]+\.[0-9]+\s*$/.test(lines[i])) {
      lines[i] = version;
      break;
    }
  }
  s = lines.join('\n');

  if (s === original) {
    console.log(`no changes needed: ${path.relative(process.cwd(), filePath)}`);
    return;
  }

  // write updated content
  fs.writeFileSync(filePath, s, 'utf8');
  console.log(`updated: ${path.relative(process.cwd(), filePath)}`);
}

function main() {
  const version = readPkgVersion();
  const repoRoot = path.join(__dirname, '..');
  const targets = [
    path.join(repoRoot, 'README.md'),
    path.join(repoRoot, 'README_en.md')
  ];

  targets.forEach(fp => updateFile(fp, version));
}

main();
