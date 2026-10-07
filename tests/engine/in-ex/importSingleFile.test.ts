import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fsClient } from '@/engine/core/fs';
import { importSingleFile } from '@/engine/in-ex/importSingleFile';

vi.mock('@/engine/core/fs', () => ({
  fsClient: {
    writeFile: vi.fn(),
  },
}));

describe('importSingleFile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('writes every uploaded byte, including empty files and bytes outside ASCII', async () => {
    const fixtures = [new Uint8Array(0), Uint8Array.from({ length: 256 }, (_, index) => index)];

    for (const [index, bytes] of fixtures.entries()) {
      const path = `/workspace/upload-${index}.bin`;
      await importSingleFile(createFile(`upload-${index}.bin`, bytes), path);
      expect(fsClient.writeFile).toHaveBeenLastCalledWith(path, bytes);
    }

    expect(fsClient.writeFile).toHaveBeenCalledTimes(fixtures.length);
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
