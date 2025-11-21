const fs = require('fs');
const path = require('path');

const metaFiles = [];
const base = path.resolve(__dirname, '../../public/extensions');
if (!fs.existsSync(base)) {
  console.error('No public/extensions directory');
  process.exit(2);
}

const entries = fs.readdirSync(base, { withFileTypes: true });
for (const e of entries) {
  if (!e.isDirectory()) continue;
  const metaPath = path.join(base, e.name, 'index.js.meta.json');
  if (fs.existsSync(metaPath)) metaFiles.push(metaPath);
}

const seen = new Map();
for (const f of metaFiles) {
  try {
    const json = JSON.parse(fs.readFileSync(f, 'utf8'));
    const inputs = json.inputs || {};
    for (const [key, info] of Object.entries(inputs)) {
      if (!info.imports) continue;
      for (const imp of info.imports) {
        if (!imp || !imp.path) continue;
        const p = imp.path;
        // ignore internal/relative/runtime and node_modules paths
        if (p === '<runtime>') continue;
        if (p.startsWith('.') || p.startsWith('/') || p.startsWith('node_modules') || p.startsWith('file:')) continue;
        // count occurrences
        const k = p;
        const prev = seen.get(k) || 0;
        seen.set(k, prev + 1);
      }
    }
  } catch (e) {
    console.error('Failed to parse', f, e.message);
  }
}

const arr = Array.from(seen.entries()).sort((a,b)=>b[1]-a[1]);
if (arr.length === 0) {
  console.log('No bare specifiers found in metafiles.');
} else {
  console.log('Bare specifiers found (specifier -> count):');
  for (const [k,v] of arr) {
    console.log(k + ' -> ' + v);
  }
}
