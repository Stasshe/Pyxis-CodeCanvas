// initial_files_to_ts.js
const fs = require('fs');
const path = require('path');

// Resolve repo root (script lives in scripts/build/)
const ROOT_DIR = path.resolve(__dirname, '..', '..');
const inputDir = path.join(ROOT_DIR, 'initial_files');
const outputFile = path.join(ROOT_DIR, 'src', 'engine', 'initialFileContents.ts');

function walk(dir) {
  const result = {};
  for (const entry of fs.readdirSync(dir)) {
    const fullPath = path.join(dir, entry);
    if (fs.statSync(fullPath).isDirectory()) {
      result[entry] = {
        type: 'folder',
        children: walk(fullPath)
      };
    } else {
      result[entry] = {
        type: 'file',
                content: fs.readFileSync(fullPath, 'utf8')
      };
    }
  }
  return result;
}

const initialFileContents = walk(inputDir);

function escapeString(str) {
  return str
    .replace(/\\/g, "\\\\")// バックスラッシュ
    .replace(/`/g, "\\x60")// バッククォート
    .replace(/'/g, "\\'")
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n");
}

function objToTs(obj, indent = '  ') {
  if (obj.type === 'file') {
    return `{ type: 'file', content: '${escapeString(obj.content)}' }`;
  }
  if (obj.type === 'folder') {
    return `{ type: 'folder', children: ${objToTs(obj.children, indent + '  ')} }`;
  }
  // root object
  const entries = Object.entries(obj).map(([k, v]) =>
    `${indent}'${k}': ${objToTs(v, indent + '  ')}`
  );
  return `{
${entries.join(',\n')}
${indent.slice(2)}}`;
}

const ts = `export const initialFileContents = ${objToTs(initialFileContents)};\n`;

// ensure output directory exists
fs.mkdirSync(path.dirname(outputFile), { recursive: true });
fs.writeFileSync(outputFile, ts, 'utf8');
console.log(`initialFileContents.ts generated at ${outputFile}`);