import { UnixCommandBase } from './base';
import pako from 'pako';
import { fileRepository } from '@/engine/core/fileRepository';

/**
 * gzip - compress/decompress single files (minimal)
 * Usage: gzip [-d] file
 */
export class GzipCommand extends UnixCommandBase {
  async execute(args: string[] = []): Promise<string> {
    const flags = new Set(args.filter(a => a.startsWith('-')));
    const positional = args.filter(a => !a.startsWith('-'));

    if (args.includes('--help') || flags.has('-h')) {
      return `Usage: gzip [-d] FILE\n-d decompress`;
    }

    const decompress = flags.has('-d');
    if (positional.length === 0) throw new Error('gzip: missing file operand');

    const fileArg = positional[0];
    const resolved = this.normalizePath(this.resolvePath(fileArg));
    const rel = this.getRelativePathFromProject(resolved);
    const target = await fileRepository.getFileByPath(this.projectId, rel);
    if (!target) throw new Error(`gzip: ${fileArg}: No such file`);

    if (decompress) {
      if (this.terminalUI) await this.terminalUI.spinner.start('Decompressing gzip file...');
      try {
        if (!target.isBufferArray || !target.bufferContent) {
          throw new Error(`gzip: ${fileArg}: not in compressed format`);
        }
        const inBuf = new Uint8Array(target.bufferContent);
        const out = pako.ungzip(inBuf);
        // save as original name without .gz
        let outName = fileArg;
        if (outName.endsWith('.gz')) outName = outName.slice(0, -3);
        await fileRepository.createFile(this.projectId, outName, '', 'file', true, out.buffer as ArrayBuffer);
        if (this.terminalUI) await this.terminalUI.spinner.success('Decompression completed');
        return `decompressed: ${outName}`;
      } catch (err: any) {
        if (this.terminalUI) await this.terminalUI.spinner.error(`Decompression failed: ${err?.message || String(err)}`);
        throw err;
      }
    } else {
      // compress
      if (this.terminalUI) await this.terminalUI.spinner.start('Compressing file...');
      try {
        const contentArray = target.bufferContent ? new Uint8Array(target.bufferContent) : new TextEncoder().encode(target.content || '');
        const gz = pako.gzip(contentArray);
        const outName = fileArg.endsWith('.gz') ? fileArg : `${fileArg}.gz`;
        await fileRepository.createFile(this.projectId, outName, '', 'file', true, gz.buffer as ArrayBuffer);
        if (this.terminalUI) await this.terminalUI.spinner.success('Compression completed');
        return `created: ${outName}`;
      } catch (err: any) {
        if (this.terminalUI) await this.terminalUI.spinner.error(`Compression failed: ${err?.message || String(err)}`);
        throw err;
      }
    }
  }
}
