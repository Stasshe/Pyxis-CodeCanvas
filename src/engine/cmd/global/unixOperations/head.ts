import { parseArgs } from '../../lib';
import { UnixCommandBase } from './base';
import { fsPathToAppPath, resolvePath as pathResolve, toFSPath } from '@/engine/core/pathUtils';

/**
 * head - ファイルの先頭部分を表示 (POSIX/GNU準拠)
 *
 * 使用法:
 *   head [options] [file...]
 *
 * オプション:
 *   -n, --lines=NUM   先頭NUM行を表示（デフォルト: 10）
 *   -c, --bytes=NUM   先頭NUMバイトを表示
 *   -q, --quiet       ファイル名ヘッダを表示しない
 *   -v, --verbose     常にファイル名ヘッダを表示
 *
 * NUM に - が付くと最後のNUM行/バイトを除いて表示
 */
export class HeadCommand extends UnixCommandBase {
  async execute(args: string[]): Promise<string> {
    const { flags, values, positional } = parseArgs(args, ['-n', '-c', '--lines', '--bytes']);

    if (flags.has('--help')) {
      return 'Usage: head [options] [file...]\n\nOptions:\n  -n, --lines=NUM\tshow first NUM lines (default 10)\n  -c, --bytes=NUM\tshow first NUM bytes';
    }

    if (positional.length === 0) {
      throw new Error('head: missing file operand');
    }

    // オプション
    const linesArg = values.get('-n') || values.get('--lines');
    const bytesArg = values.get('-c') || values.get('--bytes');
    const quiet = flags.has('-q') || flags.has('--quiet') || flags.has('--silent');
    const verbose = flags.has('-v') || flags.has('--verbose');

    let numLines = 10;
    let numBytes: number | null = null;
    let fromEnd = false;

    if (linesArg) {
      if (linesArg.startsWith('-')) {
        fromEnd = true;
        numLines = Number.parseInt(linesArg.slice(1), 10) || 10;
      } else {
        numLines = Number.parseInt(linesArg, 10) || 10;
      }
    }

    if (bytesArg) {
      if (bytesArg.startsWith('-')) {
        fromEnd = true;
        numBytes = Number.parseInt(bytesArg.slice(1), 10) || 0;
      } else {
        numBytes = Number.parseInt(bytesArg, 10) || 0;
      }
    }

    const showHeader = positional.length > 1 || verbose;
    const results: string[] = [];

    for (let i = 0; i < positional.length; i++) {
      const file = positional[i];
      const baseApp = fsPathToAppPath(this.currentDir, this.projectName);
      const appPath = pathResolve(baseApp, file);
      const path = toFSPath(this.projectName, appPath);

      const isDir = await this.isDirectory(path);
      if (isDir) {
        results.push(`head: ${file}: Is a directory`);
        continue;
      }

      try {
        const relative = appPath;
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
          if (fromEnd) {
            output = numBytes === 0 ? content : content.slice(0, -numBytes);
          } else {
            output = content.slice(0, numBytes);
          }
        } else {
          // 行単位
          const lines = content.split(/\r?\n/);
          if (fromEnd) {
            output = numLines === 0 ? lines.join('\n') : lines.slice(0, -numLines).join('\n');
          } else {
            output = lines.slice(0, numLines).join('\n');
          }
        }

        if (showHeader && !quiet) {
          if (i > 0) results.push('');
          results.push(`==> ${file} <==`);
        }
        results.push(output);
      } catch (e) {
        results.push(`head: ${file}: ${(e as Error).message}`);
      }
    }

    return results.join('\n');
  }
}
