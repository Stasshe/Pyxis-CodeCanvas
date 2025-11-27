/**
 * import/export/requireの超速CJS/ESM変換
 * @returns {{ code: string; dependencies: string[] }} 変換後のコードと依存モジュールのリスト
 */
export function normalizeCjsEsm(code: string): { code: string; dependencies: string[] } {
  const dependencies: string[] = []; // 検出された依存関係のリスト
  // Protect `import.meta` and dynamic `import(...)` from accidental transforms by
  // masking them before we run a series of regex-based replacements, then
  // restoring them at the end. This avoids cases where patterns like
  // `import.meta.url` or `import(...)` could be mis-recognized and mangled.
  const placeholders: { key: string; original: string }[] = [];
  function mask(value: string): string {
    const key = `__NORM_PLACEHOLDER_${placeholders.length}__`;
    placeholders.push({ key, original: value });
    return key;
  }

  // Mask import.meta and any chained properties like import.meta.url
  code = code.replace(/import\.meta(?:\.[A-Za-z_$][\w$]*)*/g, m => mask(m));

  // Mask dynamic import(...) tokens so regexes that look for `import ... from` or
  // other import patterns don't accidentally match the 'import(' sequence.
  code = code.replace(/\bimport\s*\(/g, m => mask(m));

  // map of exportedName -> localName (handles `export { a as b }` cases)
  const exportedMap = new Map<string, string>();
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
          if (ch === '\\') {
            idx++;
            continue;
          }
          if (ch === inStr) {
            inStr = null;
            continue;
          }
          continue;
        }
        if (ch === '"' || ch === "'" || ch === '`') {
          inStr = ch;
          continue;
        }
        if (ch === '/' && next === '*') {
          idx += 2;
          while (idx < raw.length && !(raw[idx] === '*' && raw[idx + 1] === '/')) idx++;
          idx++;
          continue;
        }
        if (ch === '{' || ch === '[' || ch === '(') {
          depth++;
          continue;
        }
        if (ch === '}' || ch === ']' || ch === ')') {
          depth = Math.max(0, depth - 1);
          continue;
        }
        if (ch === '=' && depth === 0) {
          s = raw.slice(0, idx);
          break;
        }
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
        i += 2;
        while (i < len && !(s[i] === '*' && s[i + 1] === '/')) i++;
        i += 2;
        return true;
      }
      if (s[i] === '/' && s[i + 1] === '/') {
        i += 2;
        while (i < len && s[i] !== '\n') i++;
        return true;
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
      const q = s[i];
      i++;
      while (i < len) {
        if (s[i] === '\\') {
          i += 2;
          continue;
        }
        if (s[i] === q) {
          i++;
          break;
        }
        i++;
      }
    }
    function parseIdentifier(): string | null {
      skipSpacesAndComments();
      if (i < len && isIdentStart(s[i])) {
        const start = i;
        i++;
        while (i < len && isIdentPart(s[i])) i++;
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
        if (s[i] === '}') {
          i++;
          break;
        }
        if (s[i] === ',') {
          i++;
          continue;
        }
        if (s[i] === '.' && s.slice(i, i + 3) === '...') {
          i += 3;
          const name = parseIdentifier();
          if (name) ids.add(name);
          continue;
        }
        if (s[i] === '"' || s[i] === "'" || s[i] === '`') {
          skipString();
          continue;
        }
        if (isIdentStart(s[i])) {
          const key = parseIdentifier();
          skipSpacesAndComments();
          if (s[i] === ':') {
            i++;
            skipSpacesAndComments();
            if (s[i] === '{' || s[i] === '[') {
              parsePattern();
            } else if (s[i] === '.' && s.slice(i, i + 3) === '...') {
              i += 3;
              const n = parseIdentifier();
              if (n) ids.add(n);
            } else {
              const name = parseIdentifier();
              if (name) ids.add(name);
              skipSpacesAndComments();
              if (s[i] === '=') {
                i++;
                let depth = 0;
                while (i < len && !(depth === 0 && (s[i] === ',' || s[i] === '}'))) {
                  if (s[i] === '{' || s[i] === '[') depth++;
                  else if (s[i] === '}' || s[i] === ']') depth--;
                  else if (s[i] === '"' || s[i] === "'" || s[i] === '`') skipString();
                  i++;
                }
              }
            }
          } else {
            if (key) ids.add(key);
            // shorthand default: key = <expr> — skip the default expression
            skipSpacesAndComments();
            if (s[i] === '=') {
              i++;
              let depth2 = 0;
              while (i < len && !(depth2 === 0 && (s[i] === ',' || s[i] === '}'))) {
                if (s[i] === '{' || s[i] === '[') depth2++;
                else if (s[i] === '}' || s[i] === ']') depth2--;
                else if (s[i] === '"' || s[i] === "'" || s[i] === '`') skipString();
                i++;
              }
            }
          }
        } else if (s[i] === '{' || s[i] === '[') {
          parsePattern();
        } else {
          while (i < len && s[i] !== ',' && s[i] !== '}') {
            if (s[i] === '"' || s[i] === "'" || s[i] === '`') skipString();
            else i++;
          }
        }
      }
    }

    function parseArray() {
      i++; // consume '['
      while (i < len) {
        skipSpacesAndComments();
        if (i >= len) break;
        if (s[i] === ']') {
          i++;
          break;
        }
        if (s[i] === ',') {
          i++;
          continue;
        }
        if (s[i] === '.' && s.slice(i, i + 3) === '...') {
          i += 3;
          const name = parseIdentifier();
          if (name) ids.add(name);
          continue;
        }
        if (s[i] === '{' || s[i] === '[') {
          parsePattern();
          continue;
        }
        const name = parseIdentifier();
        if (name) {
          ids.add(name);
          skipSpacesAndComments();
          if (s[i] === '=') {
            i++;
            let depth = 0;
            while (i < len && !(depth === 0 && (s[i] === ',' || s[i] === ']'))) {
              if (s[i] === '{' || s[i] === '[') depth++;
              else if (s[i] === '}' || s[i] === ']') depth--;
              else if (s[i] === '"' || s[i] === "'" || s[i] === '`') skipString();
              i++;
            }
          }
        } else {
          i++;
        }
      }
    }

    skipSpacesAndComments();
    if (s[i] === '{' || s[i] === '[') parsePattern();

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
      const braceRe = /[{\[]([\s\S]*?)[}\]]/g;
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
  // import * as ns from 'mod' → const ns = require('mod')
  code = code.replace(/import\s+\*\s+as\s+(\w+)\s+from\s+['"]([^'"]+)['"]/g, (m, ns, mod) => {
    dependencies.push(mod); // 依存関係を記録
    return `const ${ns} = require('${mod}')`;
  });
  // import ... from 'mod' → const ... = require('mod')
  // handle default-only: import foo from 'mod'
  code = code.replace(/import\s+([A-Za-z_$][\w$]*)\s+from\s+['"]([^'"]+)['"]/g, (m, def, mod) => {
    dependencies.push(mod); // 依存関係を記録
    // prefer module.default when present: wrap require result
    return `const ${def} = (tmp => tmp && tmp.default !== undefined ? tmp.default : tmp)(require('${mod}'))`;
  });
  // handle default + named: import foo, {a,b} from 'mod'
  code = code.replace(
    /import\s+([A-Za-z_$][\w$]*)\s*,\s*\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/g,
    (m, def, names, mod) => {
      dependencies.push(mod); // 依存関係を記録
      // assign temp module then default and named
      const nm = names.trim();
      return `const __mod_tmp = require('${mod}'); const ${def} = (__mod_tmp && __mod_tmp.default !== undefined) ? __mod_tmp.default : __mod_tmp; const {${nm}} = __mod_tmp`;
    }
  );
  // fallback: named-only imports
  code = code.replace(/import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g, (m, names, mod) => {
    dependencies.push(mod); // 依存関係を記録
    return `const {${names.trim()}} = require('${mod}')`;
  });
  // import 'mod' → require('mod')
  code = code.replace(/import\s+['"]([^'"]+)['"]/g, (m, mod) => {
    dependencies.push(mod); // 依存関係を記録
    return `require('${mod}')`;
  });
  // export default ... → module.exports.default = ...
  code = code.replace(/export\s+default\s+/g, 'module.exports.default = ');
  // export const/let/var foo = 1, bar = 2; -> const/let/var foo = 1, bar = 2; module.exports.foo = foo; module.exports.bar = bar;
  code = code.replace(/export\s+(const|let|var)\s+([^;]+);?/g, (m, kind, decls) => {
    // decls: "foo = 1, bar = 2"
    // If decls is a destructuring pattern (starts with { or [), do not try to export
    const trimmed = String(decls).trim();
    if (/^[{\[]/.test(trimmed)) {
      // try to extract identifiers from nested destructuring and export them
      const ids = extractIdentifiersFromPattern(trimmed);
      const head = `${kind} ${decls};`;
      if (ids.length > 0) {
        for (const n of ids) exportedMap.set(n, n);
      }
      return head;
    }
    // remove trailing comma if present and split
    const cleaned = trimmed.replace(/,\s*$/, '');
    const declList = cleaned
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
    const names: string[] = [];
    for (let d of declList) {
      // strip comments before matching identifier
      d = d
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '')
        .trim();
      const nm = d.match(/^(\w+)/);
      if (nm) names.push(nm[1]);
    }
    const head = `${kind} ${decls};`;
    for (const n of names) exportedMap.set(n, n);
    return head;
  });
  // Keep require() synchronous - do NOT transform to await __require__()
  // But extract dependencies for pre-loading
  code = code.replace(/\brequire\s*\(\s*(['"])([^'"]+)\1\s*\)/g, (m, quote, mod) => {
    dependencies.push(mod); // 依存関係を記録
    return m; // require()はそのまま
  });
  // code = code.replace(/(^|\n)\s*(const|let|var)\s+(\w+)\s*=\s*([^;\n]+)((?:\n\s*\.[^;\n]*)*)(;|\n|$)/g, (m, pre, kind, name, val, chain, end) => {
  //   // don't auto-export if the declaration already contains module.exports
  //   if (m.includes('module.exports')) return m;
  //   const fullVal = String(val || '') + String(chain || '');
  //   const trimmed = fullVal.trim();
  //   // skip values that are results of require -> await __require__ (we don't
  //   // auto-export those)
  //   if (/^await\s+__require__\s*\(/.test(trimmed)) return m;
  //   // skip raw dynamic import(...) (but allow await import(...))
  //   if (/^import\s*\(/.test(trimmed)) return m;
  //   // register for export (name exported as itself)
  //   exportedMap.set(name, name);
  //   return m;
  // });
  // NOTE: removed automatic auto-export of top-level const/let/var declarations
  // to avoid erroneous exports being added from inside functions, templates,
  // or other non-top-level contexts. Exports must now be explicit (via
  // `export` keywords or `export { ... }` forms). This change prevents
  // normalizeCjsEsm from producing unexpected `module.exports.*` assignments.

  // export { a, b as c } -> module.exports.a = a; module.exports.c = b;
  // Handle `export { ... } from 'mod'` first to avoid leaving a trailing `from 'mod'`
  code = code.replace(/export\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]\s*;?/g, (m, list, mod) => {
    dependencies.push(mod); // 依存関係を記録
    // import the module first, then re-export named bindings from it
    const parts = String(list)
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
    const assigns: string[] = [];
    const tmp = `__rexp_${Math.random().toString(36).slice(2, 8)}`;
    assigns.push(`const ${tmp} = require('${mod}');`);
    for (const p of parts) {
      const cleaned = p
        .replace(/\/\*[^*]*\*+(?:[^/*][^*]*\*+)*\//g, '')
        .replace(/\/\/.*$/gm, '')
        .trim();
      const asMatch = cleaned.match(/^(\w+)\s+as\s+(\w+)$/);
      if (asMatch) {
        const from = asMatch[1];
        const to = asMatch[2];
        assigns.push(`module.exports.${to} = ${tmp}.${from};`);
      } else {
        const nameMatch = cleaned.match(/^(\w+)$/);
        if (nameMatch) assigns.push(`module.exports.${nameMatch[1]} = ${tmp}.${nameMatch[1]};`);
        else assigns.push(`// unhandled export clause: ${cleaned}`);
      }
    }
    return assigns.join(' ');
  });

  // export * from 'mod' -> copy all exports except default
  code = code.replace(/export\s+\*\s+from\s+['"]([^'"]+)['"]\s*;?/g, (m, mod) => {
    dependencies.push(mod); // 依存関係を記録
    const tmp = `__rexp_${Math.random().toString(36).slice(2, 8)}`;
    return `const ${tmp} = require('${mod}'); for (const k in ${tmp}) { if (k !== 'default') module.exports[k] = ${tmp}[k]; }`;
  });

  // export { a, b as c } -> module.exports.a = a; module.exports.c = b;
  code = code.replace(/export\s*\{([^}]+)\}\s*;?/g, (m, list) => {
    const parts = String(list)
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
    const assigns = parts.map(p => {
      // strip comments inside the part
      const cleaned = p
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '')
        .trim();
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
    exportedMap.set(name, name);
    return `function ${name}(`;
  });
  // export class NAME { ... } -> class NAME { ... } module.exports.NAME = NAME;
  code = code.replace(/export\s+class\s+(\w+)\s*/g, (m, name) => {
    exportedMap.set(name, name);
    return `class ${name} `;
  });
  // remove fragile body-matching replacements above; instead, after all transforms,
  // we'll collect top-level function/class names and append module.exports assignments
  // メソッドチェーン対応: const ... = ...\n  .foo() ... ; のような複数行を1文として扱う
  // NOTE: removed automatic inline module.exports insertion for arbitrary const
  // assignments. Exports are now collected from explicit `export` forms and
  // emitted at the end of the file to avoid injecting into function/class
  // bodies and to prevent duplicated assignments.
  // Post-process: append module.exports for only those function/class names
  // that were explicitly exported (we collected them above). This prevents
  // exporting nested or non-exported declarations.
  if (exportedMap.size > 0) {
    const assignsArr: string[] = [];
    for (const [exported, local] of exportedMap.entries()) {
      // avoid duplicating assignments if present already
      if (!new RegExp(`module\\.exports\\.${exported}\\s*=`).test(code)) {
        assignsArr.push(`module.exports.${exported} = ${local};`);
      }
    }
    if (assignsArr.length > 0) code = code + '\n' + assignsArr.join(' ');
  }

  // Restore masked placeholders (reverse order for safety)
  if (placeholders.length > 0) {
    for (let i = placeholders.length - 1; i >= 0; i--) {
      const p = placeholders[i];
      // Simple global replace of the placeholder key back to original
      const re = new RegExp(p.key.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&'), 'g');
      code = code.replace(re, p.original);
    }
  }

  // 重複を除去してユニークな依存関係リストを返す
  const uniqueDependencies = Array.from(new Set(dependencies));

  return { code, dependencies: uniqueDependencies };
}
