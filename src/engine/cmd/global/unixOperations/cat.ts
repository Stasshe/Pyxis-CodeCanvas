import { Buffer } from 'buffer';
import { parseWithGetOpt } from '../../lib';
import { UnixCommandBase } from './base';

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
  async execute(args: string[]): Promise<string | Uint8Array> {
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

    if (positional.length === 0) {
      // stdinがない場合は空を返す
      return '';
    }

    if (flags.size === 0) {
      const chunks: Uint8Array[] = [];
      for (const arg of positional) {
        const path = this.resolvePath(arg);
        try {
          if (await this.isDirectory(path)) throw new Error('Is a directory');
          chunks.push(await this.readBytes(path));
        } catch (error) {
          throw new Error(`cat: ${path}: ${String(error)}`);
        }
      }
      return Buffer.concat(chunks);
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

    const results: string[] = [];

    for (const arg of positional) {
      const path = this.resolvePath(arg);
      try {
        if (await this.isDirectory(path)) throw new Error('Is a directory');
        const content = await this.readText(path);
        const processed = this.processContent(content, {
          numberAll,
          numberNonblank,
          squeezeBlank,
          showEnds,
          showTabs,
          showNonprinting,
        });
        results.push(processed);
      } catch (error) {
        throw new Error(`cat: ${path}: ${(error as Error).message}`);
      }
    }

    return results.join('');
  }

  /**
   * コンテンツを処理
   */
  private processContent(
    content: string,
    opts: {
      numberAll: boolean;
      numberNonblank: boolean;
      squeezeBlank: boolean;
      showEnds: boolean;
      showTabs: boolean;
      showNonprinting: boolean;
    }
  ): string {
    let lines = content.split('\n');
    let lineNumber = 1;

    // 連続空行を圧縮
    if (opts.squeezeBlank) {
      const squeezed: string[] = [];
      let prevBlank = false;
      for (const line of lines) {
        const isBlank = line.trim() === '';
        if (isBlank && prevBlank) continue;
        squeezed.push(line);
        prevBlank = isBlank;
      }
      lines = squeezed;
    }

    const processed = lines.map((line, idx) => {
      let result = line;

      // 非表示文字を表示
      if (opts.showNonprinting) {
        result = this.showNonprinting(result);
      }

      // TABを表示
      if (opts.showTabs) {
        result = result.replace(/\t/g, '^I');
      }

      // 行末に$を表示
      if (opts.showEnds) {
        result += '$';
      }

      // 行番号
      if (opts.numberNonblank) {
        if (line.trim() !== '') {
          result = `${lineNumber.toString().padStart(6)}  ${result}`;
          lineNumber++;
        }
      } else if (opts.numberAll) {
        result = `${(idx + 1).toString().padStart(6)}  ${result}`;
      }

      return result;
    });

    return processed.join('\n');
  }

  /**
   * 非表示文字を表示形式に変換
   */
  private showNonprinting(str: string): string {
    let result = '';
    for (const char of str) {
      const code = char.charCodeAt(0);
      if (code === 9) {
        // TAB は別途処理
        result += char;
      } else if (code < 32) {
        // 制御文字
        result += `^${String.fromCharCode(code + 64)}`;
      } else if (code === 127) {
        result += '^?';
      } else if (code > 127 && code < 160) {
        result += `M-^${String.fromCharCode(code - 128 + 64)}`;
      } else if (code >= 160 && code < 255) {
        result += `M-${String.fromCharCode(code - 128)}`;
      } else {
        result += char;
      }
    }
    return result;
  }
}
