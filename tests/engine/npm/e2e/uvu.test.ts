import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setupTestProject } from '../../../helpers/testProject';
import { fileRepository } from '@/engine/core/fileRepository';
import { NpmInstall } from '@/engine/cmd/global/npmOperations/npmInstall';

// normalizeCjsEsm は Pure function なので直接使える。
// transpileManager は Web Worker を使うため Node 環境では動かない → モック。
import { normalizeCjsEsm } from '@/engine/runtime/transpiler/normalizeCjsEsm';

vi.mock('@/engine/runtime/transpiler/transpileManager', () => ({
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



import { NodeRuntime } from '@/engine/runtime/nodejs/nodeRuntime';
import { ModuleResolver } from '@/engine/runtime/module/moduleResolver';

/**
 * uvu e2e テスト
 *
 * uvu を実際にインストールし、npx uvu 相当の実行を NodeRuntime で行う。
 * require('./package') の解決を含め、ランタイム実行パスの正当性を検証。
 */

describe('e2e — npx uvu 実行テスト', () => {
  let projectId: string;
  let projectName: string;

  beforeEach(async () => {
    const ctx = await setupTestProject('UvuE2ETest');
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
            const msg = args.map(String).join(' ');
            output.push(msg);
            console.log(...args);
          },
          error: (...args: unknown[]) => {
            const msg = args.map(String).join(' ');
            errors.push(msg);
            console.error(...args);
          },
          warn: (...args: unknown[]) => {
            const msg = args.map(String).join(' ');
            output.push(msg);
            console.warn(...args);
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

        // 収集したログを全て出力
        console.log('\n========== Console Output ==========');
        console.log(output.join('\n'));
        console.log('\n========== Error Output ==========');
        console.log(errors.join('\n'));
        console.log('\n========================================\n');

        const allOutput = [...output, ...errors].join('\n');

        // より厳密なエラーチェック
        expect(allOutput).not.toContain('ERR_MODULE_NOT_FOUND');
        expect(allOutput).not.toContain("Cannot find module './package'");
        expect(allOutput).not.toContain('Cannot find module');
        expect(allOutput).not.toContain('Module execution failed');
        expect(allOutput).not.toContain('no-fatal');
        expect(allOutput).not.toContain('fatal error');
        expect(allOutput).not.toMatch(/ERROR:/i);
        expect(allOutput).not.toMatch(/\[ERROR\]/i);

        if (executionError) {
          console.log('\n========== Execution Error ==========');
          console.log('Error:', executionError);
          console.log('Stack:', executionError.stack);
          console.log('=====================================\n');

          // 実行エラーは許容しない
          throw new Error(
            `Execution failed with error: ${executionError.message}\nStack: ${executionError.stack}`
          );
        }

        // errors配列に内容がある場合はエラーとみなす
        if (errors.length > 0) {
          throw new Error(
            `Errors detected during execution:\n${errors.join('\n')}`
          );
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
