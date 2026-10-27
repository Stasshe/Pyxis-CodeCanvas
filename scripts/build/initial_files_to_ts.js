// initial_files_to_ts.js
const fs = require('fs');
const path = require('path');

// Resolve the repository root from scripts/build/.
const ROOT_DIR = path.resolve(__dirname, '..', '..');
const inputDir = path.join(ROOT_DIR, 'initial_files');
const outputFile = path.join(ROOT_DIR, 'src', 'engine', 'core', 'workspace', 'initialFileContents.ts');

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
    .replace(/\\/g, "\\\\")
    .replace(/`/g, "\\x60")
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

const ts = `export type InitialFileEntry =
  | { type: 'file'; content: string }
  | { type: 'folder'; children: InitialFileTree };

export type InitialFileTree = Record<string, InitialFileEntry>;

export const initialFileContents: InitialFileTree = ${objToTs(initialFileContents)};\n`;

// Ensure the generated file's directory exists.
fs.mkdirSync(path.dirname(outputFile), { recursive: true });
fs.writeFileSync(outputFile, ts, 'utf8');
console.log(`initialFileContents.ts generated at ${outputFile}`);
