import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setupTestProject } from '../../../_helpers/testProject';
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
 * prettier e2e テスト
 *
 * prettier を実際にインストールし、npx prettier 相当の実行を NodeRuntime で行う。
 * モジュール解決の正当性を検証。
 */

describe('e2e — npx prettier 実行テスト', () => {
  let projectId: string;
  let projectName: string;

  beforeEach(async () => {
    const ctx = await setupTestProject('PrettierE2ETest');
    projectId = ctx.projectId;
    projectName = ctx.projectName;
  });

  function createInstaller(skipLoad = true) {
    return new NpmInstall(projectName, projectId, skipLoad);
  }

  // ==================== prettier インストール & 解決テスト ====================

  describe('prettier パッケージ解決', () => {
    it(
      'prettier インストール後、package.json とモジュールが正しく解決できる',
      async () => {
        // prettier をインストール
        const installer = createInstaller();
        installer.startBatchProcessing();
        await installer.installWithDependencies('prettier', 'latest');
        await installer.finishBatchProcessing();

        // .bin シムを作成
        await installer.ensureBinsForPackage('prettier');

        // prettier/package.json が存在するか確認
        const prettierPkg = await fileRepository.getFileByPath(
          projectId,
          '/node_modules/prettier/package.json'
        );
        expect(prettierPkg).not.toBeNull();
        const pkg = JSON.parse(prettierPkg!.content);
        expect(pkg.name).toBe('prettier');

        // bin フィールドからエントリファイルを特定
        const binField = typeof pkg.bin === 'string' ? { prettier: pkg.bin } : pkg.bin;
        const binEntry = Object.values(binField)[0] as string;
        const binPath = binEntry.replace(/^\.\//, '');

        // bin エントリファイルが存在するか確認
        const binFile = await fileRepository.getFileByPath(
          projectId,
          `/node_modules/prettier/${binPath}`
        );
        expect(binFile).not.toBeNull();

        // ModuleResolver で prettier パッケージが解決されることを検証
        const resolver = new ModuleResolver(projectId, projectName);
        const result = await resolver.resolve(
          'prettier',
          `/projects/${projectName}/index.js`
        );

        expect(result).not.toBeNull();
        expect(result!.path).toContain('/node_modules/prettier/');
      },
      60000
    );
  });

  // ==================== npx prettier 実行テスト ====================

  describe('npx prettier 実行', () => {
    it(
      'prettier の bin シムを NodeRuntime で実行してもモジュール解決エラーが出ない',
      async () => {
        // === 1. prettier をインストール ===
        const installer = createInstaller();
        installer.startBatchProcessing();
        await installer.installWithDependencies('prettier', 'latest');
        await installer.finishBatchProcessing();

        // .bin シムを生成
        await installer.ensureBinsForPackage('prettier');

        // === 2. フォーマット対象のテストファイルを作成 ===
        const testCode = `const x={a:1,b:2,c:3};function foo(){return x;}`;
        await fileRepository.createFile(
          projectId,
          '/test.js',
          testCode,
          'file'
        );

        // === 3. シムが存在するか確認 ===
        const shim = await fileRepository.getFileByPath(
          projectId,
          '/node_modules/.bin/prettier'
        );
        expect(shim).not.toBeNull();
        expect(shim!.content).toContain('require(');

        // === 4. NodeRuntime で実行 ===
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

        const shimPath = `/projects/${projectName}/node_modules/.bin/prettier`;

        const runtime = new NodeRuntime({
          projectId,
          projectName,
          filePath: shimPath,
          debugConsole,
          terminalColumns: 80,
          terminalRows: 24,
        });

        // 実行 — ERR_MODULE_NOT_FOUND が throw されないことが主な検証ポイント
        // prettier は --help などを渡すことで正常終了させる
        let executionError: Error | null = null;
        try {
          await runtime.execute(shimPath, ['--version']);
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

        // prettier --version が出力されることを期待（バージョン番号の形式）
        // 例: "3.2.5" のような出力
        const hasVersionOutput = output.some(line => /^\d+\.\d+\.\d+/.test(line));
        if (!hasVersionOutput) {
          console.log('Warning: prettier --version did not output expected version format');
        }
      },
      120000
    );
  });

  // ==================== prettier モジュール解決テスト ====================

  describe('prettier モジュール解決', () => {
    it(
      'prettier パッケージが require() で正しく解決される',
      async () => {
        // prettier をインストール
        const installer = createInstaller();
        installer.startBatchProcessing();
        await installer.installWithDependencies('prettier', 'latest');
        await installer.finishBatchProcessing();

        // テストファイルを作成
        const testCode = `const prettier = require('prettier');\nconsole.log(typeof prettier.format);`;
        await fileRepository.createFile(
          projectId,
          '/test-prettier.js',
          testCode,
          'file'
        );

        // NodeRuntime で実行
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

        const testPath = `/projects/${projectName}/test-prettier.js`;

        const runtime = new NodeRuntime({
          projectId,
          projectName,
          filePath: testPath,
          debugConsole,
          terminalColumns: 80,
          terminalRows: 24,
        });

        let executionError: Error | null = null;
        try {
          await runtime.execute(testPath, []);
        } catch (e) {
          executionError = e as Error;
        }

        console.log('\n========== Console Output ==========');
        console.log(output.join('\n'));
        console.log('\n========== Error Output ==========');
        console.log(errors.join('\n'));
        console.log('\n========================================\n');

        const allOutput = [...output, ...errors].join('\n');

        // より厳密なエラーチェック
        expect(allOutput).not.toContain('ERR_MODULE_NOT_FOUND');
        expect(allOutput).not.toContain('Cannot find module');
        expect(allOutput).not.toContain('Module execution failed');
        expect(allOutput).not.toContain("Cannot find module 'prettier'");
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

        // prettier.format が function として認識されることを期待
        expect(output.some(line => line.includes('function'))).toBe(true);
      },
      60000
    );
  });
});
