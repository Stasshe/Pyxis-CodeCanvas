import JSZip from 'jszip';
import { afterEach, describe, expect, it, vi } from 'vitest';

import * as extensionLoader from '@/engine/ide/extensions/extensionLoader';
import { extensionManager } from '@/engine/ide/extensions/extensionManager';
import {
  loadInstalledExtension,
  saveInstalledExtension,
} from '@/engine/ide/extensions/storage-adapter';
import {
  type ExtensionExports,
  type ExtensionManifest,
  ExtensionStatus,
  ExtensionType,
  type InstalledExtension,
} from '@/engine/ide/extensions/types';

const mocks = vi.hoisted(() => ({
  installed: new Map<string, InstalledExtension>(),
}));

vi.mock('@/engine/ide/extensions/storage-adapter', () => ({
  deleteInstalledExtension: vi.fn(async (id: string) => {
    mocks.installed.delete(id);
  }),
  loadAllInstalledExtensions: vi.fn(async () =>
    Array.from(mocks.installed.values(), installed => structuredClone(installed))
  ),
  loadInstalledExtension: vi.fn(async (id: string) => {
    const installed = mocks.installed.get(id);
    return installed ? structuredClone(installed) : null;
  }),
  saveInstalledExtension: vi.fn(async (installed: InstalledExtension) => {
    mocks.installed.set(installed.manifest.id, structuredClone(installed));
  }),
}));

const pngBytes = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC'
  ),
  character => character.charCodeAt(0)
);
const arbitraryBytes = Uint8Array.from({ length: 256 }, (_, index) => index);

describe('extension binary assets', () => {
  afterEach(async () => {
    if (
      extensionManager
        .getActiveExtensions()
        .some(active => active.manifest.id === 'pyxis.binary-fixture')
    ) {
      await extensionManager.disableExtension('pyxis.binary-fixture');
    }
    mocks.installed.clear();
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
      metadata: { publishedAt: '', updatedAt: '' },
    };

    const png = await extensionLoader.fetchExtensionCode({ ...manifest, files: ['image.dat'] });
    const misleading = await extensionLoader.fetchExtensionCode({
      ...manifest,
      files: ['samebinarybytesmisleading.txt'],
    });
    const invalidEntry = await extensionLoader.fetchExtensionCode(manifest);

    expect(png?.files['image.dat']).toMatch(/^data:image\/png;base64,/);
    expect(decodeDataUrl(png?.files['image.dat'])).toEqual(pngBytes);
    expect(decodeDataUrl(misleading?.files['samebinarybytesmisleading.txt'])).toEqual(
      arbitraryBytes
    );
    expect(invalidEntry).toBeNull();
  });

  it('rejects remote extensions when a declared file is missing', async () => {
    const responses = [new Response('export {};'), new Response(null, { status: 404 })];
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => responses.shift() ?? new Response(null))
    );

    const result = await extensionLoader.fetchExtensionCode({
      id: 'pyxis.binary-fixture',
      name: 'Binary fixture',
      version: '1.0.0',
      type: ExtensionType.UI,
      description: '',
      author: '',
      entry: 'index.js',
      files: ['missing.js'],
      metadata: { publishedAt: '', updatedAt: '' },
    });

    expect(result).toBeNull();
  });

  it('stores ZIP binary assets as exact MIME typed Blobs', async () => {
    vi.mocked(saveInstalledExtension).mockClear();
    const loadModule = vi.spyOn(extensionLoader, 'loadExtensionModule').mockResolvedValue({
      activate: async () => ({}),
    } satisfies ExtensionExports);
    const zip = new JSZip();
    zip.file(
      'manifest.json',
      JSON.stringify({
        id: 'pyxis.binary-fixture',
        name: 'Binary fixture',
        version: '1.0.0',
        type: 'ui',
        description: '',
        author: 'Pyxis',
        entry: 'index.js',
        files: ['image.dat', 'samebinarybytesmisleading.txt'],
        metadata: { publishedAt: '', updatedAt: '' },
      })
    );
    zip.file('index.js', 'export {};');
    zip.file('image.dat', pngBytes);
    zip.file('samebinarybytesmisleading.txt', arbitraryBytes);
    const archive = await zip.generateAsync({ type: 'blob' });

    const installed = await extensionManager.installExtensionFromZip(archive);
    const persisted = await loadInstalledExtension('pyxis.binary-fixture');

    expect(installed?.status).toBe(ExtensionStatus.ENABLED);
    expect(installed?.enabled).toBe(true);
    expect(persisted?.status).toBe(ExtensionStatus.ENABLED);
    expect(persisted?.enabled).toBe(true);
    expect(loadModule).toHaveBeenCalledOnce();
    expect(vi.mocked(loadInstalledExtension)).toHaveBeenCalledWith('pyxis.binary-fixture');
    const files = persisted?.cache.files;
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

  it('rejects invalid ZIP metadata before saving', async () => {
    vi.mocked(saveInstalledExtension).mockClear();
    const zip = new JSZip();
    zip.file(
      'manifest.json',
      JSON.stringify({
        id: 'pyxis.binary-fixture',
        name: 'Binary fixture',
        version: '',
        type: 'ui',
        description: '',
        author: 'Pyxis',
        entry: 'index.js',
        files: 'asset.js',
        metadata: { publishedAt: '', updatedAt: '' },
      })
    );
    zip.file('index.js', 'export {};');

    const installed = await extensionManager.installExtensionFromZip(
      await zip.generateAsync({ type: 'blob' })
    );
    expect(installed).toBeNull();
    expect(saveInstalledExtension).not.toHaveBeenCalled();
  });

  it('rejects ZIPs with any missing declared asset before saving', async () => {
    vi.mocked(saveInstalledExtension).mockClear();
    const zip = new JSZip();
    zip.file(
      'manifest.json',
      JSON.stringify({
        id: 'pyxis.binary-fixture',
        name: 'Binary fixture',
        version: '1.0.0',
        type: 'ui',
        description: '',
        author: 'Pyxis',
        entry: 'index.js',
        files: ['present.js', 'missing.js'],
        metadata: { publishedAt: '', updatedAt: '' },
      })
    );
    zip.file('index.js', 'export {};');
    zip.file('present.js', 'export {};');

    const installed = await extensionManager.installExtensionFromZip(
      await zip.generateAsync({ type: 'blob' })
    );
    expect(installed).toBeNull();
    expect(saveInstalledExtension).not.toHaveBeenCalled();
  });
});

function decodeDataUrl(value: string | undefined): Uint8Array {
  if (!value) throw new Error('Expected a binary asset data URL.');
  const separator = value.indexOf(',');
  if (separator < 0) throw new Error('Invalid binary asset data URL.');
  const binary = atob(value.slice(separator + 1));
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}
