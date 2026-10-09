import type { FsCore } from '@/engine/core/fs/core';
import type { RuntimeExecutionOptions } from '@/engine/system/runtime/core/RuntimeProvider';
import { MemoryFs } from './memoryFs';
import { createNodeRuntimeFixture, type NodeRuntimeFixture } from './nodeRuntime';

export async function loadNpmRuntimeFs(repo: FsCore, rootPath: string): Promise<MemoryFs> {
  const fs = new MemoryFs();
  await fs.mkdir(rootPath, { recursive: true });
  for (const entry of await repo.walk(rootPath)) {
    if (entry.type === 'folder') {
      await fs.mkdir(entry.path, { recursive: true });
    } else if (entry.type === 'symlink') {
      await fs.symlink(await repo.readlink(entry.path), entry.path);
    } else {
      await fs.writeFile(entry.path, await repo.readFile(entry.path));
    }
  }
  return fs;
}

export async function createNpmRuntimeFixture(
  repo: FsCore,
  rootPath: string,
  debugConsole?: RuntimeExecutionOptions['debugConsole'],
  cwd = rootPath
): Promise<NodeRuntimeFixture> {
  const fs = await loadNpmRuntimeFs(repo, rootPath);
  return createNodeRuntimeFixture(rootPath, debugConsole, cwd, undefined, fs);
}
