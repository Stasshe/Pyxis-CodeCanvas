import type { VirtualMount } from './types';

interface MountEntry {
  prefix: string;
  mount: VirtualMount;
}

export class MountRouter {
  private mounts: MountEntry[];

  constructor(
    mounts: MountEntry[],
    private readonly fallback: VirtualMount
  ) {
    this.mounts = [...mounts].sort((a, b) => b.prefix.length - a.prefix.length);
  }

  resolve(path: string): VirtualMount {
    for (const { prefix, mount } of this.mounts) {
      if (path === prefix || path.startsWith(`${prefix}/`)) return mount;
    }
    return this.fallback;
  }
}
