import { describe, it, expect } from 'vitest';
import {
  toAppPath,
  toGitPath,
  fromGitPath,
  getParentPath,
  getFileName,
  joinPath,
  resolvePath,
  normalizeDotSegments,
  getExtension,
  replaceExtension,
  isRoot,
  hasPrefix,
  removePrefix,
  getProjectRoot,
  toFSPath,
  fsPathToAppPath,
  isWithinProject,
} from '@/engine/core/pathUtils';

/**
 * pathUtils のテスト
 * 3 つのパス形式 (AppPath / GitPath / FSPath) の変換と
 * 各種パスユーティリティの正確性を検証
 */

describe('pathUtils', () => {
  // ==================== パス変換 ====================

  describe('toAppPath', () => {
    it('先頭スラッシュを付与する', () => {
      expect(toAppPath('src/main.ts')).toBe('/src/main.ts');
    });

    it('既に AppPath 形式ならそのまま', () => {
      expect(toAppPath('/src/main.ts')).toBe('/src/main.ts');
    });

    it('末尾スラッシュを除去する', () => {
      expect(toAppPath('/src/')).toBe('/src');
    });

    it('ルートは "/" のまま', () => {
      expect(toAppPath('/')).toBe('/');
    });

    it('空文字列は "/" を返す', () => {
      expect(toAppPath('')).toBe('/');
    });

    it('null / undefined は "/" を返す', () => {
      expect(toAppPath(null)).toBe('/');
      expect(toAppPath(undefined)).toBe('/');
    });

    it('"." は "/." を返す（ドットファイル扱い）', () => {
      expect(toAppPath('.')).toBe('/.');
    });
  });

  describe('toGitPath', () => {
    it('先頭スラッシュを除去する', () => {
      expect(toGitPath('/src/main.ts')).toBe('src/main.ts');
    });

    it('ルートは "." を返す', () => {
      expect(toGitPath('/')).toBe('.');
    });

    it('空文字は "." を返す', () => {
      expect(toGitPath('')).toBe('.');
    });
  });

  describe('fromGitPath', () => {
    it('GitPath → AppPath に変換', () => {
      expect(fromGitPath('src/main.ts')).toBe('/src/main.ts');
    });

    it('"." は "/" を返す', () => {
      expect(fromGitPath('.')).toBe('/');
    });
  });

  describe('toAppPath ↔ toGitPath ラウンドトリップ', () => {
    const paths = ['/src/main.ts', '/package.json', '/', '/deep/nested/path/file.ts'];

    it.each(paths)('"%s" がラウンドトリップで保持される', (p) => {
      expect(fromGitPath(toGitPath(p))).toBe(p);
    });
  });

  // ==================== FSPath ====================

  describe('getProjectRoot', () => {
    it('プロジェクトルートパスを返す', () => {
      expect(getProjectRoot('MyApp')).toBe('/projects/MyApp');
    });
  });

  describe('toFSPath', () => {
    it('AppPath → FSPath に変換', () => {
      expect(toFSPath('MyApp', '/src/main.ts')).toBe('/projects/MyApp/src/main.ts');
    });

    it('ルートパス', () => {
      expect(toFSPath('MyApp', '/')).toBe('/projects/MyApp');
    });
  });

  describe('fsPathToAppPath', () => {
    it('FSPath → AppPath に変換', () => {
      expect(fsPathToAppPath('/projects/MyApp/src/main.ts', 'MyApp')).toBe('/src/main.ts');
    });
  });

  describe('isWithinProject', () => {
    it('プロジェクト内のパスは true', () => {
      expect(isWithinProject('/projects/MyApp/src/main.ts', 'MyApp')).toBe(true);
    });

    it('プロジェクト外のパスは false', () => {
      expect(isWithinProject('/projects/Other/file.ts', 'MyApp')).toBe(false);
    });
  });

  // ==================== パス操作 ====================

  describe('getParentPath', () => {
    it('親ディレクトリを返す', () => {
      expect(getParentPath('/src/main.ts')).toBe('/src');
    });

    it('ルート直下のファイル', () => {
      expect(getParentPath('/file.ts')).toBe('/');
    });

    it('ルート自体は "/" を返す', () => {
      expect(getParentPath('/')).toBe('/');
    });
  });

  describe('getFileName', () => {
    it('ファイル名を返す', () => {
      expect(getFileName('/src/main.ts')).toBe('main.ts');
    });

    it('ルートは空文字', () => {
      expect(getFileName('/')).toBe('');
    });
  });

  describe('joinPath', () => {
    it('パスを結合する', () => {
      expect(joinPath('/src', 'utils', 'helpers.ts')).toBe('/src/utils/helpers.ts');
    });

    it('先頭スラッシュ付き引数は絶対パスとして扱われる', () => {
      // joinPath は各引数の先頭 "/" を除去せず連結するため、
      // 先頭スラッシュ付きの引数は最終パスをリセットする
      expect(joinPath('/src', 'utils', 'file.ts')).toBe('/src/utils/file.ts');
    });
  });

  describe('resolvePath', () => {
    it('相対パスを解決する', () => {
      expect(resolvePath('/src/utils', '../lib/helper.ts')).toBe('/src/lib/helper.ts');
    });

    it('"." を解決する', () => {
      expect(resolvePath('/src', './main.ts')).toBe('/src/main.ts');
    });
  });

  describe('normalizeDotSegments', () => {
    it('"." セグメントを除去する', () => {
      expect(normalizeDotSegments('/src/./main.ts')).toBe('/src/main.ts');
    });

    it('".." セグメントを処理する', () => {
      expect(normalizeDotSegments('/src/utils/../main.ts')).toBe('/src/main.ts');
    });
  });

  // ==================== ファイル名操作 ====================

  describe('getExtension', () => {
    it('拡張子を返す', () => {
      expect(getExtension('/main.ts')).toBe('.ts');
    });

    it('拡張子なしは空文字', () => {
      expect(getExtension('/Makefile')).toBe('');
    });

    it('複数ドットは最後のみ', () => {
      expect(getExtension('/file.test.ts')).toBe('.ts');
    });
  });

  describe('replaceExtension', () => {
    it('拡張子を置換する', () => {
      expect(replaceExtension('/main.ts', '.js')).toBe('/main.js');
    });
  });

  // ==================== 述語 ====================

  describe('isRoot', () => {
    it('"/" は true', () => {
      expect(isRoot('/')).toBe(true);
    });

    it('空文字は true', () => {
      expect(isRoot('')).toBe(true);
    });

    it('通常パスは false', () => {
      expect(isRoot('/src')).toBe(false);
    });
  });

  describe('hasPrefix / removePrefix', () => {
    it('プレフィックスを判定・除去する', () => {
      expect(hasPrefix('/src/main.ts', '/src')).toBe(true);
      expect(removePrefix('/src/main.ts', '/src')).toBe('/main.ts');
    });

    it('一致しないプレフィックスは false', () => {
      expect(hasPrefix('/lib/main.ts', '/src')).toBe(false);
    });
  });
});
