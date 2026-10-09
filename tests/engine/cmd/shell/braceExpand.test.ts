import { describe, expect, it } from 'vitest';
import expandBraces from '@/engine/cmd/shell/braceExpand';

/**
 * ブレース展開のテスト
 * Bash brace expansion
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

    it('matches Bash padding when negative endpoints have leading zeroes', () => {
      expect(expandBraces('{-02..02}')).toEqual(['-02', '-01', '000', '001', '002']);
      expect(expandBraces('{-2..02}')).toEqual(['-2', '-1', '00', '01', '02']);
      expect(expandBraces('{-02..2}')).toEqual(['-02', '-01', '000', '001', '002']);
      expect(expandBraces('{-002..002}')).toEqual(['-002', '-001', '0000', '0001', '0002']);
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
      expect(expandBraces('{abc}')).toEqual(['{abc}']);
    });

    it('preserves quoted, escaped and parameter braces', () => {
      expect(expandBraces('"{a,b}"')).toEqual(['"{a,b}"']);
      expect(expandBraces("'{a,b}'")).toEqual(["'{a,b}'"]);
      expect(expandBraces('\\{a,b}')).toEqual(['\\{a,b}']);
      expect(expandBraces('${VALUE:-{a,b}}')).toEqual(['${VALUE:-{a,b}}']);
    });

    it('continues after a literal pair and does not add implicit padding', () => {
      expect(expandBraces('{literal}{a,b}')).toEqual(['{literal}a', '{literal}b']);
      expect(expandBraces('{9..11}')).toEqual(['9', '10', '11']);
    });
  });
});
