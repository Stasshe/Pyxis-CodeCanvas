import { describe, expect, it } from 'vitest';
import { hasGlob } from '@/engine/system/shell/expansion';

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
});

import { expandShellWords } from '@/engine/system/shell/wordExpansion';
import { setupTestProject } from '../../../_helpers/testProject';

describe('path expansion', () => {
  const shell = {
    async runInSubshell() {
      return { stdout: '', stderr: '', code: 0 };
    },
  };
  it('expands wildcard components across a path and respects dotfiles', async () => {
    const { repo, rootPath } = await setupTestProject('ShellGlobTest');
    await repo.mkdir(`${rootPath}/src/nested`, { recursive: true });
    await repo.writeFile(`${rootPath}/src/nested/a1.ts`, 'one');
    await repo.writeFile(`${rootPath}/src/nested/a2.ts`, 'two');
    await repo.writeFile(`${rootPath}/src/nested/.hidden.ts`, 'hidden');
    const options = { rootPath, cwd: rootPath, fsClient: repo, env: {}, nounset: false };

    await expect(expandShellWords('src/*/a?.ts', options, shell)).resolves.toEqual([
      'src/nested/a1.ts',
      'src/nested/a2.ts',
    ]);
    await expect(expandShellWords('src/*/.hidden.ts', options, shell)).resolves.toEqual([
      'src/nested/.hidden.ts',
    ]);
  });

  it('preserves repeated separators in glob results', async () => {
    const { repo, rootPath } = await setupTestProject('ShellGlobRepeatedSeparators');
    await repo.mkdir(`${rootPath}/glob-separator-fixture`, { recursive: true });
    await repo.writeFile(`${rootPath}/glob-separator-fixture/file.ts`, 'file');
    const options = { rootPath, cwd: rootPath, fsClient: repo, env: {}, nounset: false };

    await expect(expandShellWords('glob-separator-fixture//f*', options, shell)).resolves.toEqual([
      'glob-separator-fixture//file.ts',
    ]);
  });

  it('preserves leading slash runs in absolute glob results', async () => {
    const { repo, rootPath } = await setupTestProject('ShellGlobAbsolutePath');
    await repo.writeFile(`${rootPath}/glob-absolute-file`, 'file');
    const options = { rootPath, cwd: '/', fsClient: repo, env: {}, nounset: false };

    const pathWithoutLeadingSlash = rootPath.slice(1);
    for (const leadingSlashes of ['/', '//', '///']) {
      const pattern = `${leadingSlashes}${pathWithoutLeadingSlash}/glob-absolute-*`;
      const expected = `${leadingSlashes}${pathWithoutLeadingSlash}/glob-absolute-file`;
      await expect(expandShellWords(pattern, options, shell)).resolves.toEqual([expected]);
    }
  });

  it('sorts glob results by UTF-8 byte order', async () => {
    const { repo, rootPath } = await setupTestProject('ShellGlobUtf8Order');
    await repo.writeFile(`${rootPath}/glob-order-😀`, 'emoji');
    await repo.writeFile(`${rootPath}/glob-order-Ａ`, 'fullwidth');
    const options = { rootPath, cwd: rootPath, fsClient: repo, env: {}, nounset: false };

    await expect(expandShellWords('glob-order-*', options, shell)).resolves.toEqual([
      'glob-order-Ａ',
      'glob-order-😀',
    ]);
  });

  it('does not expand a quoted POSIX class inside a mixed quoted glob', async () => {
    const { repo, rootPath } = await setupTestProject('ShellGlobQuotedClass');
    await repo.writeFile(`${rootPath}/[[:alpha:]]-file`, 'literal');
    await repo.writeFile(`${rootPath}/a-file`, 'other');
    const options = { rootPath, cwd: rootPath, fsClient: repo, env: {}, nounset: false };

    await expect(expandShellWords('"[[:alpha:]]"*', options, shell)).resolves.toEqual([
      '[[:alpha:]]-file',
    ]);
  });

  it('keeps trailing slashes and matches directories only', async () => {
    const { repo, rootPath } = await setupTestProject('ShellGlobDirectories');
    await repo.mkdir(`${rootPath}/glob-directory-fixture/nested`, { recursive: true });
    await repo.writeFile(`${rootPath}/glob-directory-fixture/file.ts`, 'file');
    const options = { rootPath, cwd: rootPath, fsClient: repo, env: {}, nounset: false };

    await expect(expandShellWords('glob-directory-fixture/*/', options, shell)).resolves.toEqual([
      'glob-directory-fixture/nested/',
    ]);
  });

  it('skips dangling symlinks and keeps symlinks to directories for trailing slashes', async () => {
    const { repo, rootPath } = await setupTestProject('ShellGlobSymlinks');
    const fixturePath = `${rootPath}/glob-symlink-fixture`;
    await repo.mkdir(`${fixturePath}/nested`, { recursive: true });
    await repo.symlink('missing', `${fixturePath}/dangling`);
    await repo.symlink('nested', `${fixturePath}/directory-link`);
    const options = { rootPath, cwd: rootPath, fsClient: repo, env: {}, nounset: false };

    await expect(expandShellWords('glob-symlink-fixture/*/', options, shell)).resolves.toEqual([
      'glob-symlink-fixture/directory-link/',
      'glob-symlink-fixture/nested/',
    ]);
  });

  it('expands the POSIX alpha character class', async () => {
    const { repo, rootPath } = await setupTestProject('ShellGlobAlpha');
    await repo.writeFile(`${rootPath}/src/a.ts`, 'lowercase');
    await repo.writeFile(`${rootPath}/src/Z.ts`, 'uppercase');
    await repo.writeFile(`${rootPath}/src/1.ts`, 'number');
    const options = { rootPath, cwd: rootPath, fsClient: repo, env: {}, nounset: false };

    await expect(expandShellWords('src/[[:alpha:]].ts', options, shell)).resolves.toEqual([
      'src/Z.ts',
      'src/a.ts',
    ]);
  });

  it('matches Unicode letters but not digits in the POSIX alpha class', async () => {
    const { repo, rootPath } = await setupTestProject('ShellGlobUnicodeAlpha');
    const fixturePath = `${rootPath}/glob-alpha-fixture`;
    await repo.mkdir(fixturePath, { recursive: true });
    await repo.writeFile(`${fixturePath}/é-file`, 'accented');
    await repo.writeFile(`${fixturePath}/Ａ-file`, 'fullwidth');
    await repo.writeFile(`${fixturePath}/1-file`, 'digit');
    const options = { rootPath, cwd: rootPath, fsClient: repo, env: {}, nounset: false };

    await expect(
      expandShellWords('glob-alpha-fixture/[[:alpha:]]*-file', options, shell)
    ).resolves.toEqual(['glob-alpha-fixture/é-file', 'glob-alpha-fixture/Ａ-file']);
  });

  it('expands tilde from shell HOME without splitting its path', async () => {
    const { repo, rootPath } = await setupTestProject('Shell Home Folder');
    await repo.writeFile(`${rootPath}/entry.ts`, 'entry');

    await expect(
      expandShellWords(
        '~/entry.ts',
        {
          rootPath,
          cwd: '/',
          fsClient: repo,
          env: { HOME: rootPath },
          nounset: false,
        },
        shell
      )
    ).resolves.toEqual([`${rootPath}/entry.ts`]);
    await expect(
      expandShellWords(
        "'~/entry.ts'",
        {
          rootPath,
          cwd: '/',
          fsClient: repo,
          env: { HOME: rootPath },
          nounset: false,
        },
        shell
      )
    ).resolves.toEqual(['~/entry.ts']);
  });
});
