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
  // export const foo = ... → const foo = ...; module.exports.foo = foo;
  code = code.replace(/export\s+const\s+(\w+)\s*=\s*/g, 'const $1 = ');
  // require('mod') → await __require__('mod')（module.exports付与より前に変換）
  code = code.replace(/require\((['"][^'"\)]+['"])\)/g, 'await __require__($1)');
  code = code.replace(/const (\w+) = ([^;\n]+)(;|\n|$)/g, (m, name, val, end) => {
    if (m.includes('module.exports')) return m;
    // import/require変換後の行はmodule.exports付与しない
    if (/^\s*await __require__\s*\(/.test(val.trim())) return m;
    if (/^await __require__\s*\(/.test(val.trim())) return m;
    return `const ${name} = ${val}${end} module.exports.${name} = ${name};`;
  });
  return code;
}