/**
 * import/export/requireの簡易CJS/ESM変換
 */
export function normalizeCjsEsm(code: string): string {
  // import * as ns from 'mod' → const ns = await __require__('mod')
  code = code.replace(/import\s+\*\s+as\s+(\w+)\s+from\s+['"]([^'"]+)['"]/g, (m, ns, mod) => {
    return `const ${ns} = await __require__('${mod}')`;
  });
  // import ... from 'mod' → const ... = await __require__('mod')
  code = code.replace(/import\s+([\w{}\s,]+)\s+from\s+['"]([^'"]+)['"]/g, (m, vars, mod) => {
    return `const ${vars.trim()} = await __require__('${mod}')`;
  });
  // import 'mod' → await __require__('mod')
  code = code.replace(/import\s+['"]([^'"]+)['"]/g, (m, mod) => `await __require__('${mod}')`);
  // export default ... → module.exports.default = ...
  code = code.replace(/export\s+default\s+/g, 'module.exports.default = ');
  // export const/let/var foo = 1, bar = 2; -> const/let/var foo = 1, bar = 2; module.exports.foo = foo; module.exports.bar = bar;
  code = code.replace(/export\s+(const|let|var)\s+([^;]+);/g, (m, kind, decls) => {
    // decls: "foo = 1, bar = 2"
    const declList = String(decls).split(',').map(s => s.trim());
    const names: string[] = [];
    for (const d of declList) {
      // match identifier at start
      const nm = d.match(/^(\w+)/);
      if (nm) names.push(nm[1]);
    }
    const head = `${kind} ${decls};`;
    const exports = names.map(n => `module.exports.${n} = ${n};`).join(' ');
    return `${head} ${exports}`;
  });
  // require('mod') → await __require__('mod')（module.exports付与より前に変換）
  code = code.replace(/require\((['"][^'"\)]+['"])\)/g, 'await __require__($1)');
  // export { a, b as c } -> module.exports.a = a; module.exports.c = b;
  code = code.replace(/export\s*\{([^}]+)\}\s*;?/g, (m, list) => {
    const parts = String(list).split(',').map(s => s.trim()).filter(Boolean);
    const assigns = parts.map(p => {
      const asMatch = p.match(/^(\w+)\s+as\s+(\w+)$/);
      if (asMatch) {
        const from = asMatch[1];
        const to = asMatch[2];
        return `module.exports.${to} = ${from};`;
      } else {
        return `module.exports.${p} = ${p};`;
      }
    });
    return assigns.join(' ');
  });
  // export function NAME(...) { ... } -> function NAME(...) { ... } module.exports.NAME = NAME;
  code = code.replace(/export\s+function\s+(\w+)\s*\(/g, (m, name) => {
    return `function ${name}(`;
  });
  code = code.replace(/(function\s+(\w+)\s*\([^)]*\)\s*\{[\s\S]*?\})/g, function(m, fn, name, offset, string) {
    // if module.exports already added inside the function text, skip
    if (m.includes('module.exports')) return m;
    // check preceding text to avoid double-export for default exports
    const before = string.slice(Math.max(0, offset - 30), offset);
    if (/module\.exports\.default\s*=\s*$/.test(before)) {
      return m; // skip adding module.exports.NAME for default exported function
    }
    return `${fn} module.exports.${name} = ${name};`;
  });
  // export class NAME { ... } -> class NAME { ... } module.exports.NAME = NAME;
  code = code.replace(/export\s+class\s+(\w+)\s*/g, (m, name) => {
    return `class ${name} `;
  });
  code = code.replace(/(class\s+(\w+)\s*\{[\s\S]*?\})/g, function(m, cls, name, offset, string) {
    if (m.includes('module.exports')) return m;
    const before = string.slice(Math.max(0, offset - 30), offset);
    if (/module\.exports\.default\s*=\s*$/.test(before)) {
      return m;
    }
    return `${cls} module.exports.${name} = ${name};`;
  });
  // メソッドチェーン対応: const ... = ...\n  .foo() ... ; のような複数行を1文として扱う
  code = code.replace(/const (\w+) = ([^;\n]+)((?:\n\s*\.[^;\n]*)*)(;|\n|$)/g, (m, name, val, chain, end) => {
    if (m.includes('module.exports')) return m;
    // import/require変換後の行はmodule.exports付与しない
    if (/^\s*await __require__\s*\(/.test(val.trim())) return m;
    if (/^await __require__\s*\(/.test(val.trim())) return m;
    return `const ${name} = ${val}${chain}${end} module.exports.${name} = ${name};`;
  });
  return code;
}