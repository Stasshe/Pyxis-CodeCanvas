import { parseArgs } from '../../lib';
import { UnixCommandBase } from './base';

/**
 * wc - 行数、単語数、バイト数をカウント (POSIX準拠)
 *
 * 使用法:
 *   wc [options] [file...]
 *
 * オプション:
 *   -l    行数のみ表示
 *   -w    単語数のみ表示
 *   -c    バイト数のみ表示
 *   -m    文字数のみ表示
 *
 * stdinからの入力もサポート:
 *   cat file | wc -l
 *   wc -l < file
 */
export class WcCommand extends UnixCommandBase {
  private stdinContent: string | null = null;

  setStdin(content: string): void {
    this.stdinContent = content;
  }

  async execute(args: string[]): Promise<string> {
    const { flags, positional } = parseArgs(args);

    if (flags.has('--help')) {
      return `Usage: wc [options] [file...]\n\nOptions:\n  -l\tlines\n  -w\twords\n  -c\tbytes\n  -m\tchars`;
    }

    // オプション: なければ全部表示
    const showLines = flags.has('-l');
    const showWords = flags.has('-w');
    const showBytes = flags.has('-c');
    const showChars = flags.has('-m');

    // オプションが何も指定されていなければ全部表示
    const showAll = !showLines && !showWords && !showBytes && !showChars;

    const results: Array<{
      lines: number;
      words: number;
      bytes: number;
      chars: number;
      name: string;
    }> = [];

    // ファイルが指定されていない場合はstdinから読む
    if (positional.length === 0) {
      if (this.stdinContent !== null) {
        const stats = this.countStats(this.stdinContent);
        results.push({ ...stats, name: '' });
      } else {
        // stdinがない場合は空
        return '';
      }
    } else {
      // 各ファイルを処理
      for (const filePath of positional) {
        try {
          const resolvedPath = this.resolvePath(filePath);
          const normalizedPath = this.normalizePath(resolvedPath);
          const relativePath = this.getRelativePathFromProject(normalizedPath);

          const file = await this.cachedGetFile(relativePath);
          if (!file) {
            throw new Error(`wc: ${filePath}: No such file or directory`);
          }

          if (file.type === 'folder') {
            throw new Error(`wc: ${filePath}: Is a directory`);
          }

          const content = file.content || '';
          const stats = this.countStats(content);
          results.push({ ...stats, name: filePath });
        } catch (e: any) {
          // エラーメッセージを出力して継続
          throw e;
        }
      }
    }

    // 結果を整形
    const lines: string[] = [];
    let totalLines = 0;
    let totalWords = 0;
    let totalBytes = 0;
    let totalChars = 0;

    for (const r of results) {
      const parts: string[] = [];

      if (showAll || showLines) {
        parts.push(r.lines.toString().padStart(7));
        totalLines += r.lines;
      }
      if (showAll || showWords) {
        parts.push(r.words.toString().padStart(7));
        totalWords += r.words;
      }
      if (showAll || showBytes) {
        parts.push(r.bytes.toString().padStart(7));
        totalBytes += r.bytes;
      }
      if (showChars) {
        parts.push(r.chars.toString().padStart(7));
        totalChars += r.chars;
      }

      if (r.name) {
        parts.push(` ${r.name}`);
      }

      lines.push(parts.join(''));
    }

    // 複数ファイルの場合は合計を追加
    if (results.length > 1) {
      const totalParts: string[] = [];

      if (showAll || showLines) {
        totalParts.push(totalLines.toString().padStart(7));
      }
      if (showAll || showWords) {
        totalParts.push(totalWords.toString().padStart(7));
      }
      if (showAll || showBytes) {
        totalParts.push(totalBytes.toString().padStart(7));
      }
      if (showChars) {
        totalParts.push(totalChars.toString().padStart(7));
      }
      totalParts.push(' total');

      lines.push(totalParts.join(''));
    }

    return lines.join('\n');
  }

  /**
   * 統計をカウント
   */
  private countStats(content: string): {
    lines: number;
    words: number;
    bytes: number;
    chars: number;
  } {
    // 行数: 改行の数
    // POSIX wc: 改行文字の数をカウント（最終行に改行がなくてもその行は含まない）
    const lines = (content.match(/\n/g) || []).length;

    // 単語数: 空白で区切られた非空文字列の数
    // 空文字列やホワイトスペースのみの場合は0
    const words = content.trim().length === 0 ? 0 : content.trim().split(/\s+/).length;

    // バイト数: UTF-8エンコードでのバイト数
    const bytes = new TextEncoder().encode(content).length;

    // 文字数: Unicodeコードポイント数
    const chars = [...content].length;

    return { lines, words, bytes, chars };
  }
}
