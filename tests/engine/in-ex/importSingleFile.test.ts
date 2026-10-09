import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fsClient } from '@/engine/core/fs';
import { importSingleFile } from '@/engine/in-ex/importSingleFile';

vi.mock('@/engine/core/fs', () => ({
  getParentPath: (path: string) => path.slice(0, path.lastIndexOf('/')) || '/',
  fsClient: {
    exists: vi.fn(),
    mkdir: vi.fn(),
    writeRange: vi.fn(),
  },
}));

describe('importSingleFile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fsClient.exists).mockResolvedValue(false);
    vi.mocked(fsClient.mkdir).mockResolvedValue(undefined);
    vi.mocked(fsClient.writeRange).mockResolvedValue(0);
  });

  it('writes every uploaded byte, including empty files and bytes outside ASCII', async () => {
    const fixtures = [new Uint8Array(0), Uint8Array.from({ length: 256 }, (_, index) => index)];

    for (const [index, bytes] of fixtures.entries()) {
      const path = `/workspace/upload-${index}.bin`;
      await importSingleFile(createFile(`upload-${index}.bin`, bytes), path, 'destination exists');
      expect(fsClient.writeRange).toHaveBeenLastCalledWith(path, bytes, null, true, true);
    }

    expect(fsClient.writeRange).toHaveBeenCalledTimes(fixtures.length);
  });

  it('creates missing parent folders before importing nested folder entries', async () => {
    const path = '/workspace/archive/src/index.ts';
    await importSingleFile(createFile('index.ts', new Uint8Array([1])), path, 'destination exists');

    expect(fsClient.mkdir).toHaveBeenCalledWith('/workspace/archive/src', { recursive: true });
    expect(fsClient.writeRange).toHaveBeenCalledWith(path, new Uint8Array([1]), null, true, true);
  });

  it('preserves an existing destination without writing over it', async () => {
    vi.mocked(fsClient.exists).mockResolvedValue(true);
    const path = '/workspace/existing.txt';

    await expect(
      importSingleFile(createFile('existing.txt', new Uint8Array([1])), path, 'destination exists')
    ).rejects.toThrow('destination exists');

    expect(fsClient.mkdir).not.toHaveBeenCalled();
    expect(fsClient.writeRange).not.toHaveBeenCalled();
  });

  it('stops before creating folders if the workspace changes during the destination check', async () => {
    let resolveExists: (exists: boolean) => void = () => {};
    vi.mocked(fsClient.exists).mockReturnValue(
      new Promise<boolean>(resolve => {
        resolveExists = resolve;
      })
    );
    let isCurrentWorkspace = true;
    const pendingImport = importSingleFile(
      createFile('nested.txt', new Uint8Array([1])),
      '/workspace/nested/nested.txt',
      'destination exists',
      () => isCurrentWorkspace,
      'workspace changed'
    );

    isCurrentWorkspace = false;
    resolveExists(false);

    await expect(pendingImport).rejects.toThrow('workspace changed');
    expect(fsClient.mkdir).not.toHaveBeenCalled();
    expect(fsClient.writeRange).not.toHaveBeenCalled();
  });

  it('stops after a deferred file read when the menu workspace has changed', async () => {
    let resolveArrayBuffer: (buffer: ArrayBuffer) => void = () => {};
    const file = {
      name: 'deferred.txt',
      arrayBuffer: () =>
        new Promise<ArrayBuffer>(resolve => {
          resolveArrayBuffer = resolve;
        }),
    } as File;
    let currentRootPath = '/workspace';
    const pendingImport = importSingleFile(
      file,
      '/workspace/deferred.txt',
      'destination exists',
      () => currentRootPath === '/workspace',
      'workspace changed'
    );

    currentRootPath = '/other-workspace';
    resolveArrayBuffer(new ArrayBuffer(1));

    await expect(pendingImport).rejects.toThrow('workspace changed');
    expect(fsClient.exists).not.toHaveBeenCalled();
    expect(fsClient.mkdir).not.toHaveBeenCalled();
    expect(fsClient.writeRange).not.toHaveBeenCalled();
  });

  it('stops before writing if the workspace changes while creating import folders', async () => {
    let resolveMkdir: () => void = () => {};
    vi.mocked(fsClient.mkdir).mockReturnValue(
      new Promise<void>(resolve => {
        resolveMkdir = resolve;
      })
    );
    let isCurrentWorkspace = true;
    const pendingImport = importSingleFile(
      createFile('nested.txt', new Uint8Array([1])),
      '/workspace/nested/nested.txt',
      'destination exists',
      () => isCurrentWorkspace,
      'workspace changed'
    );
    await vi.waitFor(() => expect(fsClient.mkdir).toHaveBeenCalled());

    isCurrentWorkspace = false;
    resolveMkdir();

    await expect(pendingImport).rejects.toThrow('workspace changed');
    expect(fsClient.writeRange).not.toHaveBeenCalled();
  });

  it('preserves a deferred write failure for the caller to report', async () => {
    let rejectWrite: (reason: Error) => void = () => {};
    const writeFailure = new Error('worker unavailable');
    vi.mocked(fsClient.writeRange).mockReturnValue(
      new Promise<number>((_resolve, reject) => {
        rejectWrite = reject;
      })
    );
    const pendingImport = importSingleFile(
      createFile('pending.txt', new Uint8Array([1])),
      '/workspace/pending.txt',
      'destination exists'
    );
    await vi.waitFor(() => expect(fsClient.writeRange).toHaveBeenCalled());

    rejectWrite(writeFailure);

    await expect(pendingImport).rejects.toBe(writeFailure);
  });
});

function createFile(name: string, content: Uint8Array): File {
  const arrayBuffer = content.buffer.slice(
    content.byteOffset,
    content.byteOffset + content.byteLength
  ) as ArrayBuffer;

  return {
    name,
    arrayBuffer: async () => arrayBuffer,
  } as File;
}
