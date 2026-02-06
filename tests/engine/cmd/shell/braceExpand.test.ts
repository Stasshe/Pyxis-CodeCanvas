import { describe, it, expect } from 'vitest';
import expandBraces from '@/engine/cmd/shell/braceExpand';

/**
 * ブレース展開のテスト
 * POSIX 準拠のブレース展開を検証
 */

describe('expandBraces', () => {
  // ==================== カンマリスト ====================

  describe('カンマリスト', () => {
    it('基本的なカンマ展開', () => {
      expect(expandBraces('a{b,c}d')).toEqual(['abd', 'acd']);
    });

    it('3要素のカンマ展開', () => {
      expect(expandBraces('file.{js,ts,tsx}')).toEqual(['file.js', 'file.ts', 'file.tsx']);
    });

    it('プレフィックスなし', () => {
      expect(expandBraces('{a,b,c}')).toEqual(['a', 'b', 'c']);
    });

    it('サフィックスなし', () => {
      expect(expandBraces('{hello,world}')).toEqual(['hello', 'world']);
    });

    it('空要素を含むカンマ展開', () => {
      expect(expandBraces('a{,b}c')).toEqual(['ac', 'abc']);
    });
  });

  // ==================== 数値範囲 ====================

  describe('数値範囲', () => {
    it('昇順の範囲', () => {
      expect(expandBraces('{1..3}')).toEqual(['1', '2', '3']);
    });

    it('降順の範囲', () => {
      expect(expandBraces('{3..1}')).toEqual(['3', '2', '1']);
    });

    it('ゼロパディング', () => {
      expect(expandBraces('{01..03}')).toEqual(['01', '02', '03']);
    });

    it('広いゼロパディング', () => {
      expect(expandBraces('{001..003}')).toEqual(['001', '002', '003']);
    });

    it('負の範囲', () => {
      const result = expandBraces('{-2..2}');
      expect(result).toEqual(['-2', '-1', '0', '1', '2']);
    });
  });

  // ==================== ネスト ====================

  describe('ネストされたブレース', () => {
    it('ネストされたカンマ展開', () => {
      expect(expandBraces('x{a,{b,c}}y')).toEqual(['xay', 'xby', 'xcy']);
    });

    it('深いネスト', () => {
      const result = expandBraces('{a,{b,{c,d}}}');
      expect(result).toEqual(['a', 'b', 'c', 'd']);
    });
  });

  // ==================== エッジケース ====================

  describe('エッジケース', () => {
    it('ブレースなしはそのまま返す', () => {
      expect(expandBraces('hello')).toEqual(['hello']);
    });

    it('閉じブレースがない場合はそのまま', () => {
      expect(expandBraces('a{b,c')).toEqual(['a{b,c']);
    });

    it('空文字列', () => {
      expect(expandBraces('')).toEqual(['']);
    });

    it('カンマなし (単一要素)', () => {
      // {abc} はカンマがないが splitTopLevelCommas は [abc] を返す
      expect(expandBraces('{abc}')).toEqual(['abc']);
    });
  });
});
