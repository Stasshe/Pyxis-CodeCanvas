/**
 * import/export/requireの簡易CJS/ESM変換
 */
export function normalizeCjsEsm(code: string): string {
  const exportedNames = new Set<string>();
  // helper: extract bound identifiers from a destructuring pattern, handling nested
  // object/array patterns, rest, and default values. This is a small recursive
  // parser (not a full JS parser) aimed at typical destructuring LHS patterns.
  function extractIdentifiersFromPattern(pattern: string): string[] {
    if (!pattern) return [];
    // determine left-hand side only: find top-level '=' (not inside brackets/strings)
    const raw = String(pattern);
    let s = raw;
    try {
      let depth = 0;
      let inStr: string | null = null;
      for (let idx = 0; idx < raw.length; idx++) {
        const ch = raw[idx];
        const next = raw[idx + 1];
        if (inStr) {
          if (ch === '\\') { idx++; continue; }
          if (ch === inStr) { inStr = null; continue; }
          continue;
        }
        if (ch === '"' || ch === "'" || ch === '`') { inStr = ch; continue; }
        if (ch === '/' && next === '*') { idx += 2; while (idx < raw.length && !(raw[idx] === '*' && raw[idx+1] === '/')) idx++; idx++; continue; }
        if (ch === '{' || ch === '[' || ch === '(') { depth++; continue; }
        if (ch === '}' || ch === ']' || ch === ')') { depth = Math.max(0, depth-1); continue; }
        if (ch === '=' && depth === 0) { s = raw.slice(0, idx); break; }
      }
    } catch (e) {
      s = raw;
    }
    const ids = new Set<string>();
    let i = 0;
    const len = s.length;

    function isIdentStart(ch: string) {
      return /[A-Za-z_$]/.test(ch);
    }
    function isIdentPart(ch: string) {
      return /[A-Za-z0-9_$]/.test(ch);
    }
    function skipWhitespace() {
      while (i < len && /\s/.test(s[i])) i++;
    }
    function skipComment(): boolean {
      if (s[i] === '/' && s[i + 1] === '*') {
        i += 2; while (i < len && !(s[i] === '*' && s[i + 1] === '/')) i++; i += 2; return true;
      }
      if (s[i] === '/' && s[i + 1] === '/') {
        i += 2; while (i < len && s[i] !== '\n') i++; return true;
      }
      return false;
    }
    function skipSpacesAndComments() {
      while (i < len) {
        const before = i;
        while (i < len && /\s/.test(s[i])) i++;
        if (!skipComment()) break;
        if (i === before) break;
      }
    }
    function skipString() {
      const q = s[i]; i++; while (i < len) {
        if (s[i] === '\\') { i += 2; continue; }
        if (s[i] === q) { i++; break; }
        i++; }
    }
    function parseIdentifier(): string | null {
      skipSpacesAndComments();
      if (i < len && isIdentStart(s[i])) {
        const start = i; i++; while (i < len && isIdentPart(s[i])) i++;
        return s.slice(start, i);
      }
      return null;
    }

    function parsePattern(): void {
      skipSpacesAndComments();
      if (s[i] === '{') return parseObject();
      if (s[i] === '[') return parseArray();
      // otherwise nothing to parse
    }

    function parseObject() {
      i++; // consume '{'
      while (i < len) {
        skipSpacesAndComments();
        if (i >= len) break;
        if (s[i] === '}') { i++; break; }
        if (s[i] === ',') { i++; continue; }
        if (s[i] === '.' && s.slice(i, i + 3) === '...') {
          i += 3; const name = parseIdentifier(); if (name) ids.add(name); continue;
        }
        if (s[i] === '"' || s[i] === "'" || s[i] === '`') { skipString(); continue; }
        if (isIdentStart(s[i])) {
          const key = parseIdentifier();
          skipSpacesAndComments();
          if (s[i] === ':') {
            i++; skipSpacesAndComments();
            if (s[i] === '{' || s[i] === '[') { parsePattern(); }
            else if (s[i] === '.' && s.slice(i, i + 3) === '...') { i += 3; const n = parseIdentifier(); if (n) ids.add(n); }
            else {
              const name = parseIdentifier(); if (name) ids.add(name);
              skipSpacesAndComments(); if (s[i] === '=') { i++; let depth = 0; while (i < len && !(depth === 0 && (s[i] === ',' || s[i] === '}'))) {
                if (s[i] === '{' || s[i] === '[') depth++; else if (s[i] === '}' || s[i] === ']') depth--; else if (s[i] === '"' || s[i] === "'" || s[i] === '`') skipString(); i++; }
              }
            }
          } else {
            if (key) ids.add(key);
            // shorthand default: key = <expr> — skip the default expression
            skipSpacesAndComments();
            if (s[i] === '=') {
              i++; let depth2 = 0; while (i < len && !(depth2 === 0 && (s[i] === ',' || s[i] === '}'))) {
                if (s[i] === '{' || s[i] === '[') depth2++; else if (s[i] === '}' || s[i] === ']') depth2--; else if (s[i] === '"' || s[i] === "'" || s[i] === '`') skipString(); i++; }
            }
          }
        } else if (s[i] === '{' || s[i] === '[') {
          parsePattern();
        } else {
          while (i < len && s[i] !== ',' && s[i] !== '}') { if (s[i] === '"' || s[i] === "'" || s[i] === '`') skipString(); else i++; }
        }
      }
    }

    function parseArray() {
      i++; // consume '['
      while (i < len) {
        skipSpacesAndComments();
        if (i >= len) break;
        if (s[i] === ']') { i++; break; }
        if (s[i] === ',') { i++; continue; }
        if (s[i] === '.' && s.slice(i, i + 3) === '...') { i += 3; const name = parseIdentifier(); if (name) ids.add(name); continue; }
        if (s[i] === '{' || s[i] === '[') { parsePattern(); continue; }
        const name = parseIdentifier(); if (name) {
          ids.add(name);
          skipSpacesAndComments(); if (s[i] === '=') { i++; let depth = 0; while (i < len && !(depth === 0 && (s[i] === ',' || s[i] === ']'))) {
            if (s[i] === '{' || s[i] === '[') depth++; else if (s[i] === '}' || s[i] === ']') depth--; else if (s[i] === '"' || s[i] === "'" || s[i] === '`') skipString(); i++; }
        }
        } else { i++; }
      }
    }

    skipSpacesAndComments(); if (s[i] === '{' || s[i] === '[') parsePattern();

    // Supplemental regex pass: capture common binding patterns the parser may miss.
    //  - bindings after colon: ": name"
    //  - rest bindings: "...name"
    //  - shorthand bindings inside braces/arrays
    try {
      const lhs = s;
      let m: RegExpExecArray | null;
      const afterColonRe = /:\s*([A-Za-z_$][\w$]*)/g;
      while ((m = afterColonRe.exec(lhs)) !== null) ids.add(m[1]);
      const restRe = /\.\.\.\s*([A-Za-z_$][\w$]*)/g;
      while ((m = restRe.exec(lhs)) !== null) ids.add(m[1]);
      // shorthand inside braces/arrays: take content between braces/brackets and
      // grab identifiers not followed by ':' (which would be property keys)
      const braceRe = /[\{\[]([\s\S]*?)[\}\]]/g;
      while ((m = braceRe.exec(lhs)) !== null) {
        const inner = m[1];
        const identRe = /\b([A-Za-z_$][\w$]*)\b(?!\s*:)/g;
        let im: RegExpExecArray | null;
        while ((im = identRe.exec(inner)) !== null) {
          const id = im[1];
          if (id === 'as' || id === 'from' || id === 'default' || id === 'return') continue;
          ids.add(id);
        }
      }
      // cleanup: remove identifiers that are actually computed keys like [key]:
      const computedKeyRe = /\[\s*([A-Za-z_$][\w$]*)\s*\]\s*:/g;
      while ((m = computedKeyRe.exec(lhs)) !== null) {
        ids.delete(m[1]);
      }
    } catch (e) {
      // ignore fallback errors in supplemental pass
    }

    return Array.from(ids);
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