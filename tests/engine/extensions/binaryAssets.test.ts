import JSZip from 'jszip';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchExtensionCode } from '@/engine/extensions/extensionLoader';
import { extensionManager } from '@/engine/extensions/extensionManager';
import { type ExtensionManifest, ExtensionStatus, ExtensionType } from '@/engine/extensions/types';

vi.mock('@/engine/extensions/storage-adapter', () => ({
  deleteInstalledExtension: vi.fn(),
  loadAllInstalledExtensions: vi.fn(),
  loadInstalledExtension: vi.fn(),
  saveInstalledExtension: vi.fn(),
}));

const pngBytes = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC'
  ),
  character => character.charCodeAt(0)
);
const arbitraryBytes = Uint8Array.from({ length: 256 }, (_, index) => index);

describe('extension binary assets', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('detects remote binary assets by bytes and keeps UTF-8 source strict', async () => {
    const responses = [
      new Response('export {};'),
      new Response(pngBytes),
      new Response('export {};'),
      new Response(arbitraryBytes),
      new Response(Uint8Array.of(0xff)),
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => responses.shift() ?? new Response(null))
    );
    const manifest: ExtensionManifest = {
      id: 'pyxis.binary-fixture',
      name: 'Binary fixture',
      version: '1.0.0',
      type: ExtensionType.UI,
      description: '',
      author: '',
      entry: 'index.js',
      status: ExtensionStatus.AVAILABLE,
      installedAt: 0,
      updatedAt: 0,
      enabled: false,
    };

    const png = await fetchExtensionCode({ ...manifest, files: ['image.dat'] });
    const misleading = await fetchExtensionCode({
      ...manifest,
      files: ['samebinarybytesmisleading.txt'],
    });
    const invalidEntry = await fetchExtensionCode(manifest);

    expect(png?.files['image.dat']).toMatch(/^data:image\/png;base64,/);
    expect(decodeDataUrl(png?.files['image.dat'])).toEqual(pngBytes);
    expect(decodeDataUrl(misleading?.files['samebinarybytesmisleading.txt'])).toEqual(
      arbitraryBytes
    );
    expect(invalidEntry).toBeNull();
  });

  it('stores ZIP binary assets as exact MIME typed Blobs', async () => {
    const zip = new JSZip();
    zip.file(
      'manifest.json',
      JSON.stringify({
        id: 'pyxis.binary-fixture',
        name: 'Binary fixture',
        version: '1.0.0',
        entry: 'index.js',
        files: ['image.dat', 'samebinarybytesmisleading.txt'],
      })
    );
    zip.file('index.js', 'export {};');
    zip.file('image.dat', pngBytes);
    zip.file('samebinarybytesmisleading.txt', arbitraryBytes);
    const archive = await zip.generateAsync({ type: 'blob' });
    const enable = vi.spyOn(extensionManager, 'enableExtension').mockResolvedValue(true);

    const installed = await extensionManager.installExtensionFromZip(archive);

    expect(installed?.status).toBe(ExtensionStatus.INSTALLED);
    expect(enable).toHaveBeenCalledWith('pyxis.binary-fixture');
    const files = installed?.cache.files;
    const png = files?.['image.dat'];
    const misleading = files?.['samebinarybytesmisleading.txt'];
    expect(png).toBeInstanceOf(Blob);
    expect(misleading).toBeInstanceOf(Blob);
    if (!(png instanceof Blob) || !(misleading instanceof Blob)) {
      throw new Error('ZIP binary assets must be persisted as blobs.');
    }
    expect(png.type).toBe('image/png');
    expect(new Uint8Array(await png.arrayBuffer())).toEqual(pngBytes);
    expect(new Uint8Array(await misleading.arrayBuffer())).toEqual(arbitraryBytes);
  });
});

function decodeDataUrl(value: string | undefined): Uint8Array {
  if (!value) throw new Error('Expected a binary asset data URL.');
  const separator = value.indexOf(',');
  if (separator < 0) throw new Error('Invalid binary asset data URL.');
  const binary = atob(value.slice(separator + 1));
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}
