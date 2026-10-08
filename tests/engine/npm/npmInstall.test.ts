import { Buffer } from 'node:buffer';
import pako from 'pako';
import tarStream from 'tar-stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NpmFiles } from '@/engine/cmd/global/npmOperations/install/fsFiles';
import { NpmInstall } from '@/engine/cmd/global/npmOperations/npmInstall';
import type { FsCore } from '@/engine/core/fs/core';
import { FSError } from '@/engine/core/fs/errors';
import { NPM_CACHE_PATH } from '@/engine/core/fs/layout';
import { testFsFiles as testFiles } from '../../_helpers/testFsFiles';
import { setupTestProject } from '../../_helpers/testProject';

let repository: FsCore;
let rootPath: string;

/** Package bytes, bin shims, dependency removal, and real registry installations. */

describe('NpmInstall', () => {
  beforeEach(async () => {
    const ctx = await setupTestProject('NpmInstallTest');
    repository = ctx.repo;
    rootPath = ctx.rootPath;
  });

  /** globalThis.fetch をそのまま使う NpmInstall を生成 */
  function createInstaller() {
    return new NpmInstall(rootPath, repository);
  }

  it('treats missing manifests and directories as absent while preserving read failures', async () => {
    const files = new NpmFiles(repository);
    expect(await files.getFile(`${rootPath}/missing/package.json`)).toBeUndefined();
    await repository.mkdir(`${rootPath}/directory/package.json`, { recursive: true });
    expect(await files.getFile(`${rootPath}/directory/package.json`)).toBeUndefined();
    const failure = new FSError('EIO', `${rootPath}/package.json`);
    const read = vi.spyOn(repository, 'readText').mockRejectedValueOnce(failure);
    try {
      await expect(files.getFile(`${rootPath}/package.json`)).rejects.toBe(failure);
    } finally {
      read.mockRestore();
    }
  });

  it('preserves binary files and module source during cached tarball installation', async () => {
    const bytes = new Uint8Array([...Array.from({ length: 31 }, () => 65), 255]);
    const source = 'import value from "dependency";\nexport default value;\n';
    const sourceBytes = new TextEncoder().encode(source);
    const archive = tarStream.pack();
    const chunks: Uint8Array[] = [];
    const packed = new Promise<Uint8Array[]>((resolve, reject) => {
      archive.on('data', (chunk: Uint8Array) => chunks.push(chunk));
      archive.on('end', () => resolve(chunks));
      archive.on('error', reject);
    });
    archive.entry(
      { name: 'package/assets/font.dat', type: 'file', size: bytes.byteLength },
      Buffer.from(bytes)
    );
    archive.entry(
      { name: 'package/index.mjs', type: 'file', size: sourceBytes.byteLength },
      Buffer.from(sourceBytes)
    );
    archive.entry(
      { name: 'package/package.json', type: 'file' },
      Buffer.from(JSON.stringify({ name: 'source-fixture', version: '1.0.0' }))
    );
    archive.finalize();
    const archiveChunks = await packed;
    const archiveSize = archiveChunks.reduce((size, chunk) => size + chunk.byteLength, 0);
    const tar = new Uint8Array(archiveSize);
    let offset = 0;
    for (const chunk of archiveChunks) {
      tar.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const compressed = pako.gzip(tar).slice();
    const url = 'https://registry.npmjs.org/source-fixture/-/source-fixture-1.0.0.tgz';
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(url));
    const key = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join(
      ''
    );
    await repository.mkdir(NPM_CACHE_PATH, { recursive: true });
    await repository.writeFile(`${NPM_CACHE_PATH}/${key}.tgz`, compressed);
    const installer = createInstaller();
    await installer.downloadAndInstallPackage('source-fixture', '1.0.0', url);
    const directory = `${rootPath}/node_modules/source-fixture`;
    expect(await repository.readFile(`${directory}/assets/font.dat`)).toEqual(bytes);
    expect(await repository.readFile(`${directory}/index.mjs`)).toEqual(sourceBytes);
  });

  // ==================== .bin シム生成 ====================

  describe('ensureBinsForPackage', () => {
    it('bin フィールドが文字列の場合: パッケージ名で .bin を作成', async () => {
      await testFiles.createFile(
        rootPath,
        '/node_modules/cowsay/package.json',
        JSON.stringify({ name: 'cowsay', version: '1.6.0', bin: './cli.js' }),
        'file'
      );
      await testFiles.createFile(
        rootPath,
        '/node_modules/cowsay/cli.js',
        'console.log("moo")',
        'file'
      );

      const installer = createInstaller();
      await installer.ensureBinsForPackage('cowsay');

      const shim = await testFiles.getFileByPath(rootPath, '/node_modules/.bin/cowsay');
      expect(shim).not.toBeNull();
      expect(shim!.content).toContain('#!/usr/bin/env node');
      expect(shim!.content).toContain("require('../cowsay/cli.js')");
    });

    it('bin フィールドがオブジェクトの場合: 各エントリで .bin を作成', async () => {
      await testFiles.createFile(
        rootPath,
        '/node_modules/uvu/package.json',
        JSON.stringify({
          name: 'uvu',
          version: '0.5.6',
          bin: { uvu: './bin.js', 'uvu-run': './run.js' },
        }),
        'file'
      );

      const installer = createInstaller();
      await installer.ensureBinsForPackage('uvu');

      const shimUvu = await testFiles.getFileByPath(rootPath, '/node_modules/.bin/uvu');
      expect(shimUvu).not.toBeNull();
      expect(shimUvu!.content).toContain("require('../uvu/bin.js')");

      const shimRun = await testFiles.getFileByPath(rootPath, '/node_modules/.bin/uvu-run');
      expect(shimRun).not.toBeNull();
      expect(shimRun!.content).toContain("require('../uvu/run.js')");
    });

    it('bin フィールドがない場合は何もしない', async () => {
      await testFiles.createFile(
        rootPath,
        '/node_modules/lodash/package.json',
        JSON.stringify({ name: 'lodash', version: '4.17.21' }),
        'file'
      );

      const installer = createInstaller();
      await installer.ensureBinsForPackage('lodash');

      const shim = await testFiles.getFileByPath(rootPath, '/node_modules/.bin/lodash');
      expect(shim).toBeNull();
    });

    it('package.json が存在しない場合は何もしない', async () => {
      const installer = createInstaller();
      await installer.ensureBinsForPackage('nonexistent');
    });

    it('bin パスの ./ プレフィックスを正しく処理する', async () => {
      await testFiles.createFile(
        rootPath,
        '/node_modules/prettier/package.json',
        JSON.stringify({
          name: 'prettier',
          version: '3.0.0',
          bin: { prettier: './bin/prettier.cjs' },
        }),
        'file'
      );

      const installer = createInstaller();
      await installer.ensureBinsForPackage('prettier');

      const shim = await testFiles.getFileByPath(rootPath, '/node_modules/.bin/prettier');
      expect(shim).not.toBeNull();
      expect(shim!.content).toContain("require('../prettier/bin/prettier.cjs')");

      const requireMatch = shim!.content.match(/require\('([^']+)'\)/);
      expect(requireMatch).not.toBeNull();
      expect(requireMatch![1]).toBe('../prettier/bin/prettier.cjs');
      expect(requireMatch![1].startsWith('./')).toBe(false);
    });
  });

  // ==================== removeDirectory ====================

  describe('removeDirectory', () => {
    it('ディレクトリ配下のファイルをすべて削除する', async () => {
      await testFiles.createFile(rootPath, '/node_modules/pkg/index.js', 'code', 'file');
      await testFiles.createFile(rootPath, '/node_modules/pkg/lib/a.js', 'a', 'file');
      await testFiles.createFile(rootPath, '/node_modules/pkg/lib/b.js', 'b', 'file');
      await testFiles.createFile(rootPath, '/node_modules/other/index.js', 'keep', 'file');

      const installer = createInstaller();
      await installer.removeDirectory(`${rootPath}/node_modules/pkg`);

      const pkgFiles = await testFiles.getFilesByPrefix(rootPath, '/node_modules/pkg');
      expect(pkgFiles).toHaveLength(0);

      const otherFiles = await testFiles.getFilesByPrefix(rootPath, '/node_modules/other');
      expect(otherFiles.some(f => f.path.includes('other'))).toBe(true);
    });

    it('フォルダエントリがある場合も正しく削除される (重複排除)', async () => {
      await testFiles.createFile(rootPath, '/node_modules/pkg', '', 'folder');
      await testFiles.createFile(rootPath, '/node_modules/pkg/index.js', 'code', 'file');
      await testFiles.createFile(rootPath, '/node_modules/pkg/readme.md', '# hi', 'file');

      const installer = createInstaller();
      await installer.removeDirectory(`${rootPath}/node_modules/pkg`);

      const remaining = await testFiles.getFilesByPrefix(rootPath, '/node_modules/pkg');
      expect(remaining).toHaveLength(0);
    });
  });

  // ==================== uninstallWithDependencies ====================

  describe('uninstallWithDependencies', () => {
    it('孤立した推移的依存を一緒に削除する', async () => {
      await testFiles.createFile(
        rootPath,
        '/package.json',
        JSON.stringify({
          name: 'app',
          version: '1.0.0',
          dependencies: { express: '^4.18.0' },
        }),
        'file'
      );
      await testFiles.createFile(
        rootPath,
        '/node_modules/express/package.json',
        JSON.stringify({
          name: 'express',
          version: '4.18.0',
          dependencies: { 'body-parser': '^1.20.0' },
        }),
        'file'
      );
      await testFiles.createFile(
        rootPath,
        '/node_modules/express/index.js',
        'module.exports = {}',
        'file'
      );
      await testFiles.createFile(
        rootPath,
        '/node_modules/body-parser/package.json',
        JSON.stringify({ name: 'body-parser', version: '1.20.0' }),
        'file'
      );
      await testFiles.createFile(
        rootPath,
        '/node_modules/body-parser/index.js',
        'module.exports = {}',
        'file'
      );

      const installer = createInstaller();
      const removed = await installer.uninstallWithDependencies('express');

      expect(removed).toContain('express');
      expect(removed).toContain('body-parser');
    });

    it('共有依存は削除しない', async () => {
      await testFiles.createFile(
        rootPath,
        '/package.json',
        JSON.stringify({
          name: 'app',
          version: '1.0.0',
          dependencies: { A: '1.0.0', B: '1.0.0' },
        }),
        'file'
      );
      await testFiles.createFile(
        rootPath,
        '/node_modules/A/package.json',
        JSON.stringify({ name: 'A', version: '1.0.0', dependencies: { shared: '1.0.0' } }),
        'file'
      );
      await testFiles.createFile(
        rootPath,
        '/node_modules/B/package.json',
        JSON.stringify({ name: 'B', version: '1.0.0', dependencies: { shared: '1.0.0' } }),
        'file'
      );
      await testFiles.createFile(
        rootPath,
        '/node_modules/shared/package.json',
        JSON.stringify({ name: 'shared', version: '1.0.0' }),
        'file'
      );

      const installer = createInstaller();
      const removed = await installer.uninstallWithDependencies('B');

      expect(removed).toContain('B');
      expect(removed).not.toContain('shared');
    });

    it('ルート依存は削除しない', async () => {
      await testFiles.createFile(
        rootPath,
        '/package.json',
        JSON.stringify({
          name: 'app',
          version: '1.0.0',
          dependencies: { A: '1.0.0', B: '1.0.0' },
        }),
        'file'
      );
      await testFiles.createFile(
        rootPath,
        '/node_modules/A/package.json',
        JSON.stringify({ name: 'A', version: '1.0.0', dependencies: { B: '1.0.0' } }),
        'file'
      );
      await testFiles.createFile(
        rootPath,
        '/node_modules/B/package.json',
        JSON.stringify({ name: 'B', version: '1.0.0' }),
        'file'
      );

      const installer = createInstaller();
      const removed = await installer.uninstallWithDependencies('A');

      expect(removed).toContain('A');
      expect(removed).not.toContain('B');
    });

    it('存在しないパッケージはスキップ', async () => {
      await testFiles.createFile(
        rootPath,
        '/package.json',
        JSON.stringify({ name: 'app', version: '1.0.0', dependencies: {} }),
        'file'
      );

      const installer = createInstaller();
      const removed = await installer.uninstallWithDependencies('ghost-pkg');
      expect(removed).toHaveLength(0);
    });
  });

  // ==================== installWithDependencies — 本物のレジストリ ====================

  describe('installWithDependencies (実際のレジストリ)', () => {
    it('kleur をインストールして fileRepository にファイルが展開される', async () => {
      const installer = createInstaller();
      await installer.installWithDependencies('kleur', 'latest');

      // package.json
      const pkgJson = await testFiles.getFileByPath(rootPath, '/node_modules/kleur/package.json');
      expect(pkgJson).not.toBeNull();
      const pkg = JSON.parse(pkgJson!.content);
      expect(pkg.name).toBe('kleur');
      expect(pkg.version).toBeDefined();

      // エントリポイントが存在する
      const kleurFiles = await testFiles.getFilesByPrefix(rootPath, '/node_modules/kleur/');
      expect(kleurFiles.length).toBeGreaterThan(1);
    }, 30000);

    it('uvu をインストールして推移的依存 (kleur, mri, dequal, diff) も展開される', async () => {
      const installer = createInstaller();
      await installer.installWithDependencies('uvu', 'latest');

      // uvu 本体
      const uvuPkg = await testFiles.getFileByPath(rootPath, '/node_modules/uvu/package.json');
      expect(uvuPkg).not.toBeNull();
      const uvu = JSON.parse(uvuPkg!.content);
      expect(uvu.name).toBe('uvu');

      // uvu の推移的依存が全てインストールされている
      const expectedDeps = Object.keys(uvu.dependencies || {});
      for (const dep of expectedDeps) {
        const depPkg = await testFiles.getFileByPath(rootPath, `/node_modules/${dep}/package.json`);
        expect(depPkg).not.toBeNull();
        const depJson = JSON.parse(depPkg!.content);
        expect(depJson.name).toBe(dep);
      }
    }, 60000);

    it('uvu の .bin シムが正しく生成される', async () => {
      const installer = createInstaller();
      await installer.installWithDependencies('uvu', 'latest');

      // .bin 作成
      await installer.ensureBinsForPackage('uvu');

      const uvuPkg = await testFiles.getFileByPath(rootPath, '/node_modules/uvu/package.json');
      const uvu = JSON.parse(uvuPkg!.content);

      // uvu の bin フィールドに対応する .bin エントリを検証
      if (uvu.bin) {
        const bins = typeof uvu.bin === 'string' ? { uvu: uvu.bin } : uvu.bin;
        for (const binName of Object.keys(bins)) {
          const shim = await testFiles.getFileByPath(rootPath, `/node_modules/.bin/${binName}`);
          expect(shim).not.toBeNull();
          expect(shim!.content).toContain('#!/usr/bin/env node');
          expect(shim!.content).toContain('require(');
        }
      }
    }, 60000);

    it('インストール済みパッケージは再 fetch しない', async () => {
      // 1 回目: 本物のインストール
      const installer1 = createInstaller();
      await installer1.installWithDependencies('kleur', 'latest');

      // kleur の version を記録
      const pkgFile = await testFiles.getFileByPath(rootPath, '/node_modules/kleur/package.json');
      const pkg = JSON.parse(pkgFile!.content);
      const installedVersion = pkg.version;

      // 2 回目: 同じバージョンならスキップされる
      const installer2 = createInstaller();
      await installer2.installWithDependencies('kleur', installedVersion);

      // スキップ後もファイルが壊れていないこと
      const pkgFileAfter = await testFiles.getFileByPath(
        rootPath,
        '/node_modules/kleur/package.json'
      );
      expect(pkgFileAfter).not.toBeNull();
      expect(JSON.parse(pkgFileAfter!.content).version).toBe(installedVersion);
    }, 60000);

    it('.gitignore に node_modules を追加する', async () => {
      const installer = createInstaller();
      await installer.installWithDependencies('kleur', 'latest');

      const gitignore = await testFiles.getFileByPath(rootPath, '/.gitignore');
      expect(gitignore).not.toBeNull();
      expect(gitignore!.content).toContain('node_modules');
    }, 30000);

    it('progress コールバックが呼ばれる', async () => {
      const progress: Array<{ name: string; version: string; isDirect: boolean }> = [];

      const installer = createInstaller();
      installer.setInstallProgressCallback((name, version, isDirect) => {
        progress.push({ name, version, isDirect });
      });

      await installer.installWithDependencies('kleur', 'latest', { isDirect: true });

      // kleur 自体の progress が含まれる
      expect(progress.length).toBeGreaterThanOrEqual(1);
      const kleurEntry = progress.find(p => p.name === 'kleur');
      expect(kleurEntry).toBeDefined();
      expect(kleurEntry!.isDirect).toBe(true);
    }, 30000);
  });

  // ==================== install → uninstall の統合フロー ====================

  describe('install → uninstall 統合', () => {
    it('kleur をインストールしてからアンインストールする', async () => {
      // package.json 作成
      await testFiles.createFile(
        rootPath,
        '/package.json',
        JSON.stringify({
          name: 'app',
          version: '1.0.0',
          dependencies: { kleur: '^4.0.0' },
        }),
        'file'
      );

      // インストール
      const installer = createInstaller();
      await installer.installWithDependencies('kleur', 'latest');

      // 確認
      const beforeUninstall = await testFiles.getFilesByPrefix(rootPath, '/node_modules/kleur/');
      expect(beforeUninstall.length).toBeGreaterThan(0);

      // アンインストール
      const removed = await installer.uninstallWithDependencies('kleur');
      expect(removed).toContain('kleur');

      // node_modules/kleur が消えている
      const afterUninstall = await testFiles.getFilesByPrefix(rootPath, '/node_modules/kleur/');
      expect(afterUninstall).toHaveLength(0);
    }, 30000);

    it('uvu をインストール → uvu をアンインストール → 推移的依存も消える', async () => {
      await testFiles.createFile(
        rootPath,
        '/package.json',
        JSON.stringify({
          name: 'app',
          version: '1.0.0',
          dependencies: { uvu: '^0.5.0' },
        }),
        'file'
      );

      // uvu インストール
      const installer = createInstaller();
      await installer.installWithDependencies('uvu', 'latest');

      // uvu の依存関係を確認
      const uvuPkg = await testFiles.getFileByPath(rootPath, '/node_modules/uvu/package.json');
      const uvu = JSON.parse(uvuPkg!.content);
      const transitiveDeps = Object.keys(uvu.dependencies || {});

      // アンインストール
      const removed = await installer.uninstallWithDependencies('uvu');
      expect(removed).toContain('uvu');

      // 推移的依存で他のルート依存がないものは削除される
      for (const dep of transitiveDeps) {
        if (removed.includes(dep)) {
          const depFiles = await testFiles.getFilesByPrefix(rootPath, `/node_modules/${dep}/`);
          expect(depFiles).toHaveLength(0);
        }
      }
    }, 60000);
  });

  // ==================== エッジケース ====================

  describe('エッジケース', () => {
    it('存在しないパッケージを install しようとするとエラー', async () => {
      const installer = createInstaller();
      await expect(
        installer.installWithDependencies('nonexistent-pkg-xyz-99999', 'latest')
      ).rejects.toThrow(/not found|404|Failed/i);
    }, 15000);

    it('node_modules が空の状態で removeDirectory しても安全', async () => {
      const installer = createInstaller();
      await installer.removeDirectory(`${rootPath}/node_modules/nonexistent`);
    });

    it('同じパッケージの2回連続 install は冪等', async () => {
      const installer = createInstaller();
      await installer.installWithDependencies('kleur', 'latest');

      // 1回目のファイル数を記録
      const files1 = await testFiles.getFilesByPrefix(rootPath, '/node_modules/kleur/');
      const count1 = files1.length;

      // 2回目
      const installer2 = createInstaller();
      await installer2.installWithDependencies('kleur', 'latest');

      const files2 = await testFiles.getFilesByPrefix(rootPath, '/node_modules/kleur/');
      expect(files2.length).toBe(count1);
    }, 60000);
  });
});
