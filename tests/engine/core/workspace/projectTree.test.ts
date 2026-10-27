import { describe, expect, it, vi } from 'vitest';
import type { FsChangeEvent } from '@/engine/core/fs/index';
import { ProjectTree } from '@/engine/core/workspace/projectTree';
import type { ProjectFile } from '@/types/index';

function file(path: string, type: ProjectFile['type'] = 'file'): ProjectFile {
  return { path, type, size: 12, mtime: 123 };
}

function deferred<Value>() {
  let finish: (value: Value) => void = () => {
    throw new Error('Promise is not initialized.');
  };
  const promise = new Promise<Value>(resolve => {
    finish = resolve;
  });
  return { promise, finish };
}

function paths(tree: ProjectTree): string[] {
  return tree
    .snapshot()
    .map(entry => entry.path)
    .sort();
}

function create(entry: ProjectFile): FsChangeEvent {
  return { type: 'create', path: entry.path, file: entry };
}

function rename(oldPath: string, entry: ProjectFile): FsChangeEvent {
  return { type: 'rename', oldPath, path: entry.path, file: entry };
}

describe('ProjectTree event projection', () => {
  it('projects npm-style creates and symlinks without any automatic walk', async () => {
    const walk = vi.fn().mockResolvedValue([]);
    const tree = new ProjectTree({ walk });
    await tree.load('/repo');
    for (let index = 0; index < 100; index += 1) {
      const root = `/repo/node_modules/package-${index}`;
      await tree.change(create(file(root, 'folder')));
      await tree.change(create(file(`${root}/index.js`)));
    }
    const link = file('/repo/node_modules/.bin/tool', 'symlink');
    await tree.change(create(link));
    expect(tree.snapshot()).toHaveLength(201);
    expect(tree.snapshot()).toContainEqual(link);
    expect(walk).toHaveBeenCalledTimes(1);
    expect(
      await tree.change({ type: 'update', path: link.path, file: { ...link, mtime: 456 } })
    ).toBe(false);
    expect(tree.snapshot()).toContainEqual({ ...link, mtime: 456 });
  });

  it('deletes prefixes and renames known subtrees within and out of the root without reads', async () => {
    const walk = vi
      .fn()
      .mockResolvedValue([
        file('/repo/src', 'folder'),
        file('/repo/src/nested', 'folder'),
        file('/repo/src/nested/a.ts'),
        file('/repo/src-other.ts'),
        file('/repo/link', 'symlink'),
      ]);
    const tree = new ProjectTree({ walk });
    await tree.load('/repo');
    await tree.change(rename('/repo/src', file('/repo/lib', 'folder')));
    expect(paths(tree)).toContain('/repo/lib/nested/a.ts');
    await tree.change({ type: 'delete', path: '/repo/lib/nested' });
    expect(paths(tree)).toEqual(['/repo/lib', '/repo/link', '/repo/src-other.ts']);
    await tree.change(rename('/repo/lib', file('/elsewhere/lib', 'folder')));
    await tree.change(rename('/elsewhere/link', file('/repo/incoming-link', 'symlink')));
    expect(paths(tree)).toEqual(['/repo/incoming-link', '/repo/link', '/repo/src-other.ts']);
    expect(walk).toHaveBeenCalledTimes(1);
    expect(await tree.change(create(file('/repos/outside.ts')))).toBe(false);
  });

  it('reads only an incoming folder and replays later mutations over its snapshot', async () => {
    const pending = deferred<ProjectFile[]>();
    const walk = vi
      .fn<(path: string) => Promise<ProjectFile[]>>()
      .mockResolvedValueOnce([])
      .mockReturnValueOnce(pending.promise);
    const tree = new ProjectTree({ walk });
    await tree.load('/repo');
    const moving = tree.change(rename('/outside/src', file('/repo/src', 'folder')));
    await tree.change({ type: 'delete', path: '/repo/src/removed.ts' });
    await tree.change(create(file('/repo/src/added.ts')));
    await tree.change(rename('/repo/src/old.ts', file('/repo/src/new.ts')));
    pending.finish([file('/repo/src/removed.ts'), file('/repo/src/old.ts')]);
    await moving;
    expect(paths(tree)).toEqual(['/repo/src', '/repo/src/added.ts', '/repo/src/new.ts']);
    expect(walk.mock.calls.map(call => call[0])).toEqual(['/repo', '/repo/src']);
  });

  it('restores a completed nested incoming folder after an older parent snapshot arrives', async () => {
    const parentRead = deferred<ProjectFile[]>();
    const nestedFiles = [file('/repo/src/nested/child.ts')];
    const walk = vi
      .fn<(path: string) => Promise<ProjectFile[]>>()
      .mockResolvedValueOnce([])
      .mockReturnValueOnce(parentRead.promise)
      .mockResolvedValue(nestedFiles);
    const tree = new ProjectTree({ walk });
    await tree.load('/repo');
    const parent = tree.change(rename('/outside/src', file('/repo/src', 'folder')));
    await tree.change(rename('/outside/nested', file('/repo/src/nested', 'folder')));
    expect(paths(tree)).toContain('/repo/src/nested/child.ts');
    parentRead.finish([file('/repo/src/original.ts')]);
    await parent;
    expect(paths(tree)).toEqual([
      '/repo/src',
      '/repo/src/nested',
      '/repo/src/nested/child.ts',
      '/repo/src/original.ts',
    ]);
    expect(walk.mock.calls.map(call => call[0])).toEqual([
      '/repo',
      '/repo/src',
      '/repo/src/nested',
      '/repo/src/nested',
    ]);
  });

  it('follows a nested incoming folder rename while replaying an older parent snapshot', async () => {
    const parentRead = deferred<ProjectFile[]>();
    const walk = vi
      .fn<(path: string) => Promise<ProjectFile[]>>()
      .mockResolvedValueOnce([])
      .mockReturnValueOnce(parentRead.promise)
      .mockResolvedValueOnce([file('/repo/src/a/child.ts')])
      .mockResolvedValueOnce([file('/repo/src/b/child.ts')]);
    const tree = new ProjectTree({ walk });
    await tree.load('/repo');
    const parent = tree.change(rename('/outside/src', file('/repo/src', 'folder')));
    await tree.change(rename('/outside/a', file('/repo/src/a', 'folder')));
    await tree.change(rename('/repo/src/a', file('/repo/src/b', 'folder')));
    parentRead.finish([file('/repo/src/original.ts')]);
    await parent;
    expect(paths(tree)).toEqual([
      '/repo/src',
      '/repo/src/b',
      '/repo/src/b/child.ts',
      '/repo/src/original.ts',
    ]);
    expect(walk.mock.calls.map(call => call[0])).toEqual([
      '/repo',
      '/repo/src',
      '/repo/src/a',
      '/repo/src/b',
    ]);
  });

  it('keeps a renamed incoming subtree while its old scoped read is pending', async () => {
    const oldRead = deferred<ProjectFile[]>();
    const newRead = deferred<ProjectFile[]>();
    const walk = vi
      .fn<(path: string) => Promise<ProjectFile[]>>()
      .mockResolvedValueOnce([])
      .mockReturnValueOnce(oldRead.promise)
      .mockReturnValueOnce(newRead.promise);
    const tree = new ProjectTree({ walk });
    await tree.load('/repo');
    const incoming = tree.change(rename('/outside/src', file('/repo/src', 'folder')));
    const moved = tree.change(rename('/repo/src', file('/repo/lib', 'folder')));
    oldRead.finish([file('/repo/src/old.ts')]);
    newRead.finish([file('/repo/lib/current.ts')]);
    await Promise.all([incoming, moved]);
    expect(paths(tree)).toEqual(['/repo/lib', '/repo/lib/current.ts']);
    expect(walk.mock.calls.map(call => call[0])).toEqual(['/repo', '/repo/src', '/repo/lib']);
  });

  it('journals changes during the initial root read', async () => {
    const pending = deferred<ProjectFile[]>();
    const walk = vi.fn().mockReturnValue(pending.promise);
    const tree = new ProjectTree({ walk });
    const loading = tree.load('/repo');
    await tree.change(create(file('/repo/added.ts')));
    await tree.change({ type: 'delete', path: '/repo/removed.ts' });
    await tree.change(rename('/repo/old.ts', file('/repo/new.ts')));
    pending.finish([file('/repo/removed.ts'), file('/repo/old.ts')]);
    expect(await loading).toBe(true);
    expect(paths(tree)).toEqual(['/repo/added.ts', '/repo/new.ts']);
    expect(walk).toHaveBeenCalledTimes(1);
  });

  it('follows an incoming folder rename during the initial root read', async () => {
    const initialRead = deferred<ProjectFile[]>();
    const walk = vi
      .fn<(path: string) => Promise<ProjectFile[]>>()
      .mockReturnValueOnce(initialRead.promise)
      .mockResolvedValueOnce([file('/repo/b/child.ts')]);
    const tree = new ProjectTree({ walk });
    const loading = tree.load('/repo');
    await tree.change(rename('/outside/a', file('/repo/a', 'folder')));
    await tree.change(rename('/repo/a', file('/repo/b', 'folder')));
    initialRead.finish([file('/repo/b', 'folder'), file('/repo/b/child.ts')]);
    expect(await loading).toBe(true);
    expect(paths(tree)).toEqual(['/repo/b', '/repo/b/child.ts']);
    expect(walk.mock.calls.map(call => call[0])).toEqual(['/repo', '/repo/b']);
  });

  it('discards stale root and scoped reads after switching roots or closing', async () => {
    const staleRoot = deferred<ProjectFile[]>();
    const staleFolder = deferred<ProjectFile[]>();
    const walk = vi
      .fn<(path: string) => Promise<ProjectFile[]>>()
      .mockReturnValueOnce(staleRoot.promise)
      .mockResolvedValueOnce([file('/next/current.ts')])
      .mockReturnValueOnce(staleFolder.promise)
      .mockResolvedValueOnce([file('/final/current.ts')]);
    const tree = new ProjectTree({ walk });
    const first = tree.load('/repo');
    await tree.load('/next');
    staleRoot.finish([file('/repo/stale.ts')]);
    expect(await first).toBe(false);
    const incoming = tree.change(rename('/outside/src', file('/next/src', 'folder')));
    await tree.load('/final');
    staleFolder.finish([file('/next/src/stale.ts')]);
    expect(await incoming).toBe(false);
    expect(paths(tree)).toEqual(['/final/current.ts']);
    tree.close();
    expect(await tree.change(create(file('/final/closed.ts')))).toBe(false);
    expect(tree.snapshot()).toEqual([]);
  });

  it('preserves the active tree when a new root read fails', async () => {
    const walk = vi
      .fn()
      .mockResolvedValueOnce([file('/repo/current.ts')])
      .mockRejectedValueOnce(new Error('read failed'));
    const tree = new ProjectTree({ walk });
    await tree.load('/repo');
    await expect(tree.load('/next')).rejects.toThrow('read failed');
    await tree.change(create(file('/repo/later.ts')));
    expect(paths(tree)).toEqual(['/repo/current.ts', '/repo/later.ts']);
  });
});
