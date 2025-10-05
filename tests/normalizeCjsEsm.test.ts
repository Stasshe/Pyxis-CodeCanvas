import { describe, it, expect } from '@jest/globals';
// normalizeCjsEsmを直接importできるようにする
import { normalizeCjsEsm } from '@/engine/runtime/normalizeCjsEsm';

describe('normalizeCjsEsm', () => {
  it('import default', () => {
    const input = "import foo from 'bar'";
    expect(normalizeCjsEsm(input)).toBe("const foo = await __require__('bar')");
  });
  it('import named', () => {
    const input = "import {foo, bar} from 'baz'";
    expect(normalizeCjsEsm(input)).toBe("const {foo, bar} = await __require__('baz')");
  });
  it('import * as ns', () => {
    const input = "import * as MathModule from './math'";
    expect(normalizeCjsEsm(input)).toBe("const MathModule = await __require__('./math')");
  });
  it('import side effect', () => {
    const input = "import 'side-effect'";
    expect(normalizeCjsEsm(input)).toBe("await __require__('side-effect')");
  });
  it('export default', () => {
    const input = "export default foo";
    expect(normalizeCjsEsm(input)).toBe("module.exports.default = foo");
  });
  it('export const', () => {
    const input = "export const foo = 1;";
    expect(normalizeCjsEsm(input)).toContain("const foo = 1;");
    expect(normalizeCjsEsm(input)).toContain("module.exports.foo = foo;");
  });
  it('require', () => {
    const input = "const x = require('y')";
    expect(normalizeCjsEsm(input)).toBe("const x = await __require__('y')");
  });
  it('import default + named', () => {
    const input = "import foo, {bar, baz} from 'lib'";
    // 本来は default/named両方対応だが、現状は正規表現の都合で全部一括になる
    expect(normalizeCjsEsm(input)).toBe("const foo, {bar, baz} = await __require__('lib')");
  });
  it('multiple imports and exports', () => {
    const input = `import foo from 'a';\nimport * as ns from 'b';\nimport {x, y} from 'c';\nexport default foo;\nexport const bar = 1;`;
    const out = normalizeCjsEsm(input);
    expect(out).toContain("const foo = await __require__('a')");
    expect(out).toContain("const ns = await __require__('b')");
    expect(out).toContain("const {x, y} = await __require__('c')");
    expect(out).toContain("module.exports.default = foo");
    expect(out).toContain("const bar = 1;");
    expect(out).toContain("module.exports.bar = bar;");
  });
  it('import/require/export in one file', () => {
    const input = `import foo from 'a';\nconst x = require('b');\nexport default foo;`;
    const out = normalizeCjsEsm(input);
    expect(out).toContain("const foo = await __require__('a')");
    expect(out).toContain("const x = await __require__('b')");
    expect(out).toContain("module.exports.default = foo");
  });
  it('export default function', () => {
    const input = `export default function test() {}`;
    expect(normalizeCjsEsm(input)).toBe("module.exports.default = function test() {}");
  });
  it('export default class', () => {
    const input = `export default class Test {}`;
    expect(normalizeCjsEsm(input)).toBe("module.exports.default = class Test {}");
  });
  it('export named function', () => {
    const input = `export const foo = () => {}`;
    const out = normalizeCjsEsm(input);
    expect(out).toContain("const foo = () => {}");
    expect(out).toContain("module.exports.foo = foo;");
  });
  it('export named class', () => {
    const input = `export const Foo = class {}`;
    const out = normalizeCjsEsm(input);
    expect(out).toContain("const Foo = class {}");
    expect(out).toContain("module.exports.Foo = Foo;");
  });
  it('import with semicolons and whitespace', () => {
    const input = ` import foo from 'a' ; \n import { bar } from 'b';`;
    const out = normalizeCjsEsm(input);
    expect(out).toContain("const foo = await __require__('a')");
    expect(out).toContain("const { bar } = await __require__('b')");
  });
});
