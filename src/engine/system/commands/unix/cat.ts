import { Buffer } from 'buffer';
import { parseWithGetOpt } from '../../shell/lib/index';
import { UnixCommandBase, UnixCommandFailure } from './base';

const encoder = new TextEncoder();

/**
 * cat - ファイルの内容を表示 (POSIX/GNU準拠)
 *
 * 使用法:
 *   cat [options] [file...]
 *
 * オプション:
 *   -n, --number         全行に行番号を表示
 *   -b, --number-nonblank  非空行のみに行番号を表示
 *   -s, --squeeze-blank  連続する空行を1行に圧縮
 *   -E, --show-ends      行末に$を表示
 *   -T, --show-tabs      TABを^Iとして表示
 *   -v, --show-nonprinting  非表示文字を表示
 *   -A, --show-all       -vET と同等
 *   -e                   -vE と同等
 *   -t                   -vT と同等
 *
 * 動作:
 *   - 複数のファイルを連結して表示
 *   - ファイル名が指定されない場合は空
 *   - パスはシェルで展開された後に解決
 */
export class CatCommand extends UnixCommandBase {
  async execute(
    args: string[],
    stdin: NodeJS.ReadableStream | string | Uint8Array | null = null
  ): Promise<string | Uint8Array> {
    const optstring = 'nbsETvAet';
    const longopts = [
      'number',
      'number-nonblank',
      'squeeze-blank',
      'show-ends',
      'show-tabs',
      'show-nonprinting',
      'show-all',
      'help',
    ];
    const { flags, positional, errors } = parseWithGetOpt(args, optstring, longopts);
    if (errors.length) throw new Error(errors.join('; '));

    if (flags.has('--help')) {
      return 'Usage: cat [options] [file...]\n\nConcatenate FILE(s) to standard output. Common options: -n, -b, -s, -E, -T';
    }

    if (positional.length === 0 || positional.includes('-')) {
      if (positional.length > 0) return this.executeFiles(positional, flags, stdin);
      const input = await readInput(stdin);
      if (flags.size === 0) return input;
      const showAll = flags.has('-A') || flags.has('--show-all');
      return this.processContent(input, {
        numberAll: flags.has('-n') || flags.has('--number'),
        numberNonblank: flags.has('-b') || flags.has('--number-nonblank'),
        squeezeBlank: flags.has('-s') || flags.has('--squeeze-blank'),
        showEnds: flags.has('-E') || flags.has('--show-ends') || showAll || flags.has('-e'),
        showTabs: flags.has('-T') || flags.has('--show-tabs') || showAll || flags.has('-t'),
        showNonprinting:
          flags.has('-v') ||
          flags.has('--show-nonprinting') ||
          showAll ||
          flags.has('-e') ||
          flags.has('-t'),
      });
    }

    return this.executeFiles(positional, flags, stdin);
  }

  private async executeFiles(
    positional: string[],
    flags: Set<string>,
    stdin: NodeJS.ReadableStream | string | Uint8Array | null
  ): Promise<string | Uint8Array> {
    let stdinRead = false;
    const readStdinOnce = async (): Promise<Uint8Array> => {
      if (stdinRead) return new Uint8Array();
      stdinRead = true;
      return readInput(stdin);
    };

    if (flags.size === 0) {
      const chunks: Uint8Array[] = [];
      const errors: string[] = [];
      for (const arg of positional) {
        if (arg === '-') {
          chunks.push(await readStdinOnce());
          continue;
        }
        const path = this.resolvePath(arg);
        try {
          if (await this.isDirectory(path)) throw new Error('Is a directory');
          chunks.push(await this.readBytes(path));
        } catch (error) {
          let message = String(error);
          if (error instanceof Error) message = error.message;
          errors.push(`cat: ${arg}: ${message}`);
        }
      }
      const output = Buffer.concat(chunks);
      if (errors.length > 0) throw new UnixCommandFailure(errors.join('\n'), 1, output);
      return output;
    }

    // オプション解析
    const showAll = flags.has('-A') || flags.has('--show-all');
    const numberAll = flags.has('-n') || flags.has('--number');
    const numberNonblank = flags.has('-b') || flags.has('--number-nonblank');
    const squeezeBlank = flags.has('-s') || flags.has('--squeeze-blank');
    const showEnds = flags.has('-E') || flags.has('--show-ends') || showAll || flags.has('-e');
    const showTabs = flags.has('-T') || flags.has('--show-tabs') || showAll || flags.has('-t');
    const showNonprinting =
      flags.has('-v') ||
      flags.has('--show-nonprinting') ||
      showAll ||
      flags.has('-e') ||
      flags.has('-t');

    const contents: Uint8Array[] = [];
    const errors: string[] = [];

    for (const arg of positional) {
      if (arg === '-') {
        const content = await readStdinOnce();
        contents.push(content);
        continue;
      }
      const path = this.resolvePath(arg);
      try {
        if (await this.isDirectory(path)) throw new Error('Is a directory');
        const content = await this.readBytes(path);
        contents.push(content);
      } catch (error) {
        let message = String(error);
        if (error instanceof Error) message = error.message;
        errors.push(`cat: ${arg}: ${message}`);
      }
    }

    const output = this.processContent(Buffer.concat(contents), {
      numberAll,
      numberNonblank,
      squeezeBlank,
      showEnds,
      showTabs,
      showNonprinting,
    });
    if (errors.length > 0) throw new UnixCommandFailure(errors.join('\n'), 1, output);
    return output;
  }

