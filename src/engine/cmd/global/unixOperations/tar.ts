import { fileRepository } from '@/engine/core/fileRepository';
import * as tar from 'tar-stream';
import { UnixCommandBase } from './base';

/**
 * tar - tar archive create/list/extract (minimal)
 * Usage: tar -c -f archive.tar files...
 *        tar -t -f archive.tar
 *        tar -x -f archive.tar
 */
export class TarCommand extends UnixCommandBase {
  async execute(args: string[] = []): Promise<string> {
    const flags = new Set(args.filter(a => a.startsWith('-')));
    const positional = args.filter(a => !a.startsWith('-'));

    if (args.includes('--help') || flags.has('-h')) {
      return `Usage: tar -c|-t|-x -f ARCHIVE [files...]\n-c create, -t list, -x extract, -f archive`;
    }

    const c = flags.has('-c');
    const t = flags.has('-t');
    const x = flags.has('-x');

    const fIndex = args.findIndex(a => a === '-f');
    let archive = '';
    if (fIndex !== -1) archive = args[fIndex + 1] || positional[0] || '';
    if (!archive) throw new Error('tar: -f ARCHIVE is required');

    if (c) {
      // create
      if (this.terminalUI) await this.terminalUI.spinner.start('Creating tar archive...');
      try {
        const files = positional.slice();
        // if -f present, remove archive name from positional
        if (files[0] === archive) files.shift();
        const pack = tar.pack();
        const chunks: Uint8Array[] = [];

        for (const name of files) {
          const resolved = this.normalizePath(this.resolvePath(name));
          const rel = this.getRelativePathFromProject(resolved);
          const file = await fileRepository.getFileByPath(this.projectId, rel);
          if (!file) throw new Error(`tar: ${name}: No such file or directory`);
          if (file.type === 'folder') {
            // create directory entry
            pack.entry({ name: name.replace(/^\//, '') + '/' }, '', () => {});
          } else {
            // Ensure we pass a Buffer (not Uint8Array) to tar-stream
            const contentBuf = file.bufferContent
              ? Buffer.from(file.bufferContent)
              : Buffer.from(file.content || '', 'utf8');
            pack.entry({ name: name.replace(/^\//, '') }, contentBuf, () => {});
          }
        }

        pack.finalize();

        // collect pack stream
        await new Promise<void>((resolve, reject) => {
          pack.on('data', (c: any) => chunks.push(Buffer.from(c)));
          pack.on('end', () => resolve());
          pack.on('error', (e: any) => reject(e));
        });

        const total = Buffer.concat(chunks);
        await fileRepository.createFile(
          this.projectId,
          archive,
          '',
          'file',
          true,
          total.buffer as ArrayBuffer
        );
        if (this.terminalUI) await this.terminalUI.spinner.success('Archive operation completed');
        return `Created ${archive}`;
      } catch (err: any) {
        if (this.terminalUI)
          await this.terminalUI.spinner.error(`Archive failed: ${err?.message || String(err)}`);
        throw err;
      }
    } else if (t) {
      // list
      const resolved = this.normalizePath(this.resolvePath(archive));
      const rel = this.getRelativePathFromProject(resolved);
      const file = await fileRepository.getFileByPath(this.projectId, rel);
      if (!file) throw new Error(`tar: ${archive}: No such file or directory`);
      const buf = file.bufferContent
        ? file.bufferContent
        : new TextEncoder().encode(file.content || '').buffer;

      const extract = tar.extract();
      const names: string[] = [];
      extract.on('entry', (header, stream, next) => {
        names.push(header.name);
        stream.on('end', () => next());
        stream.resume();
      });

      await new Promise<void>((resolve, reject) => {
        extract.on('finish', () => resolve());
        extract.on('error', (e: any) => reject(e));
        extract.end(Buffer.from(buf));
      });

      return names.join('\n');
    } else if (x) {
      // extract
      const dest = '.';
      if (this.terminalUI) await this.terminalUI.spinner.start('Extracting tar archive...');
      try {
        const resolved = this.normalizePath(this.resolvePath(archive));
        const rel = this.getRelativePathFromProject(resolved);
        const file = await fileRepository.getFileByPath(this.projectId, rel);
        if (!file) throw new Error(`tar: ${archive}: No such file or directory`);
        const buf = file.bufferContent
          ? file.bufferContent
          : new TextEncoder().encode(file.content || '').buffer;

        const extract = tar.extract();
        const entries: any[] = [];

        extract.on('entry', (header, stream, next) => {
          // remove trailing slash if present
          const name = header.name.replace(/\/$/, '');
          if (header.type === 'directory' || header.name.endsWith('/')) {
            entries.push({ path: `/${name}`, content: '', type: 'folder' });
            stream.resume();
            next();
            return;
          }
          const chunks: Uint8Array[] = [];
          stream.on('data', (c: any) => chunks.push(Buffer.from(c)));
          stream.on('end', () => {
            const buf = Buffer.concat(chunks);
            entries.push({
              path: `/${name}`,
              content: '',
              type: 'file',
              isBufferArray: true,
              bufferContent: buf.buffer as ArrayBuffer,
            });
            next();
          });
        });

        await new Promise<void>((resolve, reject) => {
          extract.on('finish', () => resolve());
          extract.on('error', (e: any) => reject(e));
          extract.end(Buffer.from(buf));
        });

        if (entries.length > 0) {
          await fileRepository.createFilesBulk(this.projectId, entries);
        }

        if (this.terminalUI) await this.terminalUI.spinner.success('Archive operation completed');
        return `Extracted ${entries.length} entries to ${dest}`;
      } catch (err: any) {
        if (this.terminalUI)
          await this.terminalUI.spinner.error(`Archive failed: ${err?.message || String(err)}`);
        throw err;
      }
    }

    throw new Error('tar: invalid option. Use -c, -t or -x with -f ARCHIVE');
  }
}
