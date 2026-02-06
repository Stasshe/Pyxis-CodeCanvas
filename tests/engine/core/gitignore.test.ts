import { describe, it, expect } from 'vitest';
import { parseGitignore, isPathIgnored, ensureGitignoreContains } from '@/engine/core/gitignore';

/**
 * gitignore パーサーのテスト
 * POSIX 準拠のパターンマッチングを検証
 */

describe('gitignore', () => {
  // ==================== parseGitignore ====================

  describe('parseGitignore', () => {
    it('基本的なパターンをパースする', () => {
      const rules = parseGitignore('node_modules\n*.log\n');
      expect(rules).toHaveLength(2);
      expect(rules[0].pattern).toBe('node_modules');
      expect(rules[1].pattern).toContain('log');
    });

    it('コメントと空行を無視する', () => {
      const rules = parseGitignore('# comment\n\nnode_modules\n');
      expect(rules).toHaveLength(1);
    });

    it('否定パターンを認識する', () => {
      const rules = parseGitignore('*.log\n!important.log\n');
      expect(rules[0].negation).toBe(false);
      expect(rules[1].negation).toBe(true);
    });

    it('ディレクトリ専用パターン (末尾スラッシュ) を認識する', () => {
      const rules = parseGitignore('build/\n');
      expect(rules[0].directoryOnly).toBe(true);
    });
  });

  // ==================== isPathIgnored ====================

  describe('isPathIgnored', () => {
    it('ワイルドカードパターンにマッチする', () => {
      const rules = parseGitignore('*.log\n');
      expect(isPathIgnored(rules, 'debug.log')).toBe(true);
      expect(isPathIgnored(rules, 'src/app.ts')).toBe(false);
    });

    it('ディレクトリパターンにマッチする', () => {
      const rules = parseGitignore('node_modules\n');
      expect(isPathIgnored(rules, 'node_modules/package/index.js')).toBe(true);
    });

    it('** グロブパターンにマッチする', () => {
      const rules = parseGitignore('**/dist\n');
      expect(isPathIgnored(rules, 'dist')).toBe(true);
      expect(isPathIgnored(rules, 'packages/app/dist')).toBe(true);
    });

    it('否定パターンで除外を解除する', () => {
      const rules = parseGitignore('*.log\n!important.log\n');
      expect(isPathIgnored(rules, 'debug.log')).toBe(true);
      expect(isPathIgnored(rules, 'important.log')).toBe(false);
    });

    it('ディレクトリ専用パターンはディレクトリにマッチする', () => {
      const rules = parseGitignore('build/\n');
      expect(isPathIgnored(rules, 'build', true)).toBe(true);
    });

    it('ルールが空なら常に false', () => {
      expect(isPathIgnored([], 'anything')).toBe(false);
    });

    it('複合ルールで正しく判定する', () => {
      const rules = parseGitignore([
        'node_modules',
        '*.log',
        '!error.log',
        'dist/',
        '.env',
        '.env.local',
      ].join('\n'));

      expect(isPathIgnored(rules, 'node_modules/express/index.js')).toBe(true);
      expect(isPathIgnored(rules, 'app.log')).toBe(true);
      expect(isPathIgnored(rules, 'error.log')).toBe(false);
      expect(isPathIgnored(rules, 'dist', true)).toBe(true);
      expect(isPathIgnored(rules, '.env')).toBe(true);
      expect(isPathIgnored(rules, '.env.local')).toBe(true);
      expect(isPathIgnored(rules, 'src/main.ts')).toBe(false);
    });
  });

  // ==================== ensureGitignoreContains ====================

  describe('ensureGitignoreContains', () => {
    it('エントリが存在しなければ追加する', () => {
      const result = ensureGitignoreContains('node_modules\n', 'dist');
      expect(result.changed).toBe(true);
      expect(result.content).toContain('dist');
    });

    it('エントリが既に存在すれば変更しない', () => {
      const result = ensureGitignoreContains('node_modules\ndist\n', 'dist');
      expect(result.changed).toBe(false);
    });

    it('undefined コンテンツでも動作する', () => {
      const result = ensureGitignoreContains(undefined, 'node_modules');
      expect(result.changed).toBe(true);
      expect(result.content).toContain('node_modules');
    });

    it('デフォルトエントリが追加される', () => {
      const result = ensureGitignoreContains(undefined);
      expect(result.changed).toBe(true);
      expect(result.content.length).toBeGreaterThan(0);
    });
  });
});
