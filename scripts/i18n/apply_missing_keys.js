#!/usr/bin/env node
"use strict";

const fs = require('fs');
const path = require('path');

function usage() {
  console.log('Usage: apply_missing_keys.js --base <base.json> --target <target.json> --keys-file <keys.txt> [--backup]');
  process.exit(2);
}

const argv = process.argv.slice(2);
let baseFile, targetFile, keysFile, backup=false;
for (let i=0;i<argv.length;i++){
  const a=argv[i];
  if (a==='--base') baseFile=argv[++i];
  else if (a==='--target') targetFile=argv[++i];
  else if (a==='--keys-file') keysFile=argv[++i];
  else if (a==='--backup') backup=true;
  else { console.error('Unknown arg',a); usage(); }
}

if (!baseFile || !targetFile || !keysFile) usage();

function readJson(p){
  try { return JSON.parse(fs.readFileSync(p,'utf8')); } catch(e){ console.error('Failed to read/parse',p, e.message); process.exit(3); }
}

function writeJson(p, obj){
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

function getByPath(obj, parts){
  let cur = obj;
  for (const k of parts){
    if (cur && typeof cur === 'object' && k in cur) cur = cur[k];
    else return undefined;
  }
  return cur;
}

function setByPath(obj, parts, value){
  let cur = obj;
  for (let i=0;i<parts.length;i++){
    const k = parts[i];
    if (i === parts.length - 1){
      cur[k] = value;
    } else {
      if (!(k in cur) || typeof cur[k] !== 'object' || cur[k] === null) cur[k] = {};
      cur = cur[k];
    }
  }
}

const base = readJson(baseFile);
let target = {};
if (fs.existsSync(targetFile)) target = readJson(targetFile);

const keys = fs.readFileSync(keysFile,'utf8').split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
if (!keys.length){ console.log('No keys to apply.'); process.exit(0); }

if (backup){
  const bak = `${targetFile}.bak.${Date.now()}`;
  fs.copyFileSync(targetFile, bak);
  console.log(`backup: ${bak}`);
}

let applied = 0;
for (const k of keys){
  const parts = k.split('.');
  const existing = getByPath(target, parts);
  if (existing !== undefined) continue; // already present
  const baseVal = getByPath(base, parts);
  // When applying missing keys, set a placeholder so translators can find it easily.
  const toSet = '#######' + baseVal;
  setByPath(target, parts, toSet);
  applied++;
  console.log(`applied: ${k} (set to "#######")`);
}

if (applied > 0){
  writeJson(targetFile, target);
  console.log(`wrote ${applied} keys to ${targetFile}`);
} else {
  console.log('nothing to apply');
}
