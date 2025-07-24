// initial_files_to_ts.js
const fs = require('fs');
const path = require('path');

const inputDir = path.join(__dirname, 'initial_files');
const outputFile = path.join(__dirname, 'src/utils/initialFileContents.ts');

const files = fs.readdirSync(inputDir);
const result = {};

for (const file of files) {
  const filePath = path.join(inputDir, file);
  if (fs.statSync(filePath).isFile()) {
    let content = fs.readFileSync(filePath, 'utf8');
    content = content.replace(/\\/g, '\\\\').replace(/`/g, '\\`');
    result[file] = content;
  }
}

const ts = `export const initialFileContents: Record<string, string> = {\n` +
  Object.entries(result)
    .map(([k, v]) => `  '${k}': \`${v}\`,`).join('\n') +
  `\n};\n`;

fs.writeFileSync(outputFile, ts, 'utf8');
console.log('initialFileContents.ts generated!');