import JSZip from 'jszip';
import { UnixCommandBase } from './base';
import { fileRepository } from '@/engine/core/fileRepository';

/**
 * unzip - ZIP アーカイブを展開してプロジェクトに登録
 * 使用法:
 *   unzip ARCHIVE.zip [DEST_DIR]
 */
export class UnzipCommand extends UnixCommandBase {
  async execute(args: string[]): Promise<string> {
    const archive = args[0];
    const dest = args[1] || '';
    return await this.extract(archive, dest);
  }

  async extract(zipFileName: string, destDir: string, bufferContent?: ArrayBuffer): Promise<string> {
    // mv等と同じパス解決ロジックに統一
    const destTarget = destDir && destDir !== '' ? destDir : '.';
    const normalizedDest = this.normalizePath(this.resolvePath(destTarget));

    try {
      let zipBuffer: ArrayBuffer | undefined = bufferContent;
      if (!zipBuffer) {
        // mv等と同じく、normalizePath→getRelativePathFromProjectの順でパス解決
        const normalizedArchivePath = this.normalizePath(this.resolvePath(zipFileName));
        const relPath = this.getRelativePathFromProject(normalizedArchivePath);
        const files = await fileRepository.getProjectFiles(this.projectId);
        const target = files.find(f => f.path === relPath);
        if (!target) {
          throw new Error(`archive not found: ${zipFileName}`);
        }
        if (target.isBufferArray && target.bufferContent) {
          zipBuffer = target.bufferContent as ArrayBuffer;
        } else if (target.content) {
          zipBuffer = new TextEncoder().encode(target.content).buffer;
        } else {
          throw new Error(`archive ${zipFileName} has no binary content`);
        }
      }

      const zip = await JSZip.loadAsync(zipBuffer as ArrayBuffer);
      let fileCount = 0;
      const entries: Array<any> = [];

      for (const relPath in zip.files) {
        const file = zip.files[relPath];

        if (!relPath || relPath === '/' || relPath.includes('../')) {
          continue;
        }

        const destPath = `${normalizedDest}/${relPath}`;
        const normalizedFilePath = this.normalizePath(destPath);
        const relativePath = this.getRelativePathFromProject(normalizedFilePath);

        if (file.dir || relPath.endsWith('/')) {
          entries.push({ path: relativePath, content: '', type: 'folder' });
        } else {
          const isLikelyText = /\.(txt|md|js|ts|jsx|tsx|json|html|css|py|sh|yml|yaml|xml|svg|csv)$/i.test(relPath);
          if (isLikelyText) {
            const text = await file.async('string');
            entries.push({ path: relativePath, content: text, type: 'file' });
          } else {
            const arrayBuffer = await file.async('arraybuffer');
            entries.push({ path: relativePath, content: '', type: 'file', isBufferArray: true, bufferContent: arrayBuffer });
          }
        }
        fileCount++;
      }

      if (entries.length > 0) {
        const bulkEntries = entries.map(e => ({
          path: e.path,
          content: e.content,
          type: e.type,
          isBufferArray: e.isBufferArray,
          bufferContent: e.bufferContent,
        }));

        await fileRepository.createFilesBulk(this.projectId, bulkEntries);
      }

      return `Unzipped ${fileCount} file(s) to ${normalizedDest}`;
    } catch (error) {
      throw new Error(`unzip: ${zipFileName}: ${(error as Error).message}`);
    }
  }
}
