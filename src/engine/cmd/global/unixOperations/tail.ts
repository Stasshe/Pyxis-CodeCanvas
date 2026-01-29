import { parseWithGetOpt } from '../../lib';
import { UnixCommandBase } from './base';

/**
 * tail - ファイルの末尾部分を表示 (POSIX/GNU準拠)
 *
 * 使用法:
 *   tail [options] [file...]
 *
 * オプション:
 *   -n, --lines=NUM   末尾NUM行を表示（デフォルト: 10）
 *   -c, --bytes=NUM   末尾NUMバイトを表示
 *   -q, --quiet       ファイル名ヘッダを表示しない
 *   -v, --verbose     常にファイル名ヘッダを表示
 *   +NUM              先頭からNUM行目以降を表示（-nの代わり）
 *
 * NUM に + が付くと先頭からNUM行/バイト目以降を表示
 */
export class TailCommand extends UnixCommandBase {
  async execute(args: string[]): Promise<string> {
    const optstring = 'n:c:qv';
    const longopts = ['lines=', 'bytes=', 'quiet', 'verbose', 'silent'];
    const { flags, values, positional, errors } = parseWithGetOpt(args, optstring, longopts);
    if (errors.length) throw new Error(errors.join('; '));

    if (flags.has('--help')) {
      return 'Usage: tail [options] [file...]\n\nOptions:\n  -n, --lines=NUM\tshow last NUM lines (default 10)\n  -c, --bytes=NUM\tshow last NUM bytes';
    }

    if (positional.length === 0) {
      throw new Error('tail: missing file operand');
    }

    // オプション
    const linesArg = values.get('-n') || values.get('--lines');
    const bytesArg = values.get('-c') || values.get('--bytes');
    const quiet = flags.has('-q') || flags.has('--quiet') || flags.has('--silent');
    const verbose = flags.has('-v') || flags.has('--verbose');

    let numLines = 10;
    let numBytes: number | null = null;
    let fromStart = false;

    if (linesArg) {
      if (linesArg.startsWith('+')) {
        fromStart = true;
        numLines = Number.parseInt(linesArg.slice(1), 10) || 1;
      } else {
        numLines = Number.parseInt(linesArg, 10) || 10;
      }
    }

    if (bytesArg) {
      if (bytesArg.startsWith('+')) {
        fromStart = true;
        numBytes = Number.parseInt(bytesArg.slice(1), 10) || 1;
      } else {
        numBytes = Number.parseInt(bytesArg, 10) || 0;
      }
    }

    const showHeader = positional.length > 1 || verbose;
    const results: string[] = [];

    for (let i = 0; i < positional.length; i++) {
      const file = positional[i];
      const path = this.normalizePath(this.resolvePath(file));

      const isDir = await this.isDirectory(path);
      if (isDir) {
        results.push(`tail: ${file}: Is a directory`);
        continue;
      }

      try {
        const relative = this.getRelativePathFromProject(path);
        const fileData = await this.getFileFromDB(relative);
        if (!fileData) throw new Error('No such file or directory');

        let content = '';
        if (fileData.isBufferArray && fileData.bufferContent) {
          content = new TextDecoder('utf-8').decode(fileData.bufferContent as ArrayBuffer);
        } else if (typeof fileData.content === 'string') {
          content = fileData.content;
        }

        let output: string;

        if (numBytes !== null) {
          // バイト単位
          if (fromStart) {
            output = content.slice(numBytes - 1);
          } else {
            output = content.slice(-numBytes);
          }
        } else {
          // 行単位
          const lines = content.split(/\r?\n/);
          if (fromStart) {
            output = lines.slice(numLines - 1).join('\n');
          } else {
            output = lines.slice(-numLines).join('\n');
          }
        }

        if (showHeader && !quiet) {
          if (i > 0) results.push('');
          results.push(`==> ${file} <==`);
        }
        results.push(output);
      } catch (e) {
        results.push(`tail: ${file}: ${(e as Error).message}`);
      }
    }

    return results.join('\n');
  }
}
