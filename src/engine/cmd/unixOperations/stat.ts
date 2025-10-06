import { UnixCommandBase } from './base';

import type { ProjectFile } from '@/types';

export class StatCommand extends UnixCommandBase {
  async execute(args: string[]): Promise<string> {
    const { positional } = this.parseOptions(args);
    if (positional.length === 0) {
      throw new Error('stat: missing file operand');
    }

    const fileArg = positional[0];
    const resolved = this.resolvePath(fileArg);
    const path = this.normalizePath(resolved);

    // 1) Try to get metadata from IndexedDB via fileRepository
    try {
      const { fileRepository } = await import('@/engine/core/fileRepository');
      // fileRepository stores paths as project-relative (starting with /)
      // getProjectFiles is used via helper methods in base, but we can use getFileFromDB-like logic
      const relative = this.getRelativePathFromProject(path);

      // If root or empty, return directory metadata
      if (relative === '/' || relative === '') {
        return `  File: ${fileArg}\n  Size: -\n  Modified: -\n  Type: directory`;
      }

      const files: ProjectFile[] = await fileRepository.getProjectFiles(this.projectId);
      const found = files.find(f => f.path === relative);

      if (found) {
        const size = found.isBufferArray
          ? found.bufferContent
            ? (found.bufferContent as ArrayBuffer).byteLength
            : 0
          : typeof found.content === 'string'
            ? Buffer.byteLength(found.content, 'utf8')
            : 0;

        const mtime = found.updatedAt ? new Date(found.updatedAt).toISOString() : 'unknown';
        const type = found.type === 'folder' ? 'directory' : 'file';

        return `  File: ${fileArg}\n  Size: ${size}\n  Modified: ${mtime}\n  Type: ${type}`;
      }
    } catch (err) {
      // Continue to fallback
      // console.warn('[StatCommand] fileRepository lookup failed:', err);
    }
    // 3) Final: check existence in DB (directories may not be listed explicitly)
    const exists = await this.exists(path);
    if (!exists) throw new Error(`stat: cannot stat '${fileArg}': No such file or directory`);

    // If exists but metadata unknown
    return `  File: ${fileArg}\n  Size: unknown\n  Modified: unknown\n  Type: file`;
  }
}
