import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RUNTIME_CACHE_PATH } from '@/engine/core/fs/layout';
import { TranspileManager } from '@/engine/system/runtime/transpiler/transpileManager';
import type { TranspileRequest } from '@/engine/system/runtime/transpiler/transpileWorker';
import { MemoryFs } from '../../../_helpers/memoryFs';

const { transform } = vi.hoisted(() => ({
  transform: vi.fn(async (request: TranspileRequest) => ({
    id: request.id,
    code: `transformed:${request.code}`,
    dependencies: [{ specifier: 'package', kind: 'import' as const }],
  })),
}));

vi.mock('@/engine/system/runtime/transpiler/WorkerPool', () => ({
  createWorkerPool: () => ({
    call: async (invoke: (api: { transpile: typeof transform }) => ReturnType<typeof transform>) =>
      invoke({ transpile: transform }),
  }),
}));

function createStorage() {
  const memory = new MemoryFs();
  const fs = {
    readText: vi.fn(async (path: string) => new TextDecoder().decode(await memory.readFile(path))),
    mkdir: vi.fn(async (path: string, options: { recursive?: boolean } = {}) => {
      await memory.mkdir(path, { recursive: options.recursive ?? false });
    }),
    writeFile: vi.fn(
      async (
        path: string,
        data: string | Uint8Array,
        _options: { mode?: number } = {},
        _emit = true
      ) => {
        let bytes: Uint8Array;
        if (typeof data === 'string') bytes = new TextEncoder().encode(data);
        else bytes = data;
        await memory.writeFile(path, bytes);
      }
    ),
  };
  const manager = new TranspileManager(fs);
  return { manager, memory, fs };
}

describe('filesystem-owned transpile cache', () => {
  beforeEach(() => vi.clearAllMocks());

  it('persists one transform entry and reuses it after runtime and manager recreation', async () => {
    const { manager, memory, fs } = createStorage();
    const options = { filePath: '/workspace/entry.mjs', code: 'export const value = 1;' };
    const first = await manager.transpile(options);
    const restarted = new TranspileManager(fs);
    const cached = await restarted.transpile(options);

    expect(cached.code).toBe(first.code);
    expect(cached.dependencies).toEqual([{ specifier: 'package', kind: 'import' }]);
    expect(transform).toHaveBeenCalledTimes(1);
    expect(fs.writeFile).toHaveBeenCalledTimes(1);
    expect(fs.writeFile.mock.calls[0][3]).toBe(false);
    expect(await memory.readdir(`${RUNTIME_CACHE_PATH}/modules`)).toHaveLength(1);
  });

  it('invalidates changed source, transform flags, and registered transpiler identity', async () => {
    const { manager } = createStorage();
    const options = { filePath: '/workspace/entry.ts', code: 'export const value: number = 1;' };
    manager.configureTranspilers([
      { id: 'typescript', supportedExtensions: ['.ts'], workerTransform: 'typescript' },
    ]);
    await manager.transpile(options);
    const changedSource = { ...options, code: 'export const value: number = 2;' };
    await manager.transpile(changedSource);
    const changedLoader = { ...changedSource, isJSX: true };
    await manager.transpile(changedLoader);
    manager.configureTranspilers([
      { id: 'typescript-new', supportedExtensions: ['.ts'], workerTransform: 'typescript' },
    ]);
    await manager.transpile(changedLoader);

    expect(transform).toHaveBeenCalledTimes(4);
  });

  it('serializes repeated requests so they share the same persisted transform', async () => {
    const { manager } = createStorage();
    const options = { filePath: '/workspace/entry.mjs', code: 'export const value = 1;' };
    await Promise.all([manager.transpile(options), manager.transpile(options)]);
    expect(transform).toHaveBeenCalledTimes(1);
  });

  it('regenerates corrupt persisted entries', async () => {
    const { manager, memory, fs } = createStorage();
    const options = { filePath: '/workspace/entry.mjs', code: 'export const value = 1;' };
    await manager.transpile(options);
    const directory = `${RUNTIME_CACHE_PATH}/modules`;
    const [filename] = await memory.readdir(directory);
    await memory.writeFile(`${directory}/${filename}`, new TextEncoder().encode('{}'));

    const regenerated = await manager.transpile(options);

    expect(regenerated.code).toBe('transformed:export const value = 1;');
    expect(transform).toHaveBeenCalledTimes(2);
    const restarted = new TranspileManager(fs);
    await restarted.transpile(options);
    expect(transform).toHaveBeenCalledTimes(2);
  });

  it('regenerates cache files containing invalid JSON', async () => {
    const { manager, memory } = createStorage();
    const options = { filePath: '/workspace/entry.mjs', code: 'export const value = 1;' };
    await manager.transpile(options);
    const directory = `${RUNTIME_CACHE_PATH}/modules`;
    const [filename] = await memory.readdir(directory);
    await memory.writeFile(`${directory}/${filename}`, new TextEncoder().encode('{'));

    const regenerated = await manager.transpile(options);

    expect(regenerated.code).toBe('transformed:export const value = 1;');
    expect(transform).toHaveBeenCalledTimes(2);
  });

  it('requires a registered TypeScript transpiler before consulting persistent cache', async () => {
    const { manager, fs } = createStorage();
    await expect(
      manager.transpile({
        filePath: '/workspace/entry.ts',
        code: 'export const value: number = 1;',
      })
    ).rejects.toThrow('No TypeScript transpiler is registered');
    expect(fs.readText).not.toHaveBeenCalled();
    expect(transform).not.toHaveBeenCalled();
  });
});
