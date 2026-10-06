import pako from 'pako';
import { fsClient, resolvePath } from '@/engine/core/fs';
import { parseWithGetOpt } from '../../lib';
import { UnixCommandBase } from './base';

export class GzipCommand extends UnixCommandBase {
  async execute(args: string[] = []): Promise<string> {
    const { flags, positional, errors } = parseWithGetOpt(args, 'dkfvh', [
      'decompress',
      'keep',
      'force',
      'verbose',
      'help',
      'uncompress',
    ]);
    if (errors.length) throw new Error(errors.join('; '));
    if (flags.has('-h') || flags.has('--help')) return this.showHelp();
    if (positional.length === 0) throw new Error('gzip: missing file operand');

    const decompress = flags.has('-d') || flags.has('--decompress') || flags.has('--uncompress');
    const keep = flags.has('-k') || flags.has('--keep');
    const force = flags.has('-f') || flags.has('--force');
    const verbose = flags.has('-v') || flags.has('--verbose');
    const results: string[] = [];
    for (const name of positional) {
      try {
        const result = await this.processFile(name, decompress, keep, force, verbose);
        if (result) results.push(result);
      } catch (error) {
        results.push(`gzip: ${name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return results.join('\n');
  }

  private async processFile(
    name: string,
    decompress: boolean,
    keep: boolean,
    force: boolean,
    verbose: boolean
  ): Promise<string> {
    const inputPath = resolvePath(this.currentDir, name);
    const input = await fsClient.readFile(inputPath);
    const outputName = decompress
      ? name.endsWith('.gz')
        ? name.slice(0, -3)
        : `${name}.out`
      : name.endsWith('.gz')
        ? name
        : `${name}.gz`;
    if (decompress && !name.endsWith('.gz') && !force) throw new Error('unknown suffix -- ignored');
    if (!decompress && name.endsWith('.gz') && !force)
      throw new Error('already has .gz suffix -- unchanged');
    const outputPath = resolvePath(this.currentDir, outputName);
    if (!force && (await fsClient.exists(outputPath)))
      throw new Error(`${outputName} already exists; not overwritten`);

    const output = decompress ? pako.ungzip(input) : pako.gzip(input);
    await fsClient.writeFile(outputPath, output);
    if (!keep) await fsClient.rm(inputPath);
    if (!verbose) return '';
    const ratio = decompress
      ? ((1 - input.length / output.length) * 100).toFixed(1)
      : ((1 - output.length / input.length) * 100).toFixed(1);
    return `${name}:\t ${ratio}% -- ${keep ? 'kept' : 'replaced with'} ${outputName}`;
  }

  private showHelp(): string {
    return `Usage: gzip [OPTION]... [FILE]...\n\nOptions:\n  -d, --decompress  decompress\n  -k, --keep        keep input files\n  -f, --force       force overwrite\n  -v, --verbose     verbose mode\n  -h, --help        display this help`;
  }
}
