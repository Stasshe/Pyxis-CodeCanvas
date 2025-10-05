/**
 * import/export/requireの簡易CJS/ESM変換
 */
export function normalizeCjsEsm(code: string): string {
  const exportedNames = new Set<string>();
  // helper: extract bound identifiers from a destructuring pattern (crude, regex-based)
  function extractIdentifiersFromPattern(pattern: string): string[] {
    if (!pattern) return [];
    // only analyze left-hand side of an assignment pattern (drop "= rhs")
    let s = String(pattern).split('=')[0];
    // remove comments and strings
    s = s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    s = s.replace(/(['"`])(?:\\.|(?!\1).)*\1/g, '');
    const names = new Set<string>();
    let m: RegExpExecArray | null;
    // identifiers after colon: foo: bar -> bar
    const afterColonRe = /:\s*([A-Za-z_$][\w$]*)/g;
    while ((m = afterColonRe.exec(s)) !== null) {
      names.add(m[1]);
    }
    // standalone identifiers (not followed by colon) - these are shorthand bindings
    const identRe = /([A-Za-z_$][\w$]*)/g;
    while ((m = identRe.exec(s)) !== null) {
      const id = m[1];
      const after = s.slice(m.index + id.length, m.index + id.length + 2);
      if (/^\s*:/.test(after)) continue; // it's a property name
      if (id === 'as' || id === 'from' || id === 'default') continue;
      names.add(id);
    }
    return Array.from(names);
  }
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
  code = code.replace(/export\s+(const|let|var)\s+([^;]+);?/g, (m, kind, decls) => {
    // decls: "foo = 1, bar = 2"
    // If decls is a destructuring pattern (starts with { or [), do not try to export
    const trimmed = String(decls).trim();
    if (/^[\{\[]/.test(trimmed)) {
        // try to extract identifiers from nested destructuring and export them
        const ids = extractIdentifiersFromPattern(trimmed);
        const head = `${kind} ${decls};`;
        if (ids.length > 0) {
          const exports = ids.map(n => `module.exports.${n} = ${n};`).join(' ');
          return `${head} ${exports}`;
        }
        return `${kind} ${decls};`;
    }
    // remove trailing comma if present and split
    const cleaned = trimmed.replace(/,\s*$/, '');
    const declList = cleaned.split(',').map(s => s.trim()).filter(Boolean);
    const names: string[] = [];
    for (let d of declList) {
      // strip comments before matching identifier
      d = d.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '').trim();
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
      // strip comments inside the part
      const cleaned = p.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '').trim();
      const asMatch = cleaned.match(/^(\w+)\s+as\s+(\w+)$/);
      if (asMatch) {
        const from = asMatch[1];
        const to = asMatch[2];
        return `module.exports.${to} = ${from};`;
      } else {
        // cleaned might be just a name
        const name = cleaned.match(/^(\w+)$/);
        if (name) return `module.exports.${name[1]} = ${name[1]};`;
        // fallback: preserve original (best-effort)
        return `module.exports.${cleaned} = ${cleaned};`;
      }
    });
    return assigns.join(' ');
  });
  // export function NAME(...) { ... } -> function NAME(...) { ... } module.exports.NAME = NAME;
  // remove export keyword from function declarations; collect the name so we can
  // append module.exports.NAME = NAME; later (avoids scanning non-exported funcs)
  code = code.replace(/export\s+function\s+(\w+)\s*\(/g, (m, name) => {
    exportedNames.add(name);
    return `function ${name}(`;
  });
  // export class NAME { ... } -> class NAME { ... } module.exports.NAME = NAME;
  code = code.replace(/export\s+class\s+(\w+)\s*/g, (m, name) => {
    exportedNames.add(name);
    return `class ${name} `;
  });
  // remove fragile body-matching replacements above; instead, after all transforms,
  // we'll collect top-level function/class names and append module.exports assignments
  // メソッドチェーン対応: const ... = ...\n  .foo() ... ; のような複数行を1文として扱う
  code = code.replace(/const (\w+) = ([^;\n]+)((?:\n\s*\.[^;\n]*)*)(;|\n|$)/g, (m, name, val, chain, end) => {
    if (m.includes('module.exports')) return m;
    // import/require変換後の行はmodule.exports付与しない
    if (/^\s*await __require__\s*\(/.test(val.trim())) return m;
    if (/^await __require__\s*\(/.test(val.trim())) return m;
    // dynamic import should not be auto-exported
    if (/^\s*import\s*\(/.test(val.trim())) return m;
    return `const ${name} = ${val}${chain}${end} module.exports.${name} = ${name};`;
  });
  // Post-process: append module.exports for only those function/class names
  // that were explicitly exported (we collected them above). This prevents
  // exporting nested or non-exported declarations.
  if (exportedNames.size > 0) {
    const assigns = Array.from(exportedNames).filter(n => !new RegExp(`module\\.exports\\.${n}\\s*=`).test(code)).map(n => `module.exports.${n} = ${n};`).join(' ');
    if (assigns) code = code + '\n' + assigns;
  }

  return code;
}