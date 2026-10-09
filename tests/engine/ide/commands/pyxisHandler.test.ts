import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handlePyxisCommand } from '@/engine/ide/commands/pyxisHandler';
import { NPM_CACHE_PATH, RUNTIME_CACHE_PATH, TMP_PATH } from '@/engine/core/fs/layout';
import { HOME_DIR } from '@/engine/core/paths';
import { storageService } from '@/engine/core/metadata/index';
import { directoryTree } from '../../../_helpers/opfs';
import { resetTestFs } from '../../../_helpers/testFs';

describe('Pyxis filesystem commands', () => {
  beforeEach(() => {
    vi.useRealTimers();
    resetTestFs();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('rejects unsupported locales without deleting a translation cache', async () => {
    const storageAdapter = await import('@/engine/core/i18n/storage-adapter');
    const removeCache = vi.spyOn(storageAdapter, 'deleteTranslationCache');
    const output: string[] = [];

    await handlePyxisCommand('i18n-clear', ['xx', 'common'], '/tmp/workspace', async line => {
      output.push(line);
    });

    expect(output).toEqual(['i18n clear: サポートされていない言語です: xx']);
    expect(removeCache).not.toHaveBeenCalled();
  });

  it('rejects unknown storage names without clearing a store', async () => {
    const clearStore = vi.spyOn(storageService, 'clear');
    const output: string[] = [];

    await handlePyxisCommand('storage-clear', ['unknown'], '/tmp/workspace', async line => {
      output.push(line);
    });

    expect(output.join('\n')).toContain('無効なストア名です');
    expect(clearStore).not.toHaveBeenCalled();
  });

  it('clears runtime modules and metadata in the HOME cache only', async () => {
    const fs = resetTestFs();
    await fs.init(directoryTree());
    await fs.mkdir(`${RUNTIME_CACHE_PATH}/modules`, { recursive: true });
    await fs.mkdir(`${RUNTIME_CACHE_PATH}/meta`, { recursive: true });
    await fs.mkdir(`${RUNTIME_CACHE_PATH}/archive`, { recursive: true });
    await fs.writeFile(`${RUNTIME_CACHE_PATH}/modules/entry`, 'runtime');
    await fs.writeFile(`${RUNTIME_CACHE_PATH}/meta/entry`, 'metadata');
    await fs.writeFile(`${RUNTIME_CACHE_PATH}/archive/entry`, 'archive');
    await fs.mkdir(NPM_CACHE_PATH, { recursive: true });
    await fs.writeFile(`${NPM_CACHE_PATH}/entry`, 'npm');
    await fs.mkdir('/cache/modules', { recursive: true });
    await fs.writeFile('/cache/modules/entry', 'legacy');

    await handlePyxisCommand('runtime-cache', ['clear'], '/tmp/workspace', async () => {});

    expect(await fs.readdir(`${RUNTIME_CACHE_PATH}/modules`)).toEqual([]);
    expect(await fs.readdir(`${RUNTIME_CACHE_PATH}/meta`)).toEqual([]);
    expect(await fs.readText(`${RUNTIME_CACHE_PATH}/archive/entry`)).toBe('archive');
    expect(await fs.readText(`${NPM_CACHE_PATH}/entry`)).toBe('npm');
    expect(await fs.readText('/cache/modules/entry')).toBe('legacy');
  });

  it('resets user files, clears /tmp, and restores required Linux directories', async () => {
    const fs = resetTestFs();
    await fs.init(directoryTree());
    await fs.mkdir(`${HOME_DIR}/project`, { recursive: true });
    await fs.writeFile(`${HOME_DIR}/project/file`, 'user data');
    await fs.mkdir('/cache', { recursive: true });
    await fs.writeFile('/cache/old-entry', 'old cache');
    await fs.mkdir(`${TMP_PATH}/scratch`, { recursive: true });
    await fs.writeFile(`${TMP_PATH}/scratch/file`, 'temporary');
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      clear: () => values.clear(),
    });
    vi.stubGlobal('window', {
      indexedDB: { databases: async () => [] },
      location: { reload: vi.fn() },
    });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const output: string[] = [];

    await handlePyxisCommand(
      'init',
      ['--all', '--admin', '--confirm'],
      `${HOME_DIR}/project`,
      async line => {
        output.push(line);
      }
    );

    expect(await fs.exists(`${HOME_DIR}/project`)).toBe(false);
    expect(await fs.exists('/cache')).toBe(false);
    expect(await fs.readdir(TMP_PATH)).toEqual([]);
    expect(await fs.stat('/dev/null')).toMatchObject({ type: 'characterDevice' });
    for (const path of [HOME_DIR, RUNTIME_CACHE_PATH, NPM_CACHE_PATH]) {
      expect((await fs.stat(path)).type).toBe('folder');
    }
    expect(output.join('\n')).toContain('initialized Linux directories');
    vi.useRealTimers();
  });
});
