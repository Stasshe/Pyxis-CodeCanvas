import { beforeEach, describe, expect, it } from 'vitest';
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
});
