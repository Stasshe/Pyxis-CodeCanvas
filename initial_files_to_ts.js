// initial_files_to_ts.js
const fs = require('fs');
const path = require('path');

const inputDir = path.join(__dirname, 'initial_files');
const outputFile = path.join(__dirname, 'src/utils/initialFileContents.ts');

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
      let content = fs.readFileSync(fullPath, 'utf8');
      content = content.replace(/\\/g, '\\\\').replace(/`/g, '\\`');
      result[entry] = {
        type: 'file',
        content
      };
    }
  }
  return result;
}

const initialFileContents = walk(inputDir);

function objToTs(obj, indent = '  ') {
  if (obj.type === 'file') {
    return `{ type: 'file', content: \`\n${indent}${obj.content}\` }`;
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

fs.writeFileSync(outputFile, ts, 'utf8');
console.log('initialFileContents.ts generated!');