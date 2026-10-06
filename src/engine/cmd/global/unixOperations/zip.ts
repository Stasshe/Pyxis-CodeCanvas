import JSZip from 'jszip';
import { fsClient, posixPath, resolvePath } from '@/engine/core/fs';
import { parseWithGetOpt } from '../../lib';
import { UnixCommandBase } from './base';

export class ZipCommand extends UnixCommandBase {
  async execute(args: string[] = []): Promise<string> {
    const { flags, positional, errors } = parseWithGetOpt(args, 'rqvufdh', [
      'recurse-paths',
      'quiet',
      'verbose',
      'update',
      'freshen',
      'delete',
      'help',
    ]);
    if (errors.length) throw new Error(errors.join('; '));
    if (flags.has('-h') || flags.has('--help') || positional.length === 0) return this.showHelp();
    const options = {
      recursive: flags.has('-r') || flags.has('--recurse-paths'),
      quiet: flags.has('-q') || flags.has('--quiet'),
      verbose: flags.has('-v') || flags.has('--verbose'),
      update: flags.has('-u') || flags.has('--update'),
      freshen: flags.has('-f') || flags.has('--freshen'),
      remove: flags.has('-d') || flags.has('--delete'),
    };
    let archive = positional[0];
    if (!archive.endsWith('.zip')) archive += '.zip';
    const archivePath = resolvePath(this.currentDir, archive);
    let zip = new JSZip();
    if (options.update || options.freshen || options.remove) {
      if (!(await fsClient.exists(archivePath))) {
        if (options.freshen || options.remove)
          throw new Error(`${archive}: No such file or directory`);
      } else {
        zip = await JSZip.loadAsync(await fsClient.readFile(archivePath));
      }
    }
    const names: string[] = [];
    for (const input of positional.slice(1)) {
      const path = resolvePath(this.currentDir, input);
      if (path === archivePath) continue;
      const entry = posixPath.relative(this.currentDir, path);
      if (options.remove) {
        zip.remove(entry);
        names.push(entry);
        continue;
      }
      if (!(await fsClient.exists(path))) throw new Error(`${input}: No such file or directory`);
      const stat = await fsClient.stat(path);
      if (options.freshen && !zip.file(entry)) continue;
      if (stat.type === 'folder') {
        if (options.recursive) await this.addDirectory(zip, path, entry, names);
        else {
          zip.folder(entry);
          names.push(`${entry}/`);
        }
      } else {
        zip.file(entry, await fsClient.readFile(path));
        names.push(entry);
      }
    }
    if (names.length === 0 && !options.update) throw new Error('zip: nothing to do');
    const archiveBytes = await zip.generateAsync({
      type: 'uint8array',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    });
    await fsClient.writeFile(archivePath, archiveBytes);
    if (options.verbose) return names.map(name => `  adding: ${name}`).join('\n');
    if (options.quiet) return '';
    return `${options.remove ? 'deleted' : 'created'} ${archive}`;
  }

  private async addDirectory(
    zip: JSZip,
    path: string,
    entry: string,
    names: string[]
  ): Promise<void> {
    zip.folder(entry);
    names.push(`${entry}/`);
    const entries = await fsClient.walk(path);
    for (const child of entries) {
      const relative = child.path.slice(path.length).replace(/^\/+/, '');
      if (!relative) continue;
      const childName = `${entry}/${relative}`;
      if (child.type === 'folder') {
        zip.folder(childName);
        names.push(`${childName}/`);
      } else {
        zip.file(childName, await fsClient.readFile(child.path));
        names.push(childName);
      }
    }
  }

  private showHelp(): string {
    return `Usage: zip [OPTIONS] archive[.zip] file1 file2 ...\n\nOptions:\n  -r, --recurse-paths  add directories recursively\n  -q, --quiet          quiet operation\n  -v, --verbose        verbose operation\n  -u, --update         update archive\n  -f, --freshen        update existing entries\n  -d, --delete         delete entries\n  -h, --help           display this help`;
  }
}
