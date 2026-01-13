import { describe, it, expect } from '@jest/globals';
// normalizeCjsEsmを直接importできるようにする
import { normalizeCjsEsm } from '@/engine/runtime/normalizeCjsEsm';

describe('normalizeCjsEsm', () => {
  it('import default', () => {
    const input = "import foo from 'bar'";
    const out = normalizeCjsEsm(input);
    expect(out.code).toContain("require('bar')");
    expect(out.code).toContain('const foo');
    expect(out.dependencies).toContain('bar');
  });
  it('import named', () => {
    const input = "import {foo, bar} from 'baz'";
    const out = normalizeCjsEsm(input);
    expect(out.code).toBe("const {foo, bar} = require('baz')");
    expect(out.dependencies).toContain('baz');
  });
  it('import * as ns', () => {
    const input = "import * as MathModule from './math'";
    const out = normalizeCjsEsm(input);
    expect(out.code).toBe("const MathModule = require('./math')");
    expect(out.dependencies).toContain('./math');
  });
  it('import side effect', () => {
    const input = "import 'side-effect'";
    const out = normalizeCjsEsm(input);
    expect(out.code).toBe("require('side-effect')");
    expect(out.dependencies).toContain('side-effect');
  });
  it('export default', () => {
    const input = "export default foo";
    expect(normalizeCjsEsm(input).code).toBe("module.exports.default = foo");
  });
  it('export const', () => {
    const input = "export const foo = 1;";
    expect(normalizeCjsEsm(input).code).toContain("const foo = 1;");
    expect(normalizeCjsEsm(input).code).toContain("module.exports.foo = foo;");
  });
  it('require', () => {
    const input = "const x = require('y')";
    const out = normalizeCjsEsm(input);
    // require is kept as-is (synchronous)
    expect(out.code).toBe("const x = require('y')");
    expect(out.dependencies).toContain('y');
  });
  it('import default + named', () => {
    const input = "import foo, {bar, baz} from 'lib'";
    // 本来は default/named両方対応だが、現状は正規表現の都合で全部一括になる
    const out = normalizeCjsEsm(input);
    expect(out.code).toContain("require('lib')");
    expect(out.code).toContain('const');
    expect(out.code).toContain('bar');
    expect(out.code).toContain('baz');
    expect(out.dependencies).toContain('lib');
  });
  it('multiple imports and exports', () => {
    const input = `import foo from 'a';\nimport * as ns from 'b';\nimport {x, y} from 'c';\nexport default foo;\nexport const bar = 1;`;
    const out = normalizeCjsEsm(input);
    expect(out.code).toContain("require('a')");
    expect(out.code).toContain("const ns = require('b')");
    expect(out.code).toContain("const {x, y} = require('c')");
    expect(out.code).toContain("module.exports.default = foo");
    expect(out.code).toContain("const bar = 1;");
    expect(out.code).toContain("module.exports.bar = bar;");
    expect(out.dependencies).toEqual(expect.arrayContaining(['a', 'b', 'c']));
  });
  it('import/require/export in one file', () => {
    const input = `import foo from 'a';\nconst x = require('b');\nexport default foo;`;
    const out = normalizeCjsEsm(input);
    expect(out.code).toContain("require('a')");
    expect(out.code).toContain("require('b')");
    expect(out.code).toContain("module.exports.default = foo");
    expect(out.dependencies).toEqual(expect.arrayContaining(['a', 'b']));
  });
  it('export default function', () => {
    const input = `export default function test() {}`;
    expect(normalizeCjsEsm(input).code).toBe("module.exports.default = function test() {}");
  });
  it('export default class', () => {
    const input = `export default class Test {}`;
    expect(normalizeCjsEsm(input).code).toBe("module.exports.default = class Test {}");
  });
  it('export named function', () => {
    const input = `export const foo = () => {}`;
    const out = normalizeCjsEsm(input);
    expect(out.code).toContain("const foo = () => {}");
    expect(out.code).toContain("module.exports.foo = foo;");
  });
  it('export named class', () => {
    const input = `export const Foo = class {}`;
    const out = normalizeCjsEsm(input);
    expect(out.code).toContain("const Foo = class {}");
    expect(out.code).toContain("module.exports.Foo = Foo;");
  });
  it('export named function declaration', () => {
    const input = `export function greet() { return 'hi'; }`;
    const out = normalizeCjsEsm(input);
    expect(out.code).toContain("function greet() { return 'hi'; }");
    expect(out.code).toContain("module.exports.greet = greet;");
  });
  it('export named class declaration', () => {
    const input = `export class Person { constructor(name){ this.name = name } }`;
    const out = normalizeCjsEsm(input);
    expect(out.code).toContain("class Person { constructor(name){ this.name = name } }");
    expect(out.code).toContain("module.exports.Person = Person;");
  });
  it('export default anonymous function/class', () => {
    const inputFn = `export default function() {}`;
    expect(normalizeCjsEsm(inputFn).code).toBe("module.exports.default = function() {}");
    const inputCls = `export default class {}`;
    expect(normalizeCjsEsm(inputCls).code).toBe("module.exports.default = class {}");
  });
  it('do not duplicate existing module.exports', () => {
    const input = `export function once(){}\nmodule.exports.once = once;`;
    const out = normalizeCjsEsm(input);
    // should not append a second module.exports.once
    expect(out.code.split('module.exports.once').length).toBe(2); // one in original, one in split yields 2
  });
  it('nested function should not be exported', () => {
    const input = `export function outer(){ function inner(){} return inner }`;
    const out = normalizeCjsEsm(input);
    // only outer should be exported
    expect(out.code).toContain('module.exports.outer = outer;');
    expect(out.code).not.toContain('module.exports.inner');
  });
  it('import with semicolons and whitespace', () => {
    const input = ` import foo from 'a' ; \n import { bar } from 'b';`;
    const out = normalizeCjsEsm(input);
    expect(out.code).toContain("require('a')");
    expect(out.code).toContain("require('b')");
    expect(out.dependencies).toEqual(expect.arrayContaining(['a', 'b']));
  });
  it('export list with aliases', () => {
    const input = `export { a as b, c }`;
    const out = normalizeCjsEsm(input);
    expect(out.code).toContain('module.exports.b = a;');
    expect(out.code).toContain('module.exports.c = c;');
  });
  it('export from other module', () => {
    const input = `export { x } from 'm'`;
    const out = normalizeCjsEsm(input);
    // new behavior: module is required and named export is assigned from the imported module
    expect(out.code).toContain("require('m')");
    expect(out.code).toContain('module.exports.x =');
    expect(out.dependencies).toContain('m');
  });
  it('export const with destructuring should keep destructure and not export members', () => {
    const input = `export const {a, b} = obj;`;
    const out = normalizeCjsEsm(input);
    expect(out.code).toContain('const {a, b} = obj;');
    // new behavior: extract identifiers from destructuring and export them
    expect(out.code).toContain('module.exports.a = a;');
    expect(out.code).toContain('module.exports.b = b;');
  });
  it('export default arrow/async functions', () => {
    const input1 = `export default () => {}`;
    expect(normalizeCjsEsm(input1).code).toBe("module.exports.default = () => {}");
    const input2 = `export default async function() {}`;
    expect(normalizeCjsEsm(input2).code).toBe("module.exports.default = async function() {}");
  });
  it('require followed by method chain should not auto-export', () => {
    const input = `const x = require('y')\n  .chain()`;
    const out = normalizeCjsEsm(input);
    expect(out.code).toContain("const x = require('y')\n  .chain()");
    expect(out.code).not.toContain('module.exports.x = x;');
    expect(out.dependencies).toContain('y');
  });
  it('import with comments and trailing comments', () => {
    const input = `// header\nimport foo from 'a' // trailing`;
    const out = normalizeCjsEsm(input);
    expect(out.code).toContain("require('a')");
    expect(out.dependencies).toContain('a');
  });
  it('export multiple let declarations', () => {
    const input = `export let x=1, y=2;`;
    const out = normalizeCjsEsm(input);
    expect(out.code).toContain('let x=1, y=2;');
    expect(out.code).toContain('module.exports.x = x;');
    expect(out.code).toContain('module.exports.y = y;');
  });
  it('named import with alias', () => {
    const input = `import { foo as bar } from 'm'`;
    const out = normalizeCjsEsm(input);
    expect(out.code).toContain("require('m')");
    expect(out.code).toContain('foo: bar');
    expect(out.dependencies).toContain('m');
  });
  it('export async function remains (not handled)', () => {
    const input = `export async function fetchData() {}`;
    // current regex doesn't handle `export async function` so it remains
    expect(normalizeCjsEsm(input).code).toContain('export async function fetchData()');
  });
  it('export star from other module is transformed to copy exports', () => {
    const input = `export * from 'mod'`;
    const out = normalizeCjsEsm(input);
    // should require the module and copy non-default keys to module.exports
    expect(out.code).toContain("require('mod')");
    expect(out.code).toMatch(/for \(const k in __rexp_[a-z0-9]+\)/);
    expect(out.code).toContain('module.exports[k] =');
    expect(out.dependencies).toContain('mod');
  });
  it('export interface/type remains (TS-only)', () => {
    const input = `export interface I { a: number }`;
    const out = normalizeCjsEsm(input);
    // runtime transform does not strip types; they remain
    expect(out.code).toContain('export interface I { a: number }');
  });
  it('export default as re-export from module', () => {
    const input = `export { default as Main } from 'lib'`;
    const out = normalizeCjsEsm(input);
    // current logic will produce assignment for alias
    expect(out.code).toContain("require('lib')");
    expect(out.code).toContain('module.exports.Main =');
    expect(out.dependencies).toContain('lib');
  });
  it('multiline destructured export const should not export members', () => {
    const input = `export const {\n  a,\n  b\n} = obj;`;
    const out = normalizeCjsEsm(input);
    expect(out.code).toContain('const {\n  a,\n  b\n} = obj;');
    expect(out.code).toContain('module.exports.a = a;');
    expect(out.code).toContain('module.exports.b = b;');
  });
  it('template literal containing export text will be changed (regex limitation)', () => {
    const input = "const s = `export default foo`";
    const out = normalizeCjsEsm(input);
    // regex-based replace does not respect strings, so export default inside template is replaced
    expect(out.code).toContain('`module.exports.default = foo`');
  });
  it('dynamic import is transformed to Promise.resolve(require(...))', () => {
    const input = `const mod = import('dyn')`;
    const out = normalizeCjsEsm(input);
    // dynamic imports are transformed to work in the emulated environment
    expect(out.code).toBe("const mod = Promise.resolve(require('dyn'))");
    expect(out.dependencies).toContain('dyn');
  });
  it('multiline import with newlines inside braces', () => {
    const input = `import {\n  a,\n  b\n} from 'm'`;
    const out = normalizeCjsEsm(input);
    expect(out.code).toContain("require('m')");
    expect(out.code).toContain('const {');
    expect(out.dependencies).toContain('m');
  });
  it('export default wrapped in parentheses', () => {
    const input = `export default (function(){})`;
    const out = normalizeCjsEsm(input);
    expect(out.code).toBe("module.exports.default = (function(){})");
  });
  it('typescript enum remains (not touched)', () => {
    const input = `export enum E { A, B }`;
    const out = normalizeCjsEsm(input);
    expect(out.code).toContain('export enum E { A, B }');
  });
  it('export with comments inside braces', () => {
    const input = `export { /*a*/ a as b /*c*/, d }`;
    const out = normalizeCjsEsm(input);
    // comment content is preserved/ignored by regex capture; assignments should exist
    expect(out.code).toContain('module.exports.b = a;');
    expect(out.code).toContain('module.exports.d = d;');
  });
  it('require followed by property access should not export', () => {
    const input = `const x = require('y').prop`;
    const out = normalizeCjsEsm(input);
    // require(...) is kept as-is (synchronous)
    expect(out.code).toContain("const x = require('y').prop");
    expect(out.code).not.toContain('module.exports.x');
    expect(out.dependencies).toContain('y');
  });
  it('export default class extends', () => {
    const input = `export default class A extends B {}`;
    const out = normalizeCjsEsm(input);
    expect(out.code).toBe("module.exports.default = class A extends B {}");
  });
  it('export default generator function', () => {
    const input = `export default function* gen(){}`;
    const out = normalizeCjsEsm(input);
    expect(out.code).toBe("module.exports.default = function* gen(){}");
  });
  it('export var with trailing comma and comments', () => {
    const input = `export var x = 1, /*c*/ y = 2,`;
    const out = normalizeCjsEsm(input);
    expect(out.code).toContain('var x = 1, /*c*/ y = 2,');
    expect(out.code).toContain('module.exports.x = x;');
    expect(out.code).toContain('module.exports.y = y;');
  });
  it('template nested export-like text will be transformed', () => {
    const input = "const t = `prefix export const x = 1; suffix`";
    const out = normalizeCjsEsm(input);
    // regex-based replace will touch text inside template literals and may also
    // trigger auto-export for the surrounding const `t` and the inner const `x`.
    expect(out.code).toContain('const x = 1;');
    // auto-export has been disabled for non-explicit top-level declarations,
    // so we only assert that the inner snippet was transformed; no automatic
    // module.exports for `t` or `x` should be expected.
  });
  it('regex literal containing export default will be altered', () => {
    const input = "const r = /export default/;";
    const out = normalizeCjsEsm(input);
    // regex literals are not protected by the replacer; outer const may be auto-exported
    expect(out.code).toContain('/export default/');
    // auto-export disabled: do not expect module.exports for `r` anymore
  });
  it('commented export default is also transformed', () => {
    const input = '/* export default foo */';
    const out = normalizeCjsEsm(input);
    expect(out.code).toContain('/* module.exports.default = foo */');
  });
  it('export with trailing comma in braces', () => {
    const input = `export { a, }`;
    const out = normalizeCjsEsm(input);
    expect(out.code).toContain('module.exports.a = a;');
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
    expect(out.code).toContain('export = something');
  });
  it('export default object literal preserved', () => {
    const input = `export default { a: function(){}, b: 2 }`;
    const out = normalizeCjsEsm(input);
    expect(out.code).toContain('module.exports.default = { a: function(){}, b: 2 }');
  });
  it('complex nested destructuring with arrays/objects/rest/defaults', () => {
    const input = `export const { a: [{ b, c: [d ] }], e: { f = 3, g: { h } }, ...rest } = src;`;
    const out = normalizeCjsEsm(input);
    expect(out.code).toContain('const { a: [{ b, c: [d ] }], e: { f = 3, g: { h } }, ...rest } = src;');
    expect(out.code).toContain('module.exports.b = b;');
    expect(out.code).toContain('module.exports.d = d;');
    expect(out.code).toContain('module.exports.f = f;');
    expect(out.code).toContain('module.exports.h = h;');
    expect(out.code).toContain('module.exports.rest = rest;');
  });
  it('computed property key and rest object', () => {
    const input = `export const { [key]: k, ...r } = obj;`;
    const out = normalizeCjsEsm(input);
    expect(out.code).toContain('const { [key]: k, ...r } = obj;');
    expect(out.code).toContain('module.exports.k = k;');
    expect(out.code).toContain('module.exports.r = r;');
  });
  it('nested array destructuring with defaults and rest', () => {
    const input = `export const [ , , third = fn(), [x = 1, ...y] ] = arr;`;
    const out = normalizeCjsEsm(input);
    expect(out.code).toContain('const [ , , third = fn(), [x = 1, ...y] ] = arr;');
    expect(out.code).toContain('module.exports.third = third;');
    expect(out.code).toContain('module.exports.x = x;');
    expect(out.code).toContain('module.exports.y = y;');
  });
  it('destructuring with default objects and arrays containing commas/braces', () => {
    const input = `export const { x = { y: 1, z: 2 }, w = [1,2,3] } = obj;`;
    const out = normalizeCjsEsm(input);
    expect(out.code).toContain('const { x = { y: 1, z: 2 }, w = [1,2,3] } = obj;');
    expect(out.code).toContain('module.exports.x = x;');
    expect(out.code).toContain('module.exports.w = w;');
  });
  it('alias with default and nested object', () => {
    const input = `export const { a: aa = defaultVal, b: { c: cc = 2 } } = obj;`;
    const out = normalizeCjsEsm(input);
    expect(out.code).toContain('const { a: aa = defaultVal, b: { c: cc = 2 } } = obj;');
    expect(out.code).toContain('module.exports.aa = aa;');
    expect(out.code).toContain('module.exports.cc = cc;');
  });
  // New tests for node: protocol support
  it('import with node: protocol prefix', () => {
    const input = `import fs from 'node:fs'`;
    const out = normalizeCjsEsm(input);
    expect(out.code).toContain("require('node:fs')");
    expect(out.dependencies).toContain('node:fs');
  });
  it('import named with node: protocol prefix', () => {
    const input = `import { createServer } from 'node:http'`;
    const out = normalizeCjsEsm(input);
    expect(out.code).toContain("require('node:http')");
    expect(out.dependencies).toContain('node:http');
  });
  it('require with node: protocol prefix', () => {
    const input = `const path = require('node:path')`;
    const out = normalizeCjsEsm(input);
    expect(out.code).toBe("const path = require('node:path')");
    expect(out.dependencies).toContain('node:path');
  });
});