  /**
   * コンテンツを処理
   */
  private processContent(
    input: Uint8Array,
    opts: {
      numberAll: boolean;
      numberNonblank: boolean;
      squeezeBlank: boolean;
      showEnds: boolean;
      showTabs: boolean;
      showNonprinting: boolean;
    }
  ): Uint8Array {
    let lines = splitRecords(input);
    let lineNumber = 1;

    // 連続空行を圧縮
    if (opts.squeezeBlank) {
      const squeezed: CatRecord[] = [];
      let prevBlank = false;
      for (const line of lines) {
        const isBlank = line.bytes.length === 0;
        if (isBlank && prevBlank) continue;
        squeezed.push(line);
        prevBlank = isBlank;
      }
      lines = squeezed;
    }

    const processed = lines.map(record => {
      const isBlank = record.bytes.length === 0;
      const parts: Uint8Array[] = [];
      if (opts.numberNonblank) {
        if (!isBlank) {
          parts.push(encode(`${lineNumber.toString().padStart(6)}\t`));
          lineNumber++;
        }
      } else if (opts.numberAll) {
        parts.push(encode(`${lineNumber.toString().padStart(6)}\t`));
        lineNumber++;
      }
      parts.push(this.transformLine(record.bytes, opts.showNonprinting, opts.showTabs));
      if (opts.showEnds && record.hasNewline) parts.push(encode('$'));
      if (record.hasNewline) parts.push(new Uint8Array([10]));
      return Buffer.concat(parts);
    });

    return Buffer.concat(processed);
  }

  private transformLine(line: Uint8Array, showNonprinting: boolean, showTabs: boolean): Uint8Array {
    const parts: Uint8Array[] = [];
    for (const byte of line) {
      if (showTabs && byte === 9) {
        parts.push(encode('^I'));
      } else if (showNonprinting) {
        parts.push(renderNonprintingByte(byte));
      } else {
        parts.push(new Uint8Array([byte]));
      }
    }
    return Buffer.concat(parts);
  }
}

interface CatRecord {
  bytes: Uint8Array;
  hasNewline: boolean;
}

function splitRecords(input: Uint8Array): CatRecord[] {
  const records: CatRecord[] = [];
  let start = 0;
  for (let index = 0; index < input.length; index += 1) {
    if (input[index] !== 10) continue;
    records.push({ bytes: input.slice(start, index), hasNewline: true });
    start = index + 1;
  }
  if (start < input.length) records.push({ bytes: input.slice(start), hasNewline: false });
  return records;
}

function renderNonprintingByte(byte: number): Uint8Array {
  if (byte === 9) return new Uint8Array([byte]);
  if (byte < 32) return encode(`^${String.fromCharCode(byte + 64)}`);
  if (byte === 127) return encode('^?');
  if (byte < 127) return new Uint8Array([byte]);
  if (byte < 160) return encode(`M-^${String.fromCharCode(byte - 64)}`);
  if (byte === 255) return encode('M-^?');
  if (byte < 256) return encode(`M-${String.fromCharCode(byte - 128)}`);
  return new Uint8Array([byte]);
}

function encode(value: string): Uint8Array {
  return encoder.encode(value);
}

async function readInput(
  stdin: NodeJS.ReadableStream | string | Uint8Array | null
): Promise<Uint8Array> {
  if (typeof stdin === 'string') return new TextEncoder().encode(stdin);
  if (stdin instanceof Uint8Array) return stdin;
  if (!stdin) return new Uint8Array();
  return new Promise(resolve => {
    const chunks: Uint8Array[] = [];
    let length = 0;
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      const input = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) {
        input.set(chunk, offset);
        offset += chunk.length;
      }
      resolve(input);
    };
    stdin.on('data', chunk => {
      let bytes: Uint8Array;
      if (typeof chunk === 'string') bytes = new TextEncoder().encode(chunk);
      else bytes = new Uint8Array(chunk);
      chunks.push(bytes);
      length += bytes.length;
    });
    stdin.on('end', finish);
    stdin.on('close', finish);
  });
}
