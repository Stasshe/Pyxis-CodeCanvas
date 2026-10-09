import JSZip from 'jszip';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { fsClient } from '@/engine/core/fs/index';
import { exportFolderZip } from '@/engine/ide/importExport/exportFolderZip';
import { downloadWorkspaceZip } from '@/engine/ide/importExport/exportRepo';

vi.mock('@/engine/core/fs/index', async importOriginal => {
  const original = await importOriginal<typeof import('@/engine/core/fs/index')>();
  return {
    ...original,
    fsClient: {
      walk: vi.fn(),
      readFile: vi.fn(),
      stat: vi.fn(),
    },
  };
});

describe('exportFolderZip', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('preserves the exact bytes from a non-zero-offset view in the archive', async () => {
    const payload = Uint8Array.from({ length: 256 }, (_, index) => index);
    const backing = new Uint8Array(payload.byteLength + 2);
    backing.set(payload, 1);
    const view = backing.subarray(1, backing.byteLength - 1);
    const file = {
      path: '/workspace/assets/raw.bin',
      type: 'file' as const,
      size: payload.byteLength,
      mtime: 1,
    };
    vi.mocked(fsClient.walk).mockResolvedValue([file]);
    vi.mocked(fsClient.readFile).mockResolvedValue(view);

    const archiveBlobs: Blob[] = [];
    const anchor = { href: '', download: '', click: vi.fn() };
    vi.stubGlobal('URL', {
      createObjectURL: (blob: Blob) => {
        archiveBlobs.push(blob);
        return 'blob:archive';
      },
      revokeObjectURL: vi.fn(),
    });
    vi.stubGlobal('document', {
      createElement: () => anchor,
      body: { appendChild: vi.fn(), removeChild: vi.fn() },
    });

    await exportFolderZip('/workspace');
    await new Promise(resolve => setTimeout(resolve, 1050));

    const archiveBlob = archiveBlobs[0];
    if (!archiveBlob) throw new Error('The export did not create an archive blob.');
    const archive = await JSZip.loadAsync(await archiveBlob.arrayBuffer());
    const archivedBytes = await archive.file('workspace/assets/raw.bin')?.async('uint8array');
    expect(archivedBytes).toEqual(payload);
    expect(anchor.download).toBe('workspace.zip');
    expect(anchor.click).toHaveBeenCalledOnce();
  });

  it('rejects a FIFO before reading it into a folder archive', async () => {
    vi.mocked(fsClient.walk).mockResolvedValue([
      { path: '/workspace/pipe', type: 'fifo', size: 0, mtime: 0 },
    ]);
    vi.mocked(fsClient.readFile).mockClear();

    await expect(exportFolderZip('/workspace')).rejects.toThrow(
      'Cannot export fifo entry: /workspace/pipe'
    );
    expect(fsClient.readFile).not.toHaveBeenCalled();
  });

  it('keeps binary files and applies the workspace .git exclusion', async () => {
    const payload = Uint8Array.from({ length: 256 }, (_, index) => index);
    const visibleFile = {
      path: '/workspace/assets/raw.bin',
      type: 'file' as const,
      size: payload.byteLength,
      mtime: 1,
    };
    const gitFile = {
      path: '/workspace/.git/config',
      type: 'fifo' as const,
      size: 0,
      mtime: 1,
    };
    vi.mocked(fsClient.walk).mockResolvedValue([visibleFile, gitFile]);
    vi.mocked(fsClient.readFile).mockImplementation(async path => {
      if (path === visibleFile.path) return payload;
      return new TextEncoder().encode('git');
    });

    const archiveBlobs: Blob[] = [];
    const anchor = { href: '', download: '', click: vi.fn() };
    vi.stubGlobal('URL', {
      createObjectURL: (blob: Blob) => {
        archiveBlobs.push(blob);
        return 'blob:archive';
      },
      revokeObjectURL: vi.fn(),
    });
    vi.stubGlobal('document', {
      createElement: () => anchor,
      body: { appendChild: vi.fn(), removeChild: vi.fn() },
    });

    await downloadWorkspaceZip({
      currentProject: { rootPath: '/workspace', name: 'workspace', updatedAt: new Date(0) },
    });
    await new Promise(resolve => setTimeout(resolve, 1050));

    const archiveBlob = archiveBlobs[0];
    if (!archiveBlob) throw new Error('The workspace export did not create an archive blob.');
    const archive = await JSZip.loadAsync(await archiveBlob.arrayBuffer());
    const archivedBytes = await archive.file('workspace/assets/raw.bin')?.async('uint8array');
    expect(archivedBytes).toEqual(payload);
    expect(archive.file('workspace/.git/config')).toBeNull();
    expect(anchor.download).toBe('workspace_export.zip');
    expect(anchor.click).toHaveBeenCalledOnce();
  });

  it('rejects a symlink to a character device before reading it into a workspace archive', async () => {
    const link = {
      path: '/workspace/device-link',
      type: 'symlink' as const,
      size: 8,
      mtime: 1,
    };
    vi.mocked(fsClient.walk).mockResolvedValue([link]);
    vi.mocked(fsClient.stat).mockResolvedValue({
      ...link,
      type: 'characterDevice',
    });
    vi.mocked(fsClient.readFile).mockClear();

    await expect(
      downloadWorkspaceZip({
        currentProject: { rootPath: '/workspace', name: 'workspace', updatedAt: new Date(0) },
      })
    ).rejects.toThrow('Cannot export symlink to characterDevice entry: /workspace/device-link');
    expect(fsClient.readFile).not.toHaveBeenCalled();
  });
});
