import { fileRepository } from '@/engine/core/fileRepository';
import { transformEsmToCjs } from '@/engine/runtime/transpiler/esmTransformer';

type FileOp = {
  path: string;
  type: 'file' | 'folder' | 'delete';
  content?: string;
};

export class BatchFileWriter {
  private projectId: string;
  private queue: FileOp[] = [];
  private active = false;

  constructor(projectId: string) {
    this.projectId = projectId;
  }

  get isBatchActive(): boolean {
    return this.active;
  }

  start(): void {
    this.active = true;
    this.queue = [];
  }

  async finish(): Promise<void> {
    if (!this.active) return;

    const BATCH_SIZE = 500;
    for (let i = 0; i < this.queue.length; i += BATCH_SIZE) {
      const batch = this.queue.slice(i, i + BATCH_SIZE);
      const filesToCreate = batch
        .filter(b => b.type === 'file')
        .map(b => ({ path: b.path, content: b.content || '', type: 'file' as const }));
      const deletes = batch.filter(b => b.type === 'delete').map(b => b.path);

      try {
        if (filesToCreate.length > 0) {
          await fileRepository.createFilesBulk(this.projectId, filesToCreate, true);
        }
        for (const delPath of deletes) {
          const normalized = delPath.replace(/\/+$/, '');
          const file = await fileRepository.getFileByPath(this.projectId, normalized);
          if (file) await fileRepository.deleteFile(file.id);
        }
      } catch (error) {
        console.warn('[BatchFileWriter] Batch failed:', error);
      }
    }

    this.active = false;
    this.queue = [];
  }

  async execute(path: string, type: 'file' | 'folder' | 'delete', content?: string): Promise<void> {
    let finalContent = content;
    if (type === 'file' && path.endsWith('.mjs') && content) {
      finalContent = await transformEsmToCjs(content, path);
    }

    if (this.active) {
      if (type === 'folder') {
        await fileRepository.createFile(this.projectId, path, '', 'folder');
      } else {
        this.queue.push({ path, type, content: finalContent });
      }
      return;
    }

    // 即時実行
    if (type === 'folder') {
      await fileRepository.createFile(this.projectId, path, '', 'folder');
    } else if (type === 'file') {
      await fileRepository.createFile(this.projectId, path, finalContent || '', 'file');
    } else {
      const normalized = path.replace(/\/+$/, '');
      const file = await fileRepository.getFileByPath(this.projectId, normalized);
      if (file) await fileRepository.deleteFile(file.id);
    }
  }

  enqueueFile(path: string, content: string): void {
    this.queue.push({ path, type: 'file', content });
  }
}
