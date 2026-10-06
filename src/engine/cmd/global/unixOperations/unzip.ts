import JSZip from 'jszip';
import { fsClient, isPathWithin, normalizePath, resolvePath } from '@/engine/core/fs';
import { parseWithGetOpt } from '../../lib';
import { UnixCommandBase } from './base';

export class UnzipCommand extends UnixCommandBase {
  async execute(args: string[]): Promise<string> {
    const { flags, positional, errors } = parseWithGetOpt(args, '', ['help']);
    if (errors.length) throw new Error(errors.join('; '));
    if (flags.has('-h') || flags.has('--help')) {
      return 'Usage: unzip ARCHIVE.zip [DEST_DIR]\nExtract files from a ZIP archive.';
    }
    const archive = positional[0];
    if (!archive) throw new Error('unzip: missing archive operand');
    const destination = resolvePath(this.currentDir, positional[1] || '.');
    return this.extract(archive, destination);
  }

  async extract(
    zipFileName: string,
    destDir: string,
    bufferContent?: ArrayBuffer
  ): Promise<string> {
    const destination = normalizePath(destDir);
    const archivePath = resolvePath(this.currentDir, zipFileName);
    try {
      const bytes = bufferContent
        ? new Uint8Array(bufferContent)
        : await fsClient.readFile(archivePath);
      const zip = await JSZip.loadAsync(bytes);
      const entries = Object.values(zip.files);
      const targets = entries.map(file => {
        const entryName = file.unsafeOriginalName || file.name;
        if (!entryName || entryName.startsWith('/'))
          throw new Error(`Invalid archive path: ${entryName}`);
        const target = resolvePath(destination, entryName);
        if (!isPathWithin(target, destination))
          throw new Error(`Path escapes destination: ${entryName}`);
        return { file, target };
      });

      let count = 0;
      for (const { file, target } of targets) {
        if (file.dir) {
          await fsClient.mkdir(target, { recursive: true });
        } else {
          const parent = target.slice(0, target.lastIndexOf('/')) || '/';
          await fsClient.mkdir(parent, { recursive: true });
          await fsClient.writeFile(target, await file.async('uint8array'));
        }
        count++;
      }
      return `Unzipped ${count} file(s) to ${destination}`;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`unzip: ${zipFileName}: ${message}`);
    }
  }
}
