import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setupTestProject } from '../../helpers/testProject';
import { fileRepository } from '@/engine/core/fileRepository';
import { NpmInstall } from '@/engine/cmd/global/npmOperations/npmInstall';

// normalizeCjsEsm は Pure function なので直接使える。
// transpileManager は Web Worker を使うため Node 環境では動かない → モック。
import { normalizeCjsEsm } from '@/engine/runtime/normalizeCjsEsm';

vi.mock('@/engine/runtime/transpileManager', () => ({
  transpileManager: {
    transpile: async (options: { code: string; filePath: string }) => {
      const result = normalizeCjsEsm(options.code);
      return {
        id: 'mock',
        code: result.code,
        dependencies: result.dependencies,
      };
    },
  },
}));

// pushMsgOutPanel は React UI であり Node.js では利用不可
vi.mock('@/components/Bottom/BottomPanel', () => ({
  pushMsgOutPanel: () => {},
}));

import { NodeRuntime } from '@/engine/runtime/nodeRuntime';
import { ModuleResolver } from '@/engine/runtime/moduleResolver';

/**
 * npmRun テスト
 *
 * uvu を実際にインストールし、npx uvu 相当の実行を NodeRuntime で行う。
 * require('./package') の解決を含め、ランタイム実行パスの正当性を検証。
 */

describe('npmRun — npx uvu 実行テスト', () => {
  let projectId: string;
  let projectName: string;

  beforeEach(async () => {
    const ctx = await setupTestProject('NpmRunTest');
    projectId = ctx.projectId;
    projectName = ctx.projectName;
  });

  function createInstaller(skipLoad = true) {
    return new NpmInstall(projectName, projectId, skipLoad);
  }

  // ==================== require('./package') 解決テスト ====================

  describe('require("./package") ランタイム解決', () => {
    it(
      'uvu インストール後、require("./package") が package.json に解決できる',
      async () => {
        // uvu をインストール
        const installer = createInstaller();
        installer.startBatchProcessing();
        await installer.installWithDependencies('uvu', 'latest');
        await installer.finishBatchProcessing();

        // .bin シムを作成
        await installer.ensureBinsForPackage('uvu');

        // uvu/bin.js (実際の uvu のエントリ) が require('./package') できるか確認
        const resolver = new ModuleResolver(projectId, projectName);

        // uvu/package.json の bin フィールドからエントリファイルを特定
        const uvuPkg = await fileRepository.getFileByPath(
          projectId,
          '/node_modules/uvu/package.json'
        );
        expect(uvuPkg).not.toBeNull();
        const pkg = JSON.parse(uvuPkg!.content);
        const binField = typeof pkg.bin === 'string' ? { uvu: pkg.bin } : pkg.bin;
        const binEntry = Object.values(binField)[0] as string;
        const binPath = binEntry.replace(/^\.\//, '');

        // bin エントリファイルから require('./package') が解決されることを検証
        const currentFile = `/projects/${projectName}/node_modules/uvu/${binPath}`;
        const result = await resolver.resolve('./package', currentFile);

        expect(result).not.toBeNull();
        expect(result!.path).toBe(`/projects/${projectName}/node_modules/uvu/package.json`);
      },
      60000
    );
  });

  // ==================== npx uvu 実行テスト ====================

  describe('npx uvu 実行', () => {
    it(
      'uvu の bin シムを NodeRuntime で実行してもモジュール解決エラーが出ない',
      async () => {
        // === 1. uvu をインストール ===
        const installer = createInstaller();
        installer.startBatchProcessing();
        await installer.installWithDependencies('uvu', 'latest');
        await installer.finishBatchProcessing();

        // .bin シムを生成
        await installer.ensureBinsForPackage('uvu');

        // sade の .bin も念のため
        await installer.ensureBinsForPackage('sade');

        // === 2. シムが存在するか確認 ===
        const shim = await fileRepository.getFileByPath(
          projectId,
          '/node_modules/.bin/uvu'
        );
        expect(shim).not.toBeNull();
        expect(shim!.content).toContain('require(');

        // === 3. NodeRuntime で実行 ===
        const output: string[] = [];
        const errors: string[] = [];

        const debugConsole = {
          log: (...args: unknown[]) => {
            console.log(...args);
          },
          error: (...args: unknown[]) => {
            errors.push(args.map(String).join(' '));
          },
          warn: (...args: unknown[]) => {
            output.push(args.map(String).join(' '));
          },
          clear: () => {},
        };

        const shimPath = `/projects/${projectName}/node_modules/.bin/uvu`;

        const runtime = new NodeRuntime({
          projectId,
          projectName,
          filePath: shimPath,
          debugConsole,
          terminalColumns: 80,
          terminalRows: 24,
        });

        // 実行 — ERR_MODULE_NOT_FOUND が throw されないことが主な検証ポイント
        let executionError: Error | null = null;
        try {
          await runtime.execute(shimPath, []);
        } catch (e) {
          executionError = e as Error;
        }

        const allOutput = [...output, ...errors].join('\n');
        expect(allOutput).not.toContain('ERR_MODULE_NOT_FOUND');
        expect(allOutput).not.toContain("Cannot find module './package'");

        if (executionError) {
          // ERR_MODULE_NOT_FOUND は致命的。他のエラーはランタイム環境の制限で許容
          expect(executionError.name).not.toContain('ERR_MODULE_NOT_FOUND');
          expect(executionError.message).not.toContain("Cannot find module './package'");
        }
      },
      120000
    );
  });

  // ==================== preloadDependencies で .json が解決される ====================

  describe('preloadDependencies の .json 解決', () => {
    it(
      'モジュールの依存として ./package が正しく事前ロードされる',
      async () => {
        // 手動で uvu 相当のモジュール構造を作る（高速テスト）
        await fileRepository.createFile(
          projectId,
          '/node_modules/test-pkg/package.json',
          JSON.stringify({ name: 'test-pkg', version: '1.0.0', main: 'index.js' }),
          'file'
        );
        await fileRepository.createFile(
          projectId,
          '/node_modules/test-pkg/index.js',
          "const pkg = require('./package');\nmodule.exports = { name: pkg.name };",
          'file'
        );

        // ModuleResolver で ./package が package.json に解決される
        const resolver = new ModuleResolver(projectId, projectName);
        const result = await resolver.resolve(
          './package',
          `/projects/${projectName}/node_modules/test-pkg/index.js`
        );

        expect(result).not.toBeNull();
        expect(result!.path).toContain('package.json');
      },
      10000
    );
  });
});
