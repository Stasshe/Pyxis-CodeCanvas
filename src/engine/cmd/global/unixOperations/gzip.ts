import pako from 'pako';
import { resolvePath } from '@/engine/core/fs';
import { parseWithGetOpt } from '../../lib';
import { UnixCommandBase, UnixCommandFailure } from './base';

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
    const errorsForFiles: string[] = [];
    for (const name of positional) {
      try {
        const result = await this.processFile(name, decompress, keep, force, verbose);
        if (result) results.push(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errorsForFiles.push(`gzip: ${name}: ${message}`);
      }
    }
    if (errorsForFiles.length > 0)
      throw new UnixCommandFailure(errorsForFiles.join('\n'), 1, results.join('\n'));
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
    const input = await this.fs.readFile(inputPath);
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
    if (!force && (await this.fs.exists(outputPath)))
      throw new Error(`${outputName} already exists; not overwritten`);

    const output = decompress ? pako.ungzip(input) : pako.gzip(input);
    await this.fs.writeFile(outputPath, output);
    if (!keep) await this.fs.rm(inputPath);
    if (!verbose) return '';
    let denominator = input.length;
    let numerator = output.length;
    if (decompress) {
      denominator = output.length;
      numerator = input.length;
    }
    let ratio = '0.0';
    if (denominator === 0 && numerator > 0) {
      ratio = '-Inf';
    } else if (denominator > 0) {
      const percent = (1 - numerator / denominator) * 100;
      ratio = percent.toFixed(1);
    }
    return `${name}:\t ${ratio}% -- ${keep ? 'kept' : 'replaced with'} ${outputName}`;
  }

  private showHelp(): string {
    return `Usage: gzip [OPTION]... [FILE]...\n\nOptions:\n  -d, --decompress  decompress\n  -k, --keep        keep input files\n  -f, --force       force overwrite\n  -v, --verbose     verbose mode\n  -h, --help        display this help`;
  }
}
