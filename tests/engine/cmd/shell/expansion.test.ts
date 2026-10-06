import { describe, expect, it } from 'vitest';
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

    it('混在 IFS の空白と区切り文字を両方扱う', () => {
      expect(splitOnIFS('alpha : beta::gamma: ', ' :')).toEqual(['alpha', 'beta', '', 'gamma']);
    });

    it('空の IFS は分割しない', () => {
      expect(splitOnIFS('alpha beta', '')).toEqual(['alpha beta']);
    });

    it('非空白区切り文字の先頭空フィールドを保つ', () => {
      expect(splitOnIFS(':alpha', ':')).toEqual(['', 'alpha']);
    });

    it('末尾の非空白区切り文字では空フィールドを追加しない', () => {
      expect(splitOnIFS('alpha:', ':')).toEqual(['alpha']);
    });

    it('IFS のバックスラッシュ表記をエスケープしない', () => {
      expect(splitOnIFS('alpha\\tbeta', '\\t')).toEqual(['alpha', '', 'be', 'a']);
    });
  });
});

import { expandTokens } from '@/engine/cmd/shell/expansion';
import { setupTestProject } from '../../../_helpers/testProject';

describe('path expansion', () => {
  it('expands wildcard components across a path and respects dotfiles', async () => {
    const { repo, rootPath } = await setupTestProject('ShellGlobTest');
    await repo.mkdir(`${rootPath}/src/nested`, { recursive: true });
    await repo.writeFile(`${rootPath}/src/nested/a1.ts`, 'one');
    await repo.writeFile(`${rootPath}/src/nested/a2.ts`, 'two');
    await repo.writeFile(`${rootPath}/src/nested/.hidden.ts`, 'hidden');
    const options = { rootPath, cwd: rootPath, fsClient: repo, env: {} };

    await expect(expandTokens([{ text: 'src/*/a?.ts', quote: null }], options)).resolves.toEqual([
      'src/nested/a1.ts',
      'src/nested/a2.ts',
    ]);
    await expect(
      expandTokens([{ text: 'src/*/.hidden.ts', quote: null }], options)
    ).resolves.toEqual(['src/nested/.hidden.ts']);
  });

  it('expands tilde from shell HOME without splitting its path', async () => {
    const { repo, rootPath } = await setupTestProject('Shell Home Folder');
    await repo.writeFile(`${rootPath}/entry.ts`, 'entry');

    await expect(
      expandTokens([{ text: '~/entry.ts', quote: null }], {
        rootPath,
        cwd: '/',
        fsClient: repo,
        env: { HOME: rootPath },
      })
    ).resolves.toEqual([`${rootPath}/entry.ts`]);
    await expect(
      expandTokens([{ text: '~/entry.ts', quote: 'single' }], {
        rootPath,
        cwd: '/',
        fsClient: repo,
        env: { HOME: rootPath },
      })
    ).resolves.toEqual(['~/entry.ts']);
  });
});
