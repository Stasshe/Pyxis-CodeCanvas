import { Buffer } from 'buffer';
import { beforeEach, describe, expect, it } from 'vitest';
import { fileRepository } from '@/engine/core/fileRepository';
import { createFSModule } from '@/engine/runtime/nodejs/modules/fsModule';
import { setupTestProject } from '../../_helpers/testProject';

describe('fsModule', () => {
  let projectId: string;
  let projectName: string;

  beforeEach(async () => {
    const ctx = await setupTestProject('FsModuleTest');
    projectId = ctx.projectId;
    projectName = ctx.projectName;
  });

  it('returns a Node-style ENOENT error for missing files', async () => {
    const fsModule = createFSModule({
      projectDir: `/projects/${projectName}`,
      projectId,
      projectName,
    });

    await expect(fsModule.readFile('/tmp/ionstore_tiny-updater.json')).rejects.toMatchObject({
      code: 'ENOENT',
      syscall: 'open',
      path: '/tmp/ionstore_tiny-updater.json',
    });
  });

  it('supports callback-style readFile without leaking a rejected promise', async () => {
    const fsModule = createFSModule({
      projectDir: `/projects/${projectName}`,
      projectId,
      projectName,
    });

    const result = await new Promise<{ err: any; data: any }>(resolve => {
      fsModule.readFile('/tmp/ionstore_tiny-updater.json', (err, data) => {
        resolve({ err, data });
      });
    });

    expect(result.data).toBeUndefined();
    expect(result.err).toMatchObject({
      code: 'ENOENT',
      syscall: 'open',
      path: '/tmp/ionstore_tiny-updater.json',
    });
  });

  it('returns a Node-style ENOENT error for missing stat targets', async () => {
    const fsModule = createFSModule({
      projectDir: `/projects/${projectName}`,
      projectId,
      projectName,
    });

    await expect(fsModule.stat('/tmp/.prettier-cache')).rejects.toMatchObject({
      code: 'ENOENT',
      syscall: 'stat',
      path: '/tmp/.prettier-cache',
    });
  });

  it('returns Buffer values unless a file encoding is requested', async () => {
    await fileRepository.createFile(projectId, '/buffer.txt', 'héllo', 'file');
    const fsModule = createFSModule({
      projectDir: `/projects/${projectName}`,
      projectId,
      projectName,
    });

    const asyncContent = await fsModule.readFile('/buffer.txt');
    const callbackContent = await new Promise<unknown>((resolve, reject) => {
      fsModule.readFile('/buffer.txt', null, (error, data) => {
        if (error) reject(error);
        else resolve(data);
      });
    });
    const promiseContent = await fsModule.promises.readFile('/buffer.txt');
    const syncContent = fsModule.readFileSync('/buffer.txt');

    for (const content of [asyncContent, callbackContent, promiseContent, syncContent]) {
      expect(Buffer.isBuffer(content)).toBe(true);
      expect((content as Buffer).toString()).toBe('héllo');
    }
    await expect(fsModule.readFile('/buffer.txt', 'base64')).resolves.toBe('aMOpbGxv');
    expect(fsModule.readFileSync('/buffer.txt', 'hex')).toBe('68c3a96c6c6f');
  });

  it('always returns SVG files as UTF-8 text', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"></svg>';
    await fileRepository.createFile(
      projectId,
      '/icon.svg',
      '',
      'file',
      true,
      new TextEncoder().encode(svg).buffer
    );
    const fsModule = createFSModule({
      projectDir: `/projects/${projectName}`,
      projectId,
      projectName,
    });
    await fsModule.preloadFiles([]);

    await expect(fsModule.readFile('/icon.svg')).resolves.toBe(svg);
    await expect(fsModule.readFile('/icon.svg', null)).resolves.toBe(svg);
    await expect(fsModule.readFile('/icon.svg', { encoding: 'buffer' })).resolves.toBe(svg);
    expect(fsModule.readFileSync('/icon.svg', 'base64')).toBe(svg);
  });

  it('returns Buffer names when readdir encoding is buffer', async () => {
    await fileRepository.createFile(projectId, '/listed.txt', 'content', 'file');
    const fsModule = createFSModule({
      projectDir: `/projects/${projectName}`,
      projectId,
      projectName,
    });

    const names = await fsModule.readdir('/', { encoding: 'buffer' });
    const dirents = await fsModule.readdir('/', { encoding: 'buffer', withFileTypes: true });

    expect(names.every((name: unknown) => Buffer.isBuffer(name))).toBe(true);
    expect(names.map((name: Buffer) => name.toString())).toContain('listed.txt');
    expect(dirents.every((dirent: { name: unknown }) => Buffer.isBuffer(dirent.name))).toBe(true);
  });
});
