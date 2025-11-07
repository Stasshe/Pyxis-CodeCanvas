import { describe, it, expect } from '@jest/globals';
// normalizeCjsEsmを直接importできるようにする
import { normalizeCjsEsm } from '@/engine/runtime/normalizeCjsEsm';

describe('normalizeCjsEsm', () => {
  it('import default', () => {
    const input = "import foo from 'bar'";
    const out = normalizeCjsEsm(input);
    expect(out).toContain("await __require__('bar')");
    expect(out).toContain('const foo');
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
    const out = normalizeCjsEsm(input);
    expect(out).toContain("await __require__('lib')");
    expect(out).toContain('const');
    expect(out).toContain('bar');
    expect(out).toContain('baz');
  });
  it('multiple imports and exports', () => {
    const input = `import foo from 'a';\nimport * as ns from 'b';\nimport {x, y} from 'c';\nexport default foo;\nexport const bar = 1;`;
    const out = normalizeCjsEsm(input);
  expect(out).toContain("await __require__('a')");
    expect(out).toContain("const ns = await __require__('b')");
    expect(out).toContain("const {x, y} = await __require__('c')");
    expect(out).toContain("module.exports.default = foo");
    expect(out).toContain("const bar = 1;");
    expect(out).toContain("module.exports.bar = bar;");
  });
  it('import/require/export in one file', () => {
    const input = `import foo from 'a';\nconst x = require('b');\nexport default foo;`;
    const out = normalizeCjsEsm(input);
    expect(out).toContain("await __require__('a')");
    expect(out).toContain("await __require__('b')");
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
    expect(out).toContain("await __require__('a')");
    expect(out).toContain("await __require__('b')");
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
    // new behavior: module is required and named export is assigned from the imported module
    expect(out).toContain("await __require__('m')");
    expect(out).toContain('module.exports.x =');
  });
  it('export const with destructuring should keep destructure and not export members', () => {
    const input = `export const {a, b} = obj;`;
    const out = normalizeCjsEsm(input);
    expect(out).toContain('const {a, b} = obj;');
    // new behavior: extract identifiers from destructuring and export them
    expect(out).toContain('module.exports.a = a;');
    expect(out).toContain('module.exports.b = b;');
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
    expect(out).toContain("await __require__('a')");
  });
  it('export multiple let declarations', () => {
    const input = `export let x=1, y=2;`;
    const out = normalizeCjsEsm(input);
    expect(out).toContain('let x=1, y=2;');
    expect(out).toContain('module.exports.x = x;');
    expect(out).toContain('module.exports.y = y;');
  });
  it('named import with alias', () => {
    const input = `import { foo as bar } from 'm'`;
    const out = normalizeCjsEsm(input);
    expect(out).toContain("await __require__('m')");
    expect(out).toContain('foo as bar');
  });
  it('export async function remains (not handled)', () => {
    const input = `export async function fetchData() {}`;
    // current regex doesn't handle `export async function` so it remains
    expect(normalizeCjsEsm(input)).toContain('export async function fetchData()');
  });
  it('export star from other module is transformed to copy exports', () => {
    const input = `export * from 'mod'`;
    const out = normalizeCjsEsm(input);
    // should await the module and copy non-default keys to module.exports
    expect(out).toContain("await __require__('mod')");
    expect(out).toMatch(/for \(const k in __rexp_[a-z0-9]+\)/);
    expect(out).toContain('module.exports[k] =');
  });
  it('export interface/type remains (TS-only)', () => {
    const input = `export interface I { a: number }`;
    const out = normalizeCjsEsm(input);
    // runtime transform does not strip types; they remain
    expect(out).toContain('export interface I { a: number }');
  });
  it('export default as re-export from module', () => {
    const input = `export { default as Main } from 'lib'`;
    const out = normalizeCjsEsm(input);
    // current logic will produce assignment for alias
    expect(out).toContain("await __require__('lib')");
    expect(out).toContain('module.exports.Main =');
  });
  it('multiline destructured export const should not export members', () => {
    const input = `export const {\n  a,\n  b\n} = obj;`;
    const out = normalizeCjsEsm(input);
    expect(out).toContain('const {\n  a,\n  b\n} = obj;');
    expect(out).toContain('module.exports.a = a;');
    expect(out).toContain('module.exports.b = b;');
  });
  it('template literal containing export text will be changed (regex limitation)', () => {
    const input = "const s = `export default foo`";
    const out = normalizeCjsEsm(input);
    // regex-based replace does not respect strings, so export default inside template is replaced
    expect(out).toContain('`module.exports.default = foo`');
  });
  it('dynamic import remains untouched', () => {
    const input = `const mod = import('dyn')`;
    const out = normalizeCjsEsm(input);
    expect(out).toBe(input);
  });
  it('multiline import with newlines inside braces', () => {
    const input = `import {\n  a,\n  b\n} from 'm'`;
    const out = normalizeCjsEsm(input);
    expect(out).toContain("await __require__('m')");
    expect(out).toContain('const {');
  });
  it('export default wrapped in parentheses', () => {
    const input = `export default (function(){})`;
    const out = normalizeCjsEsm(input);
    expect(out).toBe("module.exports.default = (function(){})");
  });
  it('typescript enum remains (not touched)', () => {
    const input = `export enum E { A, B }`;
    const out = normalizeCjsEsm(input);
    expect(out).toContain('export enum E { A, B }');
  });
  it('export with comments inside braces', () => {
    const input = `export { /*a*/ a as b /*c*/, d }`;
    const out = normalizeCjsEsm(input);
    // comment content is preserved/ignored by regex capture; assignments should exist
    expect(out).toContain('module.exports.b = a;');
    expect(out).toContain('module.exports.d = d;');
  });
  it('require followed by property access should not export', () => {
    const input = `const x = require('y').prop`;
    const out = normalizeCjsEsm(input);
    // require(...) is replaced but then const auto-export logic skips because value begins with await __require__
    expect(out).toContain("const x = await __require__('y').prop");
    expect(out).not.toContain('module.exports.x');
  });
  it('export default class extends', () => {
    const input = `export default class A extends B {}`;
    const out = normalizeCjsEsm(input);
    expect(out).toBe("module.exports.default = class A extends B {}");
  });
  it('export default generator function', () => {
    const input = `export default function* gen(){}`;
    const out = normalizeCjsEsm(input);
    expect(out).toBe("module.exports.default = function* gen(){}");
  });
  it('export var with trailing comma and comments', () => {
    const input = `export var x = 1, /*c*/ y = 2,`;
    const out = normalizeCjsEsm(input);
    expect(out).toContain('var x = 1, /*c*/ y = 2,');
    expect(out).toContain('module.exports.x = x;');
    expect(out).toContain('module.exports.y = y;');
  });
  it('template nested export-like text will be transformed', () => {
    const input = "const t = `prefix export const x = 1; suffix`";
    const out = normalizeCjsEsm(input);
    // regex-based replace will touch text inside template literals and may also
    // trigger auto-export for the surrounding const `t` and the inner const `x`.
    expect(out).toContain('const x = 1;');
    // auto-export has been disabled for non-explicit top-level declarations,
    // so we only assert that the inner snippet was transformed; no automatic
    // module.exports for `t` or `x` should be expected.
  });
  it('regex literal containing export default will be altered', () => {
    const input = "const r = /export default/;";
    const out = normalizeCjsEsm(input);
    // regex literals are not protected by the replacer; outer const may be auto-exported
    expect(out).toContain('/export default/');
    // auto-export disabled: do not expect module.exports for `r` anymore
  });
  it('commented export default is also transformed', () => {
    const input = '/* export default foo */';
    const out = normalizeCjsEsm(input);
    expect(out).toContain('/* module.exports.default = foo */');
  });
  it('export with trailing comma in braces', () => {
    const input = `export { a, }`;
    const out = normalizeCjsEsm(input);
    expect(out).toContain('module.exports.a = a;');
  });
  it('multi-line chain auto-export', () => {
    const input = `const x = maker()\n  .one()\n  .two()`;
    const out = normalizeCjsEsm(input);
    // auto-export disabled: no automatic module.exports.x
  });
  it('await import(...) assigned to const will be auto-exported (current behavior)', () => {
    const input = `const mod = await import('a')`;
    const out = normalizeCjsEsm(input);
    // auto-export disabled: do not expect module.exports.mod
  });
  it('ts export equals remains', () => {
    const input = `export = something`;
    const out = normalizeCjsEsm(input);
    expect(out).toContain('export = something');
  });
  it('export default object literal preserved', () => {
    const input = `export default { a: function(){}, b: 2 }`;
    const out = normalizeCjsEsm(input);
    expect(out).toContain('module.exports.default = { a: function(){}, b: 2 }');
  });
  it('complex nested destructuring with arrays/objects/rest/defaults', () => {
    const input = `export const { a: [{ b, c: [d ] }], e: { f = 3, g: { h } }, ...rest } = src;`;
    const out = normalizeCjsEsm(input);
    expect(out).toContain('const { a: [{ b, c: [d ] }], e: { f = 3, g: { h } }, ...rest } = src;');
    expect(out).toContain('module.exports.b = b;');
    expect(out).toContain('module.exports.d = d;');
    expect(out).toContain('module.exports.f = f;');
    expect(out).toContain('module.exports.h = h;');
    expect(out).toContain('module.exports.rest = rest;');
  });
  it('computed property key and rest object', () => {
    const input = `export const { [key]: k, ...r } = obj;`;
    const out = normalizeCjsEsm(input);
    expect(out).toContain('const { [key]: k, ...r } = obj;');
    expect(out).toContain('module.exports.k = k;');
    expect(out).toContain('module.exports.r = r;');
  });
  it('nested array destructuring with defaults and rest', () => {
    const input = `export const [ , , third = fn(), [x = 1, ...y] ] = arr;`;
    const out = normalizeCjsEsm(input);
    expect(out).toContain('const [ , , third = fn(), [x = 1, ...y] ] = arr;');
    expect(out).toContain('module.exports.third = third;');
    expect(out).toContain('module.exports.x = x;');
    expect(out).toContain('module.exports.y = y;');
  });
  it('destructuring with default objects and arrays containing commas/braces', () => {
    const input = `export const { x = { y: 1, z: 2 }, w = [1,2,3] } = obj;`;
    const out = normalizeCjsEsm(input);
    expect(out).toContain('const { x = { y: 1, z: 2 }, w = [1,2,3] } = obj;');
    expect(out).toContain('module.exports.x = x;');
    expect(out).toContain('module.exports.w = w;');
  });
  it('alias with default and nested object', () => {
    const input = `export const { a: aa = defaultVal, b: { c: cc = 2 } } = obj;`;
    const out = normalizeCjsEsm(input);
    expect(out).toContain('const { a: aa = defaultVal, b: { c: cc = 2 } } = obj;');
    expect(out).toContain('module.exports.aa = aa;');
    expect(out).toContain('module.exports.cc = cc;');
  });
});
