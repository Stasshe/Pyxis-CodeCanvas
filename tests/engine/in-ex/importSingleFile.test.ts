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

  it('writes the file bytes to its absolute path', async () => {
    const bytes = new Uint8Array([80, 75, 3, 4, 0, 255]);
    const file = createFile('slides.pptx', bytes);

    await importSingleFile(file, '/workspace/slides.pptx');

    expect(fsClient.writeFile).toHaveBeenCalledTimes(1);
    expect(fsClient.writeFile).toHaveBeenCalledWith('/workspace/slides.pptx', bytes);
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
