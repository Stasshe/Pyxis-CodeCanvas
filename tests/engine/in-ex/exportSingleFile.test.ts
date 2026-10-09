import { afterEach, describe, expect, it, vi } from 'vitest';

import { fsClient } from '@/engine/core/fs';
import { exportSingleFile } from '@/engine/in-ex/exportSingleFile';

vi.mock('@/engine/core/fs', async importOriginal => {
  const original = await importOriginal<typeof import('@/engine/core/fs')>();
  return {
    ...original,
    fsClient: { readFile: vi.fn() },
  };
});

describe('exportSingleFile', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('downloads only the selected bytes from a typed-array view', async () => {
    const payload = Uint8Array.from({ length: 256 }, (_, index) => index);
    const backing = new Uint8Array(payload.byteLength + 2);
    backing.set(payload, 1);
    vi.mocked(fsClient.readFile).mockResolvedValue(backing.subarray(1, backing.byteLength - 1));

    const blobs: Blob[] = [];
    const anchor = { href: '', download: '', click: vi.fn() };
    vi.useFakeTimers();
    vi.stubGlobal('URL', {
      createObjectURL: (blob: Blob) => {
        blobs.push(blob);
        return 'blob:file';
      },
      revokeObjectURL: vi.fn(),
    });
    vi.stubGlobal('document', {
      createElement: () => anchor,
      body: { appendChild: vi.fn(), removeChild: vi.fn() },
    });

    await exportSingleFile('/workspace/raw.bin');
    await vi.advanceTimersByTimeAsync(100);

    const downloadBlob = blobs[0];
    if (!downloadBlob) throw new Error('The file export did not create a download blob.');
    expect(new Uint8Array(await downloadBlob.arrayBuffer())).toEqual(payload);
    expect(anchor.download).toBe('raw.bin');
    expect(anchor.click).toHaveBeenCalledOnce();
  });
});
