import type { FsApi } from '@/engine/core/fs/types';

type FileOp = {
  path: string;
  type: 'file' | 'folder' | 'delete';
  content?: string | Uint8Array;
};

export class BatchFileWriter {
  private queue: FileOp[] = [];
  private active = false;

  constructor(private readonly fs: FsApi) {}

  get isBatchActive(): boolean {
    return this.active;
  }

  start(): void {
    this.active = true;
    this.queue = [];
  }

  async finish(): Promise<void> {
    if (!this.active) return;
    for (const operation of this.queue) await this.write(operation);
    this.active = false;
    this.queue = [];
  }

  async execute(path: string, type: FileOp['type'], content?: string | Uint8Array): Promise<void> {
    const operation = { path, type, content };
    if (this.active && type !== 'folder') {
      this.queue.push(operation);
      return;
    }
    await this.write(operation);
  }

  enqueueFile(path: string, content: string | Uint8Array): void {
    this.queue.push({ path, type: 'file', content });
  }

  private async write(operation: FileOp): Promise<void> {
    const path = operation.path;
    if (operation.type === 'folder') {
      await this.fs.mkdir(path, { recursive: true });
      return;
    }
    if (operation.type === 'delete') {
      await this.fs.rm(path, { recursive: true, force: true });
      return;
    }
    let content = operation.content;
    if (!content) content = '';
    await this.fs.writeFile(path, content);
  }
}
