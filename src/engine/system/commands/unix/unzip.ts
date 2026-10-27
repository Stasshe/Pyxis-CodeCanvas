import JSZip from 'jszip';
import { isPathWithin, normalizePath, resolvePath } from '@/engine/core/fs/index';
import { parseWithGetOpt } from '../../shell/lib/index';
import { UnixCommandBase } from './base';

export class UnzipCommand extends UnixCommandBase {
  async execute(args: string[], bufferContent?: ArrayBuffer): Promise<string> {
    const { flags, values, positional, errors } = parseWithGetOpt(args, 'd:', ['destdir=', 'help']);
    if (errors.length) throw new Error(errors.join('; '));
    if (flags.has('-h') || flags.has('--help')) {
      return 'Usage: unzip [-d DEST_DIR] ARCHIVE.zip\nExtract files from a ZIP archive.';
    }
    const archive = positional[0];
    if (!archive) throw new Error('unzip: missing archive operand');
    if (positional.length > 2) {
      throw new Error('unzip: member selection is not supported');
    }
    const destinationArg = values.get('-d') || values.get('--destdir') || positional[1] || '.';
    const destination = resolvePath(this.currentDir, destinationArg);
    return this.extract(archive, destination, bufferContent);
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
        : await this.fs.readFile(archivePath);
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
          await this.fs.mkdir(target, { recursive: true });
        } else {
          const parent = target.slice(0, target.lastIndexOf('/')) || '/';
          await this.fs.mkdir(parent, { recursive: true });
          await this.fs.writeFile(target, await file.async('uint8array'));
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
