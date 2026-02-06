import { describe, it, expect } from 'vitest';
import { hasGlob, splitOnIFS } from '@/engine/cmd/shell/expansion';

/**
 * シェル展開ユーティリティのテスト (pure functions)
 */

describe('expansion', () => {
  // ==================== hasGlob ====================

  describe('hasGlob', () => {
    it('* を検出する', () => {
      expect(hasGlob('*.ts')).toBe(true);
    });

    it('? を検出する', () => {
      expect(hasGlob('file?.txt')).toBe(true);
    });

    it('[ ] を検出する', () => {
      expect(hasGlob('file[0-9].txt')).toBe(true);
    });

    it('グロブ文字なしは false', () => {
      expect(hasGlob('normal-file.txt')).toBe(false);
    });

    it('空文字は false', () => {
      expect(hasGlob('')).toBe(false);
    });

    it('パスにグロブを含む場合', () => {
      expect(hasGlob('src/**/*.ts')).toBe(true);
    });
  });

  // ==================== splitOnIFS ====================

  describe('splitOnIFS', () => {
    it('デフォルト IFS (空白) で分割', () => {
      expect(splitOnIFS('hello world')).toEqual(['hello', 'world']);
    });

    it('タブで分割', () => {
      expect(splitOnIFS('a\tb\tc')).toEqual(['a', 'b', 'c']);
    });

    it('改行で分割', () => {
      expect(splitOnIFS('line1\nline2\nline3')).toEqual(['line1', 'line2', 'line3']);
    });

    it('連続する空白を1つの区切りとして扱う', () => {
      expect(splitOnIFS('a    b')).toEqual(['a', 'b']);
    });

    it('先頭・末尾の空白をトリム', () => {
      expect(splitOnIFS('  hello  ')).toEqual(['hello']);
    });

    it('空文字列は [""] を返す', () => {
      expect(splitOnIFS('')).toEqual(['']);
    });

    it('カスタム IFS (カンマ)', () => {
      expect(splitOnIFS('a,b,c', ',')).toEqual(['a', 'b', 'c']);
    });

    it('カスタム IFS (コロン)', () => {
      expect(splitOnIFS('/usr/bin:/usr/local/bin:/home/bin', ':')).toEqual([
        '/usr/bin',
        '/usr/local/bin',
        '/home/bin',
      ]);
    });
  });
});
