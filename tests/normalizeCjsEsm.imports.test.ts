import { normalizeCjsEsm } from '@/engine/runtime/normalizeCjsEsm';

describe('normalizeCjsEsm - import related transforms', () => {
  test('import * as ns from "mod" -> const ns = await __require__("mod")', () => {
    const src = `import * as myns from 'mod';`;
    const out = normalizeCjsEsm(src);
    expect(out).toContain("const myns = await __require__('mod')");
  });

  test('default import -> prefer default when present', () => {
    const src = `import foo from 'mod';`;
    const out = normalizeCjsEsm(src);
    expect(out).toContain("const foo = (tmp => tmp && tmp.default !== undefined ? tmp.default : tmp)(await __require__('mod'))");
  });

  test('default + named import -> temp module + destructuring', () => {
    const src = `import foo, { a, b } from 'mod';`;
    const out = normalizeCjsEsm(src);
    expect(out).toContain("const __mod_tmp = await __require__('mod')");
    expect(out).toContain('const foo =');
    expect(out).toContain('const {a, b} = __mod_tmp');
  });

  test('named-only import -> destructured const from __require__', () => {
    const src = `import { a, b } from 'mod';`;
    const out = normalizeCjsEsm(src);
    expect(out).toContain("const {a, b} = await __require__('mod')");
  });

  test('side-effect import -> await __require__ called', () => {
    const src = `import 'side-effect';`;
    const out = normalizeCjsEsm(src);
    expect(out).toContain("await __require__('side-effect')");
  });

  test('require -> await __require__ conversion', () => {
    const src = `const x = require('pkg');`;
    const out = normalizeCjsEsm(src);
    expect(out).toContain("await __require__('pkg')");
  });

  test('dynamic import and import.meta are preserved', () => {
    const src = `const p = import('./mod'); const url = import.meta.url;`;
    const out = normalizeCjsEsm(src);
    // dynamic import should remain as import(...)
    expect(out).toContain("import('./mod')");
    // import.meta.url must be preserved
    expect(out).toContain('import.meta.url');
  });
});
