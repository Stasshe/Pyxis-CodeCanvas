import { normalizeCjsEsm } from '@/engine/runtime/normalizeCjsEsm';

describe('normalizeCjsEsm - import related transforms', () => {
  test('import * as ns from "mod" -> const ns = require("mod")', () => {
    const src = `import * as myns from 'mod';`;
    const out = normalizeCjsEsm(src);
    expect(out.code).toContain("const myns = require('mod')");
    expect(out.dependencies).toContain('mod');
  });

  test('default import -> prefer default when present', () => {
    const src = `import foo from 'mod';`;
    const out = normalizeCjsEsm(src);
    expect(out.code).toContain("const foo = (tmp => tmp && tmp.default !== undefined ? tmp.default : tmp)(require('mod'))");
    expect(out.dependencies).toContain('mod');
  });

  test('default + named import -> temp module + destructuring', () => {
    const src = `import foo, { a, b } from 'mod';`;
    const out = normalizeCjsEsm(src);
    expect(out.code).toContain("const __mod_tmp = require('mod')");
    expect(out.code).toContain('const foo =');
    expect(out.code).toContain('const {a, b} = __mod_tmp');
    expect(out.dependencies).toContain('mod');
  });

  test('named-only import -> destructured const from require', () => {
    const src = `import { a, b } from 'mod';`;
    const out = normalizeCjsEsm(src);
    expect(out.code).toContain("const {a, b} = require('mod')");
    expect(out.dependencies).toContain('mod');
  });

  test('side-effect import -> require called', () => {
    const src = `import 'side-effect';`;
    const out = normalizeCjsEsm(src);
    expect(out.code).toContain("require('side-effect')");
    expect(out.dependencies).toContain('side-effect');
  });

  test('require -> kept as-is (synchronous)', () => {
    const src = `const x = require('pkg');`;
    const out = normalizeCjsEsm(src);
    expect(out.code).toContain("require('pkg')");
    expect(out.dependencies).toContain('pkg');
  });

  test('dynamic import is transformed to Promise.resolve(require(...))', () => {
    const src = `const p = import('./mod'); const url = import.meta.url;`;
    const out = normalizeCjsEsm(src);
    // dynamic import is transformed to Promise.resolve(require(...))
    expect(out.code).toContain("Promise.resolve(require('./mod'))");
    // import.meta.url is preserved
    expect(out.code).toContain('import.meta.url');
    expect(out.dependencies).toContain('./mod');
  });

  test('import with node: protocol prefix', () => {
    const src = `import * as fs from 'node:fs';`;
    const out = normalizeCjsEsm(src);
    expect(out.code).toContain("const fs = require('node:fs')");
    expect(out.dependencies).toContain('node:fs');
  });
});
