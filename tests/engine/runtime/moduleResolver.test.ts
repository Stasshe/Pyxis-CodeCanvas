import { describe, it, expect, beforeEach } from 'vitest';
import { setupTestProject } from '../../helpers/testProject';
import { fileRepository } from '@/engine/core/fileRepository';
import { ModuleResolver } from '@/engine/runtime/module/moduleResolver';

/**
 * ModuleResolver のテスト
 * fileRepository を使って node_modules のモジュール解決をテスト
 *
 * gitFileSystem / syncManager のモックは setup.ts でグローバル定義済み
 * fileRepository のモックは不要（Node 環境では自動的に InMemory に切り替わる）
 */

describe('ModuleResolver', () => {
  let projectId: string;
  let projectName: string;
  let repo: typeof fileRepository;

  beforeEach(async () => {
    const ctx = await setupTestProject();
    repo = ctx.repo;
    projectId = ctx.projectId;
    projectName = ctx.projectName;
  });

  describe('パッケージ解決の基盤テスト', () => {
    it('node_modules 内の package.json を読み取れる', async () => {
      await repo.createFile(
        projectId,
        '/node_modules/lodash/package.json',
        JSON.stringify({
          name: 'lodash',
          version: '4.17.21',
          main: 'lodash.js',
        }),
        'file'
      );
      await repo.createFile(
        projectId,
        '/node_modules/lodash/lodash.js',
        'module.exports = { VERSION: "4.17.21" }',
        'file'
      );

      const pkgFile = await repo.getFileByPath(
        projectId,
        '/node_modules/lodash/package.json'
      );
      expect(pkgFile).not.toBeNull();
      expect(pkgFile?.content).toContain('lodash');

      const pkg = JSON.parse(pkgFile!.content);
      expect(pkg.name).toBe('lodash');
      expect(pkg.main).toBe('lodash.js');
    });

    it('スコープ付きパッケージを解決できる', async () => {
      await repo.createFile(
        projectId,
        '/node_modules/@babel/core/package.json',
        JSON.stringify({
          name: '@babel/core',
          version: '7.0.0',
          main: 'lib/index.js',
        }),
        'file'
      );
      await repo.createFile(
        projectId,
        '/node_modules/@babel/core/lib/index.js',
        'module.exports = {}',
        'file'
      );

      const pkgFile = await repo.getFileByPath(
        projectId,
        '/node_modules/@babel/core/package.json'
      );
      expect(pkgFile).not.toBeNull();

      const pkg = JSON.parse(pkgFile!.content);
      expect(pkg.name).toBe('@babel/core');
    });

    it('package.json の module フィールドを読む', async () => {
      await repo.createFile(
        projectId,
        '/node_modules/my-lib/package.json',
        JSON.stringify({
          name: 'my-lib',
          main: 'dist/cjs/index.js',
          module: 'dist/esm/index.js',
        }),
        'file'
      );

      const pkgFile = await repo.getFileByPath(
        projectId,
        '/node_modules/my-lib/package.json'
      );
      const pkg = JSON.parse(pkgFile!.content);

      expect(pkg.module).toBe('dist/esm/index.js');
      expect(pkg.main).toBe('dist/cjs/index.js');
    });

    it('exports フィールドの条件付きエクスポート', async () => {
      await repo.createFile(
        projectId,
        '/node_modules/modern-pkg/package.json',
        JSON.stringify({
          name: 'modern-pkg',
          exports: {
            '.': {
              import: './dist/esm/index.js',
              require: './dist/cjs/index.js',
            },
            './utils': {
              import: './dist/esm/utils.js',
              require: './dist/cjs/utils.js',
            },
          },
        }),
        'file'
      );

      const pkgFile = await repo.getFileByPath(
        projectId,
        '/node_modules/modern-pkg/package.json'
      );
      const pkg = JSON.parse(pkgFile!.content);

      expect(pkg.exports['.']).toBeDefined();
      expect(pkg.exports['.'].import).toBe('./dist/esm/index.js');
      expect(pkg.exports['.'].require).toBe('./dist/cjs/index.js');
      expect(pkg.exports['./utils']).toBeDefined();
    });

    it('getFilesByPrefix で node_modules 配下を列挙できる', async () => {
      await repo.createFile(projectId, '/node_modules/pkg-a/index.js', 'a', 'file');
      await repo.createFile(projectId, '/node_modules/pkg-b/index.js', 'b', 'file');

      const files = await repo.getFilesByPrefix(projectId, '/node_modules');
      const paths = files.map(f => f.path);

      expect(paths.some(p => p.includes('pkg-a'))).toBe(true);
      expect(paths.some(p => p.includes('pkg-b'))).toBe(true);
    });
  });

  describe('初期ファイルとの共存', () => {
    it('initialFileContents が事前ロードされている', async () => {
      const files = await repo.getProjectFiles(projectId);
      const paths = files.map(f => f.path);

      expect(paths).toContain('/.gitignore');
      expect(paths).toContain('/README.md');
      expect(paths).toContain('/src/index.js');
      expect(paths).toContain('/src/math.js');
    });

    it('既存ファイルの内容が読み取れる', async () => {
      const mathFile = await repo.getFileByPath(projectId, '/src/math.js');
      expect(mathFile).not.toBeNull();
      expect(mathFile?.content).toContain('export function add');
    });

    it('node_modules を追加しても初期ファイルに影響しない', async () => {
      const beforeCount = (await repo.getProjectFiles(projectId)).length;

      await repo.createFile(
        projectId,
        '/node_modules/test-pkg/index.js',
        'module.exports = {}',
        'file'
      );

      const afterCount = (await repo.getProjectFiles(projectId)).length;
      expect(afterCount).toBeGreaterThan(beforeCount);

      const mathFile = await repo.getFileByPath(projectId, '/src/math.js');
      expect(mathFile?.content).toContain('export function add');
    });
  });

  describe('ファイル拡張子解決', () => {
    it('拡張子なしで .js を探す', async () => {
      const exact = await repo.getFileByPath(projectId, '/src/index');
      const withExt = await repo.getFileByPath(projectId, '/src/index.js');

      expect(exact).toBeNull();
      expect(withExt).not.toBeNull();
    });

    it('index.js をフォールバックとして探す', async () => {
      await repo.createFile(projectId, '/src/components/index.js', 'export default {}', 'file');

      const indexFile = await repo.getFileByPath(projectId, '/src/components/index.js');
      expect(indexFile).not.toBeNull();
    });
  });

  describe('npm バイナリ解決', () => {
    it('.bin ディレクトリからバイナリを解決できる', async () => {
      await repo.createFile(
        projectId,
        '/node_modules/.bin/cowsay',
        '#!/usr/bin/env node\nrequire("../cowsay/cli.js")',
        'file'
      );
      await repo.createFile(
        projectId,
        '/node_modules/cowsay/cli.js',
        'console.log("moo")',
        'file'
      );
      await repo.createFile(
        projectId,
        '/node_modules/cowsay/package.json',
        JSON.stringify({ name: 'cowsay', version: '1.0.0', bin: { cowsay: 'cli.js' } }),
        'file'
      );

      const binFile = await repo.getFileByPath(projectId, '/node_modules/.bin/cowsay');
      expect(binFile).not.toBeNull();
      expect(binFile?.content).toContain('cowsay/cli.js');

      const cliFile = await repo.getFileByPath(projectId, '/node_modules/cowsay/cli.js');
      expect(cliFile).not.toBeNull();
    });
  });

  describe('依存関係ツリー', () => {
    it('ネストされた依存関係を解決できる', async () => {
      await repo.createFile(
        projectId,
        '/node_modules/uvu/package.json',
        JSON.stringify({ name: 'uvu', version: '0.5.6', main: 'index.js' }),
        'file'
      );
      await repo.createFile(
        projectId,
        '/node_modules/uvu/index.js',
        "const kleur = require('kleur');\nmodule.exports = { test: () => {} };",
        'file'
      );
      await repo.createFile(
        projectId,
        '/node_modules/kleur/package.json',
        JSON.stringify({ name: 'kleur', version: '4.1.5', main: 'index.js' }),
        'file'
      );
      await repo.createFile(
        projectId,
        '/node_modules/kleur/index.js',
        'module.exports = { red: (s) => s };',
        'file'
      );

      const uvuPkg = await repo.getFileByPath(projectId, '/node_modules/uvu/package.json');
      expect(uvuPkg).not.toBeNull();

      const kleurPkg = await repo.getFileByPath(projectId, '/node_modules/kleur/package.json');
      expect(kleurPkg).not.toBeNull();

      const uvuIndex = await repo.getFileByPath(projectId, '/node_modules/uvu/index.js');
      expect(uvuIndex?.content).toContain("require('kleur')");
    });
  });

  // ==================== ModuleResolver.resolve() の直接テスト ====================

  describe('ModuleResolver.resolve() — 相対パスの拡張子解決', () => {
    let resolver: ModuleResolver;

    beforeEach(() => {
      resolver = new ModuleResolver(projectId, projectName);
    });

    it("require('./package') が package.json に解決される", async () => {
      // uvu/bin.js が require('./package') するパターンを再現
      await repo.createFile(
        projectId,
        '/node_modules/uvu/package.json',
        JSON.stringify({ name: 'uvu', version: '0.5.6', main: 'index.js' }),
        'file'
      );
      await repo.createFile(
        projectId,
        '/node_modules/uvu/bin.js',
        "const pkg = require('./package');\nmodule.exports = pkg;",
        'file'
      );

      const currentFile = `/projects/${projectName}/node_modules/uvu/bin.js`;
      const result = await resolver.resolve('./package', currentFile);

      expect(result).not.toBeNull();
      expect(result!.path).toBe(`/projects/${projectName}/node_modules/uvu/package.json`);
    });

    it("require('./lib/utils') が ./lib/utils.js に解決される", async () => {
      await repo.createFile(
        projectId,
        '/node_modules/test-pkg/lib/utils.js',
        'module.exports = {}',
        'file'
      );

      const currentFile = `/projects/${projectName}/node_modules/test-pkg/index.js`;
      const result = await resolver.resolve('./lib/utils', currentFile);

      expect(result).not.toBeNull();
      expect(result!.path).toBe(`/projects/${projectName}/node_modules/test-pkg/lib/utils.js`);
    });

    it("require('./data') が ./data.json に解決される", async () => {
      await repo.createFile(
        projectId,
        '/node_modules/test-pkg/data.json',
        JSON.stringify({ key: 'value' }),
        'file'
      );

      const currentFile = `/projects/${projectName}/node_modules/test-pkg/index.js`;
      const result = await resolver.resolve('./data', currentFile);

      expect(result).not.toBeNull();
      expect(result!.path).toBe(`/projects/${projectName}/node_modules/test-pkg/data.json`);
    });

    it('存在しない相対モジュールは null を返す', async () => {
      const currentFile = `/projects/${projectName}/node_modules/test-pkg/index.js`;
      const result = await resolver.resolve('./nonexistent', currentFile);

      expect(result).toBeNull();
    });
  });
});
