import JSZip from 'jszip';
import { UnixCommandBase } from './base';
import { fileRepository } from '@/engine/core/fileRepository';

/**
 * zip - create zip archive (minimal)
 * Usage: zip archive.zip files...
 */
export class ZipCommand extends UnixCommandBase {
  async execute(args: string[] = []): Promise<string> {
    if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
      return `Usage: zip ARCHIVE.zip files...\nCreates or updates a zip archive containing the specified files`;
    }

    const archive = args[0];
    const files = args.slice(1);

    if (files.length === 0) throw new Error('zip: missing files to add');

    const zip = new JSZip();

    for (const name of files) {
      const resolved = this.normalizePath(this.resolvePath(name));
      const rel = this.getRelativePathFromProject(resolved);
      const f = await fileRepository.getFileByPath(this.projectId, rel);
      if (!f) throw new Error(`zip: ${name}: No such file or directory`);
      if (f.type === 'folder') {
        // Add folder entry
        zip.folder(name.replace(/^\//, ''));
      } else {
        if (f.isBufferArray && f.bufferContent) {
          zip.file(name.replace(/^\//, ''), f.bufferContent);
        } else {
          zip.file(name.replace(/^\//, ''), f.content || '');
        }
      }
    }

    const arrayBuffer = await zip.generateAsync({ type: 'arraybuffer' });
    await fileRepository.createFile(this.projectId, archive, '', 'file', true, arrayBuffer as ArrayBuffer);
    return `created ${archive}`;
  }
}
