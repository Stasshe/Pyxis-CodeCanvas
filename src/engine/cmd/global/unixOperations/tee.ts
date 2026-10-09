import { UnixCommandBase } from './base';

export class TeeCommand extends UnixCommandBase {
  async execute(
    args: string[],
    input: Uint8Array
  ): Promise<{ output: Uint8Array; errors: string[] }> {
    const parsed = parseArguments(args);
    const errors: string[] = [];
    for (const file of parsed.files) {
      const path = this.resolvePath(file);
      try {
        if (parsed.append && (await this.exists(path))) {
          const previous = await this.readBytes(path);
          const combined = new Uint8Array(previous.length + input.length);
          combined.set(previous);
          combined.set(input, previous.length);
          await this.fs.writeFile(path, combined);
        } else {
          await this.fs.writeFile(path, input);
        }
      } catch (error) {
        errors.push(`tee: ${file}: ${(error as Error).message}`);
      }
    }
    return { output: input, errors };
  }
}

function parseArguments(args: string[]): { append: boolean; files: string[] } {
  let append = false;
  let optionsEnded = false;
  const files: string[] = [];
  for (const argument of args) {
    if (!optionsEnded && argument === '--') {
      optionsEnded = true;
      continue;
    }
    if (!optionsEnded && (argument === '-a' || argument === '--append')) {
      append = true;
      continue;
    }
    if (!optionsEnded && argument.startsWith('-') && argument !== '-') {
      throw new Error(`tee: invalid option -- '${argument.slice(1)}'`);
    }
    files.push(argument);
  }
  return { append, files };
}
