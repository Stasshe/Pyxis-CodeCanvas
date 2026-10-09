import { type FsApi, type FsChangeEvent, isPathWithin } from '@/engine/core/fs/index';
import type { ProjectFile } from '@/types/index';

interface TreeState {
  rootPath: string;
  files: Map<string, ProjectFile>;
}

interface TreeRead {
  path: string;
  events: FsChangeEvent[];
}

interface SubtreeRead extends TreeRead {
  state: TreeState;
}

function touches(event: FsChangeEvent, rootPath: string): boolean {
  return (
    isPathWithin(event.path, rootPath) || !!(event.oldPath && isPathWithin(event.oldPath, rootPath))
  );
}

function removePrefix(files: Map<string, ProjectFile>, path: string): void {
  for (const candidate of files.keys()) {
    if (isPathWithin(candidate, path)) files.delete(candidate);
  }
}

/** Applies event metadata; only an incoming folder with unknown descendants needs a read. */
function applyEvent(state: TreeState, event: FsChangeEvent): string | undefined {
  const { files, rootPath } = state;
  if (event.type === 'delete') {
    removePrefix(files, event.path);
    return;
  }
  const file = event.file;
  if (!file) throw new Error(`Filesystem ${event.type} event has no metadata: ${event.path}`);
  let moved: ProjectFile[] = [];
  if (event.type === 'rename') {
    const oldPath = event.oldPath;
    if (!oldPath) throw new Error(`Filesystem rename event has no source: ${event.path}`);
    moved = Array.from(files.values()).filter(entry => isPathWithin(entry.path, oldPath));
    removePrefix(files, oldPath);
    if (moved.length > 0 && isPathWithin(event.path, rootPath)) {
      removePrefix(files, event.path);
      for (const entry of moved) {
        const path = event.path + entry.path.slice(oldPath.length);
        files.set(path, { ...entry, path });
      }
    }
  }
  if (!isPathWithin(event.path, rootPath) || event.path === rootPath) return;
  const alreadyKnown = files.has(event.path);
  files.set(event.path, file);
  if (event.type === 'rename' && file.type === 'folder' && !alreadyKnown && moved.length === 0) {
    return event.path;
  }
}

function replayEvents(state: TreeState, events: FsChangeEvent[]): Set<string> {
  const incomingPaths = new Set<string>();
  for (const event of events) {
    for (const path of Array.from(incomingPaths)) {
      if (event.type === 'delete' && isPathWithin(path, event.path)) incomingPaths.delete(path);
      if (event.type === 'rename' && event.oldPath && isPathWithin(path, event.oldPath)) {
        incomingPaths.delete(path);
        const movedPath = event.path + path.slice(event.oldPath.length);
        if (isPathWithin(movedPath, state.rootPath)) incomingPaths.add(movedPath);
      }
    }
    const incomingPath = applyEvent(state, event);
    if (incomingPath) incomingPaths.add(incomingPath);
  }
  return incomingPaths;
}

/** Projects ordered filesystem events without rereading an already known workspace. */
export class ProjectTree {
  private state: TreeState | null = null;
  private loading: TreeRead | null = null;
  private readonly subtreeReads = new Set<SubtreeRead>();

  constructor(private readonly fs: Pick<FsApi, 'walk'>) {}

  get rootPath(): string | undefined {
    return this.state?.rootPath;
  }

  snapshot(): ProjectFile[] {
    if (!this.state) return [];
    return Array.from(this.state.files.values());
  }

  async load(rootPath: string): Promise<boolean> {
    const read: TreeRead = { path: rootPath, events: [] };
    this.loading = read;
    try {
      const files = await this.fs.walk(rootPath);
      if (this.loading !== read) return false;
      const state: TreeState = { rootPath, files: new Map(files.map(file => [file.path, file])) };
      this.state = state;
      this.loading = null;
      const incomingPaths = replayEvents(state, read.events);
      for (const path of incomingPaths) {
        if (state.files.get(path)?.type === 'folder') await this.readSubtree(state, path);
        if (this.state !== state) return false;
      }
      return true;
    } finally {
      if (this.loading === read) this.loading = null;
    }
  }

  async change(event: FsChangeEvent): Promise<boolean> {
    if (this.loading && touches(event, this.loading.path)) this.loading.events.push(event);
    const state = this.state;
    if (!state || !touches(event, state.rootPath)) return false;
    let movingUnreadFolder = false;
    for (const read of this.subtreeReads) {
      if (read.state !== state) continue;
      if (touches(event, read.path)) read.events.push(event);
      if (event.type === 'rename' && event.oldPath && isPathWithin(read.path, event.oldPath)) {
        movingUnreadFolder = true;
      }
    }
    const incomingPath = applyEvent(state, event);
    if (incomingPath) await this.readSubtree(state, incomingPath);
    else if (
      movingUnreadFolder &&
      event.file?.type === 'folder' &&
      isPathWithin(event.path, state.rootPath)
    ) {
      await this.readSubtree(state, event.path);
    }
    return this.state === state && event.type !== 'update';
  }

  private async readSubtree(state: TreeState, path: string): Promise<void> {
    const read: SubtreeRead = { state, path, events: [] };
    this.subtreeReads.add(read);
    try {
      const files = await this.fs.walk(path);
      const folder = state.files.get(path);
      if (this.state !== state || folder?.type !== 'folder') return;
      removePrefix(state.files, path);
      // The rename event supplied the folder itself; walk returns only its descendants.
      state.files.set(path, folder);
      for (const file of files) state.files.set(file.path, file);
      const incomingPaths = replayEvents(state, read.events);
      for (const incomingPath of incomingPaths) {
        if (this.state !== state) return;
        if (state.files.get(incomingPath)?.type === 'folder')
          await this.readSubtree(state, incomingPath);
      }
    } catch (error) {
      if (this.state === state && state.files.has(path)) throw error;
    } finally {
      this.subtreeReads.delete(read);
    }
  }

  close(): void {
    this.state = null;
    this.loading = null;
  }
}
