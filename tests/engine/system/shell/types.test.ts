import { describe, expect, it } from 'vitest';
import { isDevNull, isSpecialFile, SPECIAL_FILES } from '@/engine/system/shell/types';

/**
 * シェル型ユーティリティのテスト
 */

describe('shell types', () => {
  // ==================== SPECIAL_FILES ====================

  describe('SPECIAL_FILES', () => {
    it('定数が正しく定義されている', () => {
      expect(SPECIAL_FILES.DEV_NULL).toBe('/dev/null');
      expect(SPECIAL_FILES.DEV_STDIN).toBe('/dev/stdin');
      expect(SPECIAL_FILES.DEV_STDOUT).toBe('/dev/stdout');
      expect(SPECIAL_FILES.DEV_STDERR).toBe('/dev/stderr');
    });
  });

  // ==================== isSpecialFile ====================

  describe('isSpecialFile', () => {
    it('/dev/null は特殊ファイル', () => {
      expect(isSpecialFile('/dev/null')).toBe(true);
    });

    it('/dev/stdin は特殊ファイル', () => {
      expect(isSpecialFile('/dev/stdin')).toBe(true);
    });

    it('/dev/stdout は特殊ファイル', () => {
      expect(isSpecialFile('/dev/stdout')).toBe(true);
    });

    it('/dev/stderr は特殊ファイル', () => {
      expect(isSpecialFile('/dev/stderr')).toBe(true);
    });

    it('通常ファイルは false', () => {
      expect(isSpecialFile('/tmp/file.txt')).toBe(false);
    });

    it('null は false', () => {
      expect(isSpecialFile(null)).toBe(false);
    });

    it('undefined は false', () => {
      expect(isSpecialFile(undefined)).toBe(false);
    });

    it('相対パスは特殊ファイルとして扱わない', () => {
      expect(isSpecialFile('dev/null')).toBe(false);
    });
  });

  // ==================== isDevNull ====================

  describe('isDevNull', () => {
    it('/dev/null は true', () => {
      expect(isDevNull('/dev/null')).toBe(true);
    });

    it('null は false', () => {
      expect(isDevNull(null)).toBe(false);
    });

    it('undefined は false', () => {
      expect(isDevNull(undefined)).toBe(false);
    });

    it('相対パスは /dev/null として扱わない', () => {
      expect(isDevNull('dev/null')).toBe(false);
    });
  });
});
