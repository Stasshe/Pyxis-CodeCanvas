import { isPathWithin, posixPath, resolvePath } from '@/engine/core/fs/index';
import { parseWithGetOpt } from '../../shell/lib/index';
import { UnixCommandBase } from './base';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export class TarCommand extends UnixCommandBase {
  async execute(args: string[] = []): Promise<string> {
    const { flags, values, positional, errors } = parseWithGetOpt(args, 'cxtvf:h', [
      'create',
      'extract',
      'list',
      'verbose',
      'file=',
      'help',
    ]);
    if (errors.length) throw new Error(errors.join('; '));
    if (flags.has('-h') || flags.has('--help')) return 'Usage: tar -c|-t|-x -f ARCHIVE [FILE...]';
    const modes = [
      flags.has('-c') || flags.has('--create'),
      flags.has('-t') || flags.has('--list'),
      flags.has('-x') || flags.has('--extract'),
    ];
    if (modes.filter(Boolean).length !== 1)
      throw new Error('tar: specify exactly one of -c, -t, or -x');
    const archiveName = values.get('-f') || values.get('--file');
    if (!archiveName) throw new Error('tar: Option -f is required');
    if (modes[0]) return this.createArchive(archiveName, positional);
    if (modes[1]) return this.listArchive(archiveName);
    return this.extractArchive(archiveName);
  }

  private header(name: string, size: number, directory: boolean): Uint8Array {
    const bytes = new Uint8Array(512);
    const string = (value: string, start: number, length: number) =>
      bytes.set(encoder.encode(value).subarray(0, length), start);
    const octal = (value: number, start: number, length: number) =>
      string(`${value.toString(8).padStart(length - 1, '0')}\0`, start, length);
    string(name, 0, 100);
    octal(directory ? 0o755 : 0o644, 100, 8);
    octal(0, 108, 8);
    octal(0, 116, 8);
    octal(size, 124, 12);
    octal(Math.floor(Date.now() / 1000), 136, 12);
    bytes.fill(32, 148, 156);
    bytes[156] = directory ? 53 : 48;
    string('ustar', 257, 6);
    let checksum = 0;
    for (const byte of bytes) checksum += byte;
    string(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 8);
    return bytes;
  }

  private async createArchive(name: string, inputs: string[]): Promise<string> {
    if (inputs.length === 0) throw new Error('tar: Cowardly refusing to create an empty archive');
    const archivePath = resolvePath(this.currentDir, name);
    const chunks: Uint8Array[] = [];
    const added = new Set<string>();
    for (const input of inputs) {
      const path = resolvePath(this.currentDir, input);
      const stat = await this.fs.stat(path);
      const entryName = posixPath.relative(this.currentDir, path);
      if (stat.type === 'folder') {
        const descendants = [stat, ...(await this.fs.walk(path))];
        for (const entry of descendants) {
          const relative = posixPath.relative(this.currentDir, entry.path);
          if (added.has(relative)) continue;
          const directory = entry.type === 'folder';
          const entryPath = directory && !relative.endsWith('/') ? `${relative}/` : relative;
          const content = directory ? new Uint8Array() : await this.fs.readFile(entry.path);
          chunks.push(this.header(entryPath, content.length, directory));
          if (content.length) {
            chunks.push(content);
            chunks.push(new Uint8Array((512 - (content.length % 512)) % 512));
          }
          added.add(relative);
        }
      } else if (!added.has(entryName)) {
        const content = await this.fs.readFile(path);
        chunks.push(this.header(entryName, content.length, false), content);
        chunks.push(new Uint8Array((512 - (content.length % 512)) % 512));
        added.add(entryName);
      }
    }
    chunks.push(new Uint8Array(1024));
    const output = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
    let offset = 0;
    for (const chunk of chunks) {
      output.set(chunk, offset);
      offset += chunk.length;
    }
    await this.fs.writeFile(archivePath, output);
    return `Created ${name} (${added.size} files)`;
  }

  private async readEntries(
    name: string
  ): Promise<Array<{ name: string; directory: boolean; content: Uint8Array }>> {
    const data = await this.fs.readFile(resolvePath(this.currentDir, name));
    const entries: Array<{ name: string; directory: boolean; content: Uint8Array }> = [];
    let offset = 0;
    while (offset + 512 <= data.length) {
      const header = data.subarray(offset, offset + 512);
      if (header.every(byte => byte === 0)) break;
      const entryName = decoder.decode(header.subarray(0, 100)).replace(/\0.*$/, '');
      const sizeField = decoder.decode(header.subarray(124, 136)).replace(/\0.*$/, '').trim();
      const size = Number.parseInt(sizeField, 8) || 0;
      const contentStart = offset + 512;
      entries.push({
        name: entryName,
        directory: header[156] === 53 || entryName.endsWith('/'),
        content: data.slice(contentStart, contentStart + size),
      });
      offset = contentStart + size + ((512 - (size % 512)) % 512);
    }
    return entries;
  }

  private async listArchive(name: string): Promise<string> {
    return (await this.readEntries(name)).map(entry => entry.name).join('\n');
  }

  private async extractArchive(name: string): Promise<string> {
    const destination = this.currentDir;
    const entries = await this.readEntries(name);
    const targets = entries.map(entry => {
      const target = resolvePath(destination, entry.name);
      if (!isPathWithin(target, destination))
        throw new Error(`tar: Path escapes destination: ${entry.name}`);
      return { entry, target };
    });
    for (const { entry, target } of targets) {
      if (entry.directory) await this.fs.mkdir(target, { recursive: true });
      else {
        const parent = target.slice(0, target.lastIndexOf('/')) || '/';
        await this.fs.mkdir(parent, { recursive: true });
        await this.fs.writeFile(target, entry.content);
      }
    }
    return `Extracted ${targets.length} file(s)`;
  }
}
