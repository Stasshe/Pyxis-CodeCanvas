import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * npm/npx コマンドハンドラのテスト
 * コマンドのディスパッチとエラーハンドリングを検証
 */

// terminalCommandRegistry をモック
const mockNpm = {
  init: vi.fn().mockResolvedValue('Wrote to package.json'),
  install: vi.fn().mockResolvedValue('added 1 package'),
  uninstall: vi.fn().mockResolvedValue('removed 1 package'),
  list: vi.fn().mockResolvedValue('dependencies:\n  lodash@4.17.21'),
  run: vi.fn().mockResolvedValue('> test\nAll tests passed'),
  setLoadingHandler: vi.fn(),
};

const mockUnix = {
  pwd: vi.fn().mockResolvedValue('/projects/TestProject'),
  cat: vi.fn(),
};

vi.mock('@/engine/cmd/terminalRegistry', () => ({
  terminalCommandRegistry: {
    getNpmCommands: vi.fn(() => mockNpm),
    getUnixCommands: vi.fn(() => mockUnix),
  },
}));

// Dynamic import の NodeRuntime モック (npx で使用)
vi.mock('@/engine/runtime/nodeRuntime', () => ({
  NodeRuntime: vi.fn().mockImplementation(() => ({
    execute: vi.fn().mockResolvedValue(undefined),
    waitForEventLoop: vi.fn().mockResolvedValue(undefined),
    clearCache: vi.fn(),
  })),
}));

import { handleNPMCommand, handleNPXCommand } from '@/engine/cmd/handlers/npmHandler';

describe('npmHandler', () => {
  let output: string[];
  const writeOutput = vi.fn(async (text: string) => {
    output.push(text);
  });
  const setLoading = vi.fn();

  beforeEach(() => {
    output = [];
    vi.clearAllMocks();
  });

  // ==================== npm コマンド ====================

  describe('handleNPMCommand', () => {
    it('npm init', async () => {
      await handleNPMCommand(['init'], 'TestProject', 'test-id', writeOutput, setLoading);
      expect(mockNpm.init).toHaveBeenCalledWith(false);
      expect(output).toHaveLength(1);
    });

    it('npm init --force', async () => {
      await handleNPMCommand(
        ['init', '--force'],
        'TestProject',
        'test-id',
        writeOutput,
        setLoading
      );
      expect(mockNpm.init).toHaveBeenCalledWith(true);
    });

    it('npm init -f', async () => {
      await handleNPMCommand(
        ['init', '-f'],
        'TestProject',
        'test-id',
        writeOutput,
        setLoading
      );
      expect(mockNpm.init).toHaveBeenCalledWith(true);
    });

    it('npm install (引数なし)', async () => {
      await handleNPMCommand(['install'], 'TestProject', 'test-id', writeOutput, setLoading);
      expect(mockNpm.install).toHaveBeenCalledWith();
    });

    it('npm install lodash', async () => {
      await handleNPMCommand(
        ['install', 'lodash'],
        'TestProject',
        'test-id',
        writeOutput,
        setLoading
      );
      expect(mockNpm.install).toHaveBeenCalledWith('lodash', []);
    });

    it('npm install lodash --save-dev', async () => {
      await handleNPMCommand(
        ['install', 'lodash', '--save-dev'],
        'TestProject',
        'test-id',
        writeOutput,
        setLoading
      );
      expect(mockNpm.install).toHaveBeenCalledWith('lodash', ['--save-dev']);
    });

    it('npm i (install の短縮形)', async () => {
      await handleNPMCommand(
        ['i', 'express'],
        'TestProject',
        'test-id',
        writeOutput,
        setLoading
      );
      expect(mockNpm.install).toHaveBeenCalledWith('express', []);
    });

    it('npm uninstall lodash', async () => {
      await handleNPMCommand(
        ['uninstall', 'lodash'],
        'TestProject',
        'test-id',
        writeOutput,
        setLoading
      );
      expect(mockNpm.uninstall).toHaveBeenCalledWith('lodash');
    });

    it('npm remove (uninstall の別名)', async () => {
      await handleNPMCommand(
        ['remove', 'lodash'],
        'TestProject',
        'test-id',
        writeOutput,
        setLoading
      );
      expect(mockNpm.uninstall).toHaveBeenCalledWith('lodash');
    });

    it('npm rm (uninstall の別名)', async () => {
      await handleNPMCommand(
        ['rm', 'lodash'],
        'TestProject',
        'test-id',
        writeOutput,
        setLoading
      );
      expect(mockNpm.uninstall).toHaveBeenCalledWith('lodash');
    });

    it('npm uninstall (パッケージ名なし)', async () => {
      await handleNPMCommand(
        ['uninstall'],
        'TestProject',
        'test-id',
        writeOutput,
        setLoading
      );
      expect(output[0]).toContain('missing package name');
    });

    it('npm list', async () => {
      await handleNPMCommand(['list'], 'TestProject', 'test-id', writeOutput, setLoading);
      expect(mockNpm.list).toHaveBeenCalled();
    });

    it('npm ls (list の別名)', async () => {
      await handleNPMCommand(['ls'], 'TestProject', 'test-id', writeOutput, setLoading);
      expect(mockNpm.list).toHaveBeenCalled();
    });

    it('npm run test', async () => {
      await handleNPMCommand(
        ['run', 'test'],
        'TestProject',
        'test-id',
        writeOutput,
        setLoading
      );
      expect(mockNpm.run).toHaveBeenCalledWith('test');
    });

    it('npm run (スクリプト名なし)', async () => {
      await handleNPMCommand(['run'], 'TestProject', 'test-id', writeOutput, setLoading);
      expect(output[0]).toContain('missing script name');
    });

    it('未サポートのコマンド', async () => {
      await handleNPMCommand(
        ['publish'],
        'TestProject',
        'test-id',
        writeOutput,
        setLoading
      );
      expect(output[0]).toContain('not a supported npm command');
    });

    it('コマンドなし', async () => {
      await handleNPMCommand([], 'TestProject', 'test-id', writeOutput, setLoading);
      expect(output[0]).toContain('missing command');
    });

    it('setLoading ハンドラが設定される', async () => {
      await handleNPMCommand(
        ['install', 'lodash'],
        'TestProject',
        'test-id',
        writeOutput,
        setLoading
      );
      expect(mockNpm.setLoadingHandler).toHaveBeenCalledWith(setLoading);
    });
  });

  // ==================== npx コマンド ====================

  describe('handleNPXCommand', () => {
    it('コマンドなしはエラーコード 2', async () => {
      const code = await handleNPXCommand([], 'TestProject', 'test-id', writeOutput);
      expect(code).toBe(2);
      expect(output[0]).toContain('missing command');
    });

    it('存在しないバイナリはコード 127', async () => {
      // unix.cat がエラーを投げる (ファイルが存在しない)
      mockUnix.cat.mockRejectedValue(new Error('file not found'));

      const code = await handleNPXCommand(
        ['nonexistent'],
        'TestProject',
        'test-id',
        writeOutput
      );
      expect(code).toBe(127);
      expect(output[0]).toContain('command not found');
    });
  });
});
