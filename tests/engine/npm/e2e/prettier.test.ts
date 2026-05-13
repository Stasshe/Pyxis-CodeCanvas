import { describe, it, expect, beforeAll, vi } from 'vitest';
import { setupTestProject } from '../../../_helpers/testProject';
import { fileRepository } from '@/engine/core/fileRepository';
import { NpmInstall } from '@/engine/cmd/global/npmOperations/npmInstall';
import {
  extractCjsDependencies,
  transformEsmToCjs,
} from '@/engine/runtime/transpiler/esmTransformer';

vi.mock('@/engine/runtime/transpiler/transpileManager', () => ({
  transpileManager: {
    transpile: async (options: { code: string; filePath: string }) => {
      const code = await transformEsmToCjs(options.code, options.filePath);
      return {
        id: 'mock',
        code,
        dependencies: extractCjsDependencies(code),
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
 * インストールは describe スコープで一度だけ行い、各テストはその結果を共有する。
 */

// ===== ヘルパー =====

type DebugConsole = {
  log: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  clear: () => void;
};

function createCollectingConsole(): {
  console: DebugConsole;
  output: string[];
  errors: string[];
  all: () => string;
} {
  const output: string[] = [];
  const errors: string[] = [];
  return {
    console: {
      log: (...args: unknown[]) => output.push(args.map(String).join(' ')),
      error: (...args: unknown[]) => errors.push(args.map(String).join(' ')),
      warn: (...args: unknown[]) => output.push(args.map(String).join(' ')),
      clear: () => {},
    },
    output,
    errors,
    all: () => [...output, ...errors].join('\n'),
  };
}

async function runPrettier(
  projectId: string,
  projectName: string,
  binPath: string,
  args: string[],
  cwd?: string
): Promise<{ output: string[]; errors: string[]; all: string; exitCode: number }> {
  const col = createCollectingConsole();
  const runtime = new NodeRuntime({
    projectId,
    projectName,
    filePath: binPath,
    cwd: cwd ?? `/projects/${projectName}`,
    debugConsole: col.console,
    terminalColumns: 80,
    terminalRows: 24,
  });

  try {
    await runtime.execute(binPath, args);
    await runtime.waitForEventLoop();
  } catch (_) {
    // process.exit() 等はここに来る場合がある
  }

  return {
    output: col.output,
    errors: col.errors,
    all: col.all(),
    exitCode: runtime.getExitCode(),
  };
}

// ===== テストスイート =====

describe('e2e — npx prettier', () => {
  let projectId: string;
  let projectName: string;
  let binPath: string;

  beforeAll(async () => {
    const ctx = await setupTestProject('PrettierE2ETest');
    projectId = ctx.projectId;
    projectName = ctx.projectName;

    // prettier を一度だけインストール
    const installer = new NpmInstall(projectName, projectId, /* skipLoad */ true);
    installer.startBatchProcessing();
    await installer.installWithDependencies('prettier', 'latest');
    await installer.finishBatchProcessing();
    await installer.ensureBinsForPackage('prettier');

    // runtime が必要とする tmp ファイル
    await fileRepository.createFile(projectId, '/tmp/ionstore_tiny-updater.json', '{}', 'file');

    // bin パスを解決
    const prettierPkg = await fileRepository.getFileByPath(
      projectId,
      '/node_modules/prettier/package.json'
    );
    if (!prettierPkg) throw new Error('prettier not installed');
    const pkg = JSON.parse(prettierPkg.content);
    const binField = typeof pkg.bin === 'string' ? { prettier: pkg.bin } : pkg.bin;
    const binEntry = (Object.values(binField)[0] as string).replace(/^\.\//, '');
    binPath = `/projects/${projectName}/node_modules/prettier/${binEntry}`;
  }, 120_000);

  // ===== インストール確認 =====

  describe('インストール確認', () => {
    it('package.json が存在する', async () => {
      const pkg = await fileRepository.getFileByPath(
        projectId,
        '/node_modules/prettier/package.json'
      );
      expect(pkg).not.toBeNull();
      expect(JSON.parse(pkg!.content).name).toBe('prettier');
    });

    it('.bin/prettier シムが存在し require() を含む', async () => {
      const shim = await fileRepository.getFileByPath(projectId, '/node_modules/.bin/prettier');
      expect(shim).not.toBeNull();
      expect(shim!.content).toContain('require(');
    });

    it('ModuleResolver で prettier が解決できる', async () => {
      const resolver = new ModuleResolver(projectId, projectName);
      const result = await resolver.resolve('prettier', `/projects/${projectName}/index.js`);
      expect(result).not.toBeNull();
      expect(result!.path).toContain('/node_modules/prettier/');
    });
  });

  // ===== --version =====

  describe('--version', () => {
    it(
      'バージョン番号を出力して正常終了する',
      async () => {
        const { output, all } = await runPrettier(projectId, projectName, binPath, ['--version']);

        expect(all).not.toContain('Cannot find module');
        expect(all).not.toContain('ERR_MODULE_NOT_FOUND');

        const hasVersion = output.some(l => /^\d+\.\d+\.\d+/.test(l.trim()));
        expect(hasVersion).toBe(true);
      },
      60_000
    );
  });

  // ===== require('prettier') =====

  describe("require('prettier')", () => {
    it(
      'prettier.format が function として取得できる',
      async () => {
        const testPath = `/projects/${projectName}/test-prettier-api.js`;
        await fileRepository.createFile(
          projectId,
          '/test-prettier-api.js',
          `const p = require('prettier'); console.log(typeof p.format);`,
          'file'
        );

        const col = createCollectingConsole();
        const runtime = new NodeRuntime({
          projectId,
          projectName,
          filePath: testPath,
          debugConsole: col.console,
          terminalColumns: 80,
          terminalRows: 24,
        });
        await runtime.execute(testPath, []);
        await runtime.waitForEventLoop();

        expect(col.all()).not.toContain('Cannot find module');
        expect(col.output.some(l => l.includes('function'))).toBe(true);
      },
      60_000
    );
  });

  // ===== --write でファイルをフォーマット =====

  describe('--write フォーマット', () => {
    it(
      '未フォーマットの JS ファイルが整形される',
      async () => {
        const unformatted = `const x={a:1,b:2,c:3};function foo(){return x;}`;
        await fileRepository.createFile(projectId, '/src/fmt-test.js', unformatted, 'file');

        const { all } = await runPrettier(projectId, projectName, binPath, [
          'src/fmt-test.js',
          '--write',
        ]);

        expect(all).not.toContain('Cannot find module');
        expect(all).not.toContain('ERR_MODULE_NOT_FOUND');

        // ファイル内容が変わっていることを確認
        const after = await fileRepository.getFileByPath(projectId, '/src/fmt-test.js');
        expect(after).not.toBeNull();
        expect(after!.content).not.toBe(unformatted);
        // prettier はセミコロン・改行を整える
        expect(after!.content).toContain('function foo()');
      },
      90_000
    );

    it(
      '複数ファイルを一括フォーマットできる',
      async () => {
        const files = {
          '/src/multi/a.js': `const a={x:1};`,
          '/src/multi/b.js': `function bar(  ){return 42;}`,
        };
        for (const [path, content] of Object.entries(files)) {
          await fileRepository.createFile(projectId, path, content, 'file');
        }

        const { all } = await runPrettier(projectId, projectName, binPath, [
          'src/multi/',
          '--write',
        ]);

        expect(all).not.toContain('Cannot find module');

        for (const [path, original] of Object.entries(files)) {
          const after = await fileRepository.getFileByPath(projectId, path);
          expect(after).not.toBeNull();
          expect(after!.content).not.toBe(original);
        }
      },
      90_000
    );

    it(
      'パス表示が ../../ を含まない（cwd 基準の相対パスになる）',
      async () => {
        await fileRepository.createFile(projectId, '/src/path-check.js', `const y={z:1};`, 'file');

        const { output } = await runPrettier(projectId, projectName, binPath, [
          'src/path-check.js',
          '--write',
        ]);

        // 出力行にファイルパスが含まれる場合、../../ で始まってはいけない
        const pathLines = output.filter(l => l.includes('path-check.js'));
        for (const line of pathLines) {
          expect(line).not.toMatch(/^\.\.\//);
          expect(line).not.toContain('../../');
        }

        // 正しいパス形式: src/path-check.js で始まる
        if (pathLines.length > 0) {
          expect(pathLines[0]).toMatch(/^src[/\\]/);
        }
      },
      90_000
    );

    it(
      '変更不要のファイルは (unchanged) と表示される',
      async () => {
        // 既に整形済みのコードを用意
        const formatted = `const z = { a: 1 };\n`;
        await fileRepository.createFile(projectId, '/src/already-fmt.js', formatted, 'file');

        // 1回目: フォーマット（整形が入る可能性あり）
        await runPrettier(projectId, projectName, binPath, ['src/already-fmt.js', '--write']);

        // 2回目: 変更なしになるはず
        const { output } = await runPrettier(projectId, projectName, binPath, [
          'src/already-fmt.js',
          '--write',
        ]);

        const allOutput = output.join('\n');
        // "(unchanged)" が出力されることを確認
        expect(allOutput).toContain('unchanged');
      },
      90_000
    );
  });

  // ===== --check モード =====

  describe('--check モード', () => {
    it(
      '未フォーマットファイルを --check すると非ゼロ終了する',
      async () => {
        await fileRepository.createFile(
          projectId,
          '/src/check-bad.js',
          `const q={x:1,y:2};`,
          'file'
        );

        const { exitCode, all } = await runPrettier(projectId, projectName, binPath, [
          'src/check-bad.js',
          '--check',
        ]);

        expect(all).not.toContain('Cannot find module');
        // prettier --check は未フォーマット時に exit code 1 を返す
        expect(exitCode).not.toBe(0);
      },
      60_000
    );

    it(
      'フォーマット済みファイルを --check すると exit code 0 になる',
      async () => {
        await fileRepository.createFile(
          projectId,
          '/src/check-good.js',
          `const q = { x: 1, y: 2 };\n`,
          'file'
        );

        // まず --write で整形
        await runPrettier(projectId, projectName, binPath, ['src/check-good.js', '--write']);

        // 整形後の内容で --check
        const { exitCode, all } = await runPrettier(projectId, projectName, binPath, [
          'src/check-good.js',
          '--check',
        ]);

        expect(all).not.toContain('Cannot find module');
        expect(exitCode).toBe(0);
      },
      90_000
    );
  });

  // ===== TypeScript / CSS =====

  describe('複数ファイルタイプ', () => {
    it(
      'TypeScript ファイルをフォーマットできる',
      async () => {
        const tsCode = `const fn=(x:number):string=>{return String(x);}`;
        await fileRepository.createFile(projectId, '/src/hello.ts', tsCode, 'file');

        const { all } = await runPrettier(projectId, projectName, binPath, [
          'src/hello.ts',
          '--write',
        ]);

        expect(all).not.toContain('Cannot find module');

        const after = await fileRepository.getFileByPath(projectId, '/src/hello.ts');
        expect(after).not.toBeNull();
        // prettier は型注釈を保持しつつ整形する
        expect(after!.content).toContain('number');
        expect(after!.content).toContain('string');
      },
      90_000
    );

    it(
      'CSS ファイルをフォーマットできる',
      async () => {
        const cssCode = `.foo{color:red;margin:0}`;
        await fileRepository.createFile(projectId, '/src/style.css', cssCode, 'file');

        const { all } = await runPrettier(projectId, projectName, binPath, [
          'src/style.css',
          '--write',
        ]);

        expect(all).not.toContain('Cannot find module');

        const after = await fileRepository.getFileByPath(projectId, '/src/style.css');
        expect(after).not.toBeNull();
        expect(after!.content).not.toBe(cssCode);
        expect(after!.content).toContain('color');
      },
      90_000
    );
  });
});
