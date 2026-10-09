import { describe, expect, it } from 'vitest';
import { createWorkspace, ensureDemoWorkspace } from '@/engine/core/fs/workspace';
import { HOME_DIR } from '@/engine/core/pathUtils';
import type { InitialFileTree } from '@/engine/initialFileContents';
import { initialFileContents } from '@/engine/initialFileContents';
import type { ProjectFile } from '@/types';

function memoryWorkspaceFs() {
  const directories = new Set(['/', '/home', HOME_DIR]);
  const files = new Map<string, string>();
  return {
    directories,
    files,
    async exists(path: string) {
      return directories.has(path) || files.has(path);
    },
    async stat(path: string): Promise<ProjectFile> {
      if (directories.has(path)) return { path, type: 'folder', size: 0, mtime: 0 };
      const content = files.get(path);
      if (content === undefined) throw new Error(`Missing file: ${path}`);
      return { path, type: 'file', size: new TextEncoder().encode(content).length, mtime: 0 };
    },
    async mkdir(path: string) {
      if (directories.has(path) || files.has(path)) {
        throw Object.assign(new Error(`EEXIST: ${path}`), { code: 'EEXIST' });
      }
      const parentPath = path.slice(0, path.lastIndexOf('/')) || '/';
      if (!directories.has(parentPath)) throw new Error(`Missing parent: ${parentPath}`);
      directories.add(path);
    },
    async writeFile(path: string, content: string | Uint8Array) {
      const parentPath = path.slice(0, path.lastIndexOf('/')) || '/';
      if (!directories.has(parentPath)) throw new Error(`Missing parent: ${parentPath}`);
      if (files.has(path)) throw new Error(`Already exists: ${path}`);
      if (typeof content === 'string') {
        files.set(path, content);
        return;
      }
      files.set(path, new TextDecoder().decode(content));
    },
  };
}

function collectTemplate(
  tree: InitialFileTree,
  rootPath: string,
  directories: string[],
  files: Map<string, string>
): void {
  for (const [name, entry] of Object.entries(tree)) {
    const path = `${rootPath}/${name}`;
    if (entry.type === 'file') {
      files.set(path, entry.content);
      continue;
    }
    directories.push(path);
    collectTemplate(entry.children, path, directories, files);
  }
}

describe('workspace creation', () => {
  it('creates an empty workspace under HOME', async () => {
    const fs = memoryWorkspaceFs();
    const rootPath = await createWorkspace(fs, 'sample');

    expect(rootPath).toBe(`${HOME_DIR}/sample`);
    expect([...fs.directories]).toEqual(['/', '/home', HOME_DIR, rootPath]);
    expect(fs.files.size).toBe(0);
  });

  it.each(['', '.', '..', 'nested/workspace'])('rejects invalid name %j', async name => {
    const fs = memoryWorkspaceFs();
    await expect(createWorkspace(fs, name)).rejects.toThrow('Invalid workspace name');
    expect([...fs.directories]).toEqual(['/', '/home', HOME_DIR]);
  });

  it('seeds the complete nested template only into demo', async () => {
    const fs = memoryWorkspaceFs();
    const rootPath = await ensureDemoWorkspace(fs);
    const expectedDirectories = [rootPath];
    const expectedFiles = new Map<string, string>();
    collectTemplate(initialFileContents, rootPath, expectedDirectories, expectedFiles);

    expect(rootPath).toBe(`${HOME_DIR}/demo`);
    const createdDirectories = [...fs.directories].filter(
      path => path === rootPath || path.startsWith(`${rootPath}/`)
    );
    expect(createdDirectories.sort()).toEqual(expectedDirectories.sort());
    expect([...fs.files.entries()].sort()).toEqual([...expectedFiles.entries()].sort());
  });

  it('preserves edits and deletions on repeated startup without reseeding', async () => {
    const fs = memoryWorkspaceFs();
    const rootPath = await ensureDemoWorkspace(fs);
    fs.files.set(`${rootPath}/README.md`, 'edited content');
    fs.files.delete(`${rootPath}/.gitignore`);
    const expectedFiles = [...fs.files.entries()];

    expect(await ensureDemoWorkspace(fs)).toBe(rootPath);
    expect([...fs.files.entries()]).toEqual(expectedFiles);
  });

  it('preserves an existing empty demo folder', async () => {
    const fs = memoryWorkspaceFs();
    await fs.mkdir(`${HOME_DIR}/demo`);

    expect(await ensureDemoWorkspace(fs)).toBe(`${HOME_DIR}/demo`);
    expect(fs.files.size).toBe(0);
  });

  it('reports a demo file collision without replacing it', async () => {
    const fs = memoryWorkspaceFs();
    await fs.writeFile(`${HOME_DIR}/demo`, 'keep this file');

    await expect(ensureDemoWorkspace(fs)).rejects.toThrow('is an existing file');
    expect([...fs.files.entries()]).toEqual([[`${HOME_DIR}/demo`, 'keep this file']]);
    expect(fs.directories.has(`${HOME_DIR}/demo`)).toBe(false);
  });

  it('fails on an existing workspace without replacing its files', async () => {
    const fs = memoryWorkspaceFs();
    await fs.mkdir(`${HOME_DIR}/sample`);
    await fs.writeFile(`${HOME_DIR}/sample/README.md`, 'keep this');

    await expect(createWorkspace(fs, 'sample')).rejects.toMatchObject({ code: 'EEXIST' });
    expect(fs.files.get(`${HOME_DIR}/sample/README.md`)).toBe('keep this');
  });
});
