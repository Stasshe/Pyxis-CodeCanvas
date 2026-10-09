import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toDataUrlFromUint8 } from '@/engine/extensions/binaryUtils';
import { saveInstalledExtension } from '@/engine/extensions/storage-adapter';
import { ExtensionStatus, ExtensionType, type InstalledExtension } from '@/engine/extensions/types';

const savedStorage = vi.hoisted(() => ({
  value: null as InstalledExtension | null,
}));

vi.mock('@/engine/storage', () => ({
  STORES: { EXTENSIONS: 'extensions' },
  storageService: {
    set: vi.fn(async (_store: string, _key: string, value: InstalledExtension) => {
      savedStorage.value = value;
    }),
  },
}));

describe('extension binary cache persistence', () => {
  beforeEach(() => {
    savedStorage.value = null;
  });

  it('converts cached data URLs into MIME typed blobs without changing view bytes', async () => {
    const payload = Uint8Array.from({ length: 256 }, (_, index) => index);
    const backing = new Uint8Array(payload.byteLength + 2);
    backing.set(payload, 1);
    const dataUrl = toDataUrlFromUint8(
      backing.subarray(1, backing.byteLength - 1),
      'image.dat',
      'image/png'
    );
    const extension: InstalledExtension = {
      manifest: {
        id: 'pyxis.binary-cache',
        name: 'Binary cache',
        version: '1.0.0',
        type: ExtensionType.UI,
        description: '',
        author: '',
        entry: 'index.js',
        status: ExtensionStatus.INSTALLED,
        installedAt: 0,
        updatedAt: 0,
        enabled: false,
      },
      status: ExtensionStatus.INSTALLED,
      installedAt: 0,
      updatedAt: 0,
      enabled: false,
      cache: { entryCode: '', files: { 'image.dat': dataUrl }, cachedAt: 0 },
    };

    await saveInstalledExtension(extension);

    const stored = savedStorage.value?.cache.files?.['image.dat'];
    expect(stored).toBeInstanceOf(Blob);
    if (!(stored instanceof Blob))
      throw new Error('Expected the cached binary asset to be a Blob.');
    expect(stored.type).toBe('image/png');
    expect(new Uint8Array(await stored.arrayBuffer())).toEqual(payload);
  });
});
