import { describe, it, expect } from 'vitest';
import { normalizeCjsEsm } from '@/engine/runtime/transpiler/normalizeCjsEsm';

/**
 * CJS/ESM 正規化のテスト
 * ESM import/export を CommonJS require/module.exports に変換する
 */

describe('normalizeCjsEsm', () => {
  // ==================== import 変換 ====================

  describe('import → require 変換', () => {
    it('import * as ns from "mod"', () => {
      const { code, dependencies } = normalizeCjsEsm("import * as fs from 'fs'");
      expect(code).toContain("const fs = require('fs')");
      expect(dependencies).toContain('fs');
    });

    it('import default from "mod"', () => {
      const { code, dependencies } = normalizeCjsEsm("import path from 'path'");
      expect(code).toContain("require('path')");
      expect(code).toContain('path');
      expect(dependencies).toContain('path');
    });

    it('import { a, b } from "mod"', () => {
      const { code, dependencies } = normalizeCjsEsm(
        "import { readFile, writeFile } from 'fs'"
      );
      expect(code).toContain("require('fs')");
      expect(code).toContain('readFile');
      expect(code).toContain('writeFile');
      expect(dependencies).toContain('fs');
    });

    it('import { a as b } from "mod" (alias)', () => {
      const { code } = normalizeCjsEsm("import { readFile as rf } from 'fs'");
      expect(code).toContain('readFile: rf');
      expect(code).toContain("require('fs')");
    });

    it("import 'side-effect'", () => {
      const { code, dependencies } = normalizeCjsEsm("import 'polyfill'");
      expect(code).toContain("require('polyfill')");
      expect(dependencies).toContain('polyfill');
    });

    it('import default + named: import foo, { a } from "mod"', () => {
      const { code, dependencies } = normalizeCjsEsm(
        "import React, { useState } from 'react'"
      );
      expect(code).toContain("require('react')");
      expect(code).toContain('React');
      expect(code).toContain('useState');
      expect(dependencies).toContain('react');
    });
  });

  // ==================== export 変換 ====================

  describe('export → module.exports 変換', () => {
    it('export default', () => {
      const { code } = normalizeCjsEsm('export default function main() {}');
      expect(code).toContain('module.exports.default');
    });

    it('export const', () => {
      const { code } = normalizeCjsEsm('export const VERSION = "1.0.0";');
      expect(code).toContain('module.exports.VERSION');
    });

    it('export function', () => {
      const { code } = normalizeCjsEsm('export function hello() { return "hi"; }');
      expect(code).toContain('module.exports.hello');
      // export keyword should be removed from function declaration
      expect(code).toMatch(/^function hello\(/m);
    });

    it('export class', () => {
      const { code } = normalizeCjsEsm('export class MyClass {}');
      expect(code).toContain('module.exports.MyClass');
      expect(code).toMatch(/^class MyClass /m);
    });

    it('export { a, b as c }', () => {
      const { code } = normalizeCjsEsm('const a = 1; const b = 2; export { a, b as c };');
      expect(code).toContain('module.exports.a = a');
      expect(code).toContain('module.exports.c = b');
    });

    it('export * from "mod"', () => {
      const { code, dependencies } = normalizeCjsEsm("export * from 'utils'");
      expect(code).toContain("require('utils')");
      expect(code).toContain('module.exports');
      expect(dependencies).toContain('utils');
    });

    it('export { a } from "mod" (re-export)', () => {
      const { code, dependencies } = normalizeCjsEsm("export { foo } from 'bar'");
      expect(code).toContain("require('bar')");
      expect(code).toContain('module.exports.foo');
      expect(dependencies).toContain('bar');
    });
  });

  // ==================== dynamic import ====================

  describe('dynamic import 変換', () => {
    it('import() → Promise.resolve(require())', () => {
      const { code } = normalizeCjsEsm("const m = import('lodash')");
      expect(code).toContain("Promise.resolve(require('lodash'))");
    });
  });

  // ==================== require 保持 ====================

  describe('require は変換しない', () => {
    it('require() はそのまま保持する', () => {
      const { code, dependencies } = normalizeCjsEsm("const fs = require('fs')");
      expect(code).toContain("require('fs')");
      expect(dependencies).toContain('fs');
    });
  });

  // ==================== 依存関係抽出 ====================

  describe('依存関係抽出', () => {
    it('複数の依存関係を抽出する', () => {
      const { dependencies } = normalizeCjsEsm(`
        import fs from 'fs';
        import path from 'path';
        const os = require('os');
      `);
      expect(dependencies).toContain('fs');
      expect(dependencies).toContain('path');
      expect(dependencies).toContain('os');
    });

    it('重複は除去される', () => {
      const { dependencies } = normalizeCjsEsm(`
        import { a } from 'mod';
        import { b } from 'mod';
        const c = require('mod');
      `);
      expect(dependencies.filter(d => d === 'mod')).toHaveLength(1);
    });
  });

  // ==================== import.meta ====================

  describe('import.meta の保護', () => {
    it('import.meta.url が保持される', () => {
      const { code } = normalizeCjsEsm('const url = import.meta.url;');
      // import.meta.url は '"file:///" + __filename' に変換される
      expect(code).toContain('import.meta');
    });
  });

  // ==================== 問題のある再宣言の除去 ====================

  describe('問題のある再宣言の除去', () => {
    it('const require = __prettier... を除去', () => {
      const { code } = normalizeCjsEsm('const require = __prettier_require;');
      expect(code).toContain('removed');
    });

    it("const process = require('process') を除去", () => {
      const { code } = normalizeCjsEsm("const process = require('process');");
      expect(code).toContain('removed');
    });
  });

  // ==================== 複合シナリオ ====================

  describe('複合シナリオ', () => {
    it('典型的なモジュールファイル', () => {
      const input = `
import fs from 'fs';
import { join } from 'path';

export const VERSION = '1.0';

export function readConfig(file) {
  return fs.readFileSync(join('.', file), 'utf-8');
}

export default readConfig;
      `.trim();

      const { code, dependencies } = normalizeCjsEsm(input);

      // imports が変換されている
      expect(code).toContain("require('fs')");
      expect(code).toContain("require('path')");

      // exports が変換されている
      expect(code).toContain('module.exports.VERSION');
      expect(code).toContain('module.exports.readConfig');
      expect(code).toContain('module.exports.default');

      // 依存関係
      expect(dependencies).toContain('fs');
      expect(dependencies).toContain('path');
    });
  });
});
