import { afterEach, describe, expect, it } from 'vitest';
import { RUNTIME_CACHE_PATH } from '@/engine/core/fs/layout';
import { HOME_DIR, resolvePath } from '@/engine/core/pathUtils';
import { ModuleCache } from '@/engine/runtime/module/moduleCache';
import { ModuleFileSystem } from '@/engine/runtime/module/moduleFileSystem';
import { createNodeRuntimeFixture } from '../../_helpers/nodeRuntime';

describe('ModuleCache', () => {
  let fixture: Awaited<ReturnType<typeof createNodeRuntimeFixture>> | undefined;

  afterEach(() => {
    fixture?.close();
    fixture = undefined;
  });

  it('persists cache entries beneath the canonical runtime cache path', async () => {
    fixture = await createNodeRuntimeFixture();
    const fileSystem = new ModuleFileSystem(fixture.bridge);
    const firstCache = new ModuleCache(fileSystem);
    await firstCache.init();
    const modulePath = `${HOME_DIR}/workspace/module.mjs`;
    await firstCache.set(modulePath, {
      contentHash: 'content-version',
      code: 'module.exports = true;',
      deps: [],
    });

    const secondCache = new ModuleCache(fileSystem);
    await expect(secondCache.get(modulePath, 'content-version')).resolves.toEqual({
      contentHash: 'content-version',
      code: 'module.exports = true;',
      deps: [],
    });
    await expect(fileSystem.stat(RUNTIME_CACHE_PATH)).resolves.toMatchObject({ type: 'directory' });
    await expect(
      fileSystem.stat(resolvePath(RUNTIME_CACHE_PATH, 'modules'))
    ).resolves.toMatchObject({
      type: 'directory',
    });
    await expect(fileSystem.stat('/cache')).resolves.toBeNull();
  });
});
