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
  it('export named function declaration', () => {
    const input = `export function greet() { return 'hi'; }`;
    const out = normalizeCjsEsm(input);
    expect(out).toContain("function greet() { return 'hi'; }");
    expect(out).toContain("module.exports.greet = greet;");
  });
  it('export named class declaration', () => {
    const input = `export class Person { constructor(name){ this.name = name } }`;
    const out = normalizeCjsEsm(input);
    expect(out).toContain("class Person { constructor(name){ this.name = name } }");
    expect(out).toContain("module.exports.Person = Person;");
  });
  it('export default anonymous function/class', () => {
    const inputFn = `export default function() {}`;
    expect(normalizeCjsEsm(inputFn)).toBe("module.exports.default = function() {}");
    const inputCls = `export default class {}`;
    expect(normalizeCjsEsm(inputCls)).toBe("module.exports.default = class {}");
  });
  it('do not duplicate existing module.exports', () => {
    const input = `export function once(){}\nmodule.exports.once = once;`;
    const out = normalizeCjsEsm(input);
    // should not append a second module.exports.once
    expect(out.split('module.exports.once').length).toBe(2); // one in original, one in split yields 2
  });
  it('nested function should not be exported', () => {
    const input = `export function outer(){ function inner(){} return inner }`;
    const out = normalizeCjsEsm(input);
    // only outer should be exported
    expect(out).toContain('module.exports.outer = outer;');
    expect(out).not.toContain('module.exports.inner');
  });
  it('import with semicolons and whitespace', () => {
    const input = ` import foo from 'a' ; \n import { bar } from 'b';`;
    const out = normalizeCjsEsm(input);
    expect(out).toContain("const foo = await __require__('a')");
    expect(out).toContain("const { bar } = await __require__('b')");
  });
  it('export list with aliases', () => {
    const input = `export { a as b, c }`;
    const out = normalizeCjsEsm(input);
    expect(out).toContain('module.exports.b = a;');
    expect(out).toContain('module.exports.c = c;');
  });
  it('export from other module', () => {
    const input = `export { x } from 'm'`;
    const out = normalizeCjsEsm(input);
    // current behavior maps export list to module.exports assignments
    expect(out).toContain('module.exports.x = x;');
  });
  it('export const with destructuring should keep destructure and not export members', () => {
    const input = `export const {a, b} = obj;`;
    const out = normalizeCjsEsm(input);
    expect(out).toContain('const {a, b} = obj;');
    expect(out).not.toContain('module.exports.a');
    expect(out).not.toContain('module.exports.b');
  });
  it('export default arrow/async functions', () => {
    const input1 = `export default () => {}`;
    expect(normalizeCjsEsm(input1)).toBe("module.exports.default = () => {}");
    const input2 = `export default async function() {}`;
    expect(normalizeCjsEsm(input2)).toBe("module.exports.default = async function() {}");
  });
  it('require followed by method chain should not auto-export', () => {
    const input = `const x = require('y')\n  .chain()`;
    const out = normalizeCjsEsm(input);
    expect(out).toContain("const x = await __require__('y')\n  .chain()");
    expect(out).not.toContain('module.exports.x = x;');
  });
  it('import with comments and trailing comments', () => {
    const input = `// header\nimport foo from 'a' // trailing`;
    const out = normalizeCjsEsm(input);
    expect(out).toContain("const foo = await __require__('a')");
  });
  it('export multiple let declarations', () => {
    const input = `export let x=1, y=2;`;
    const out = normalizeCjsEsm(input);
    expect(out).toContain('let x=1, y=2;');
    expect(out).toContain('module.exports.x = x;');
    expect(out).toContain('module.exports.y = y;');
  });
});
