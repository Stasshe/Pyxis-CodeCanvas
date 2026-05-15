import { MemoryMount } from './MemoryMount';
import { MountRouter } from './MountRouter';
import { ProjectMount } from './ProjectMount';
import { RuntimeCacheMount } from './RuntimeCacheMount';

interface RuntimeStorageSet {
  tmpMount: MemoryMount;
  cacheMount: RuntimeCacheMount;
  projectMount: ProjectMount;
  mountRouter: MountRouter;
}

class RuntimeStorageRegistry {
  private storages = new Map<string, RuntimeStorageSet>();

  get(projectId: string, projectName: string): RuntimeStorageSet {
    const key = projectId || projectName || 'default';
    const existing = this.storages.get(key);
    if (existing) return existing;

    const tmpMount = new MemoryMount('/tmp');
    const cacheMount = new RuntimeCacheMount(projectId || key);
    const projectMount = new ProjectMount(projectId);
    const mountRouter = new MountRouter(
      [
        { prefix: '/tmp', mount: tmpMount },
        { prefix: '/cache', mount: cacheMount },
      ],
      projectMount
    );

    const storage = { tmpMount, cacheMount, projectMount, mountRouter };
    this.storages.set(key, storage);
    return storage;
  }

  clearTmp(projectId: string, projectName: string): void {
    this.get(projectId, projectName).tmpMount.clear();
  }

  async clearRuntimeCache(projectId: string, projectName: string): Promise<void> {
    await this.get(projectId, projectName).cacheMount.clear();
  }
}

export const runtimeStorageRegistry = new RuntimeStorageRegistry();
