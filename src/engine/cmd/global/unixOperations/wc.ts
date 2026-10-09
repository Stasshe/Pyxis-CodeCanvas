import { parseWithGetOpt } from '../../lib';
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
  private stdinContent: string | Uint8Array | null = null;

  setStdin(content: string | Uint8Array | null): void {
    this.stdinContent = content;
  }

  async execute(args: string[]): Promise<string> {
    const optstring = 'lwcm';
    const longopts = ['help'];
    const { flags, positional, errors } = parseWithGetOpt(args, optstring, longopts);
    if (errors.length) throw new Error(errors.join('; '));

    if (flags.has('--help')) {
      return 'Usage: wc [options] [file...]\n\nOptions:\n  -l\tlines\n  -w\twords\n  -c\tbytes\n  -m\tchars';
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
    let maxFileSize = 0;

    // ファイルが指定されていない場合はstdinから読む
    if (positional.length === 0) {
      const stats = this.countStats(this.stdinContent ?? '');
      results.push({ ...stats, name: '' });
    } else {
      let stdinRead = false;
      // 各ファイルを処理
      for (const filePath of positional) {
        if (filePath === '-') {
          let content: string | Uint8Array = this.stdinContent ?? '';
          if (stdinRead) content = new Uint8Array();
          stdinRead = true;
          const stats = this.countStats(content);
          results.push({ ...stats, name: '-' });
          continue;
        }
        const path = this.resolvePath(filePath);
        const file = await this.getFile(path);
        if (!file) {
          throw new Error(`wc: ${filePath}: No such file or directory`);
        }

        if (file.type === 'folder') {
          throw new Error(`wc: ${filePath}: Is a directory`);
        }

        maxFileSize = Math.max(maxFileSize, file.size);
        const content = await this.readBytes(path);
        const stats = this.countStats(content);
        results.push({ ...stats, name: filePath });
      }
    }

    // 結果を整形
    const fields: Array<'lines' | 'words' | 'bytes' | 'chars'> = [];
    if (showAll || showLines) fields.push('lines');
    if (showAll || showWords) fields.push('words');
    if (showChars) fields.push('chars');
    if (showAll || showBytes) fields.push('bytes');

    const totals = { lines: 0, words: 0, bytes: 0, chars: 0 };
    for (const result of results) {
      totals.lines += result.lines;
      totals.words += result.words;
      totals.bytes += result.bytes;
      totals.chars += result.chars;
    }

    const rows = results.map(result => fields.map(field => result[field]));
    if (results.length > 1) rows.push(fields.map(field => totals[field]));
    let width = 0;
    for (const row of rows) {
      for (const count of row) width = Math.max(width, String(count).length);
    }
    if (results.length > 1) width = Math.max(width, String(maxFileSize).length);

    const formatCounts = (counts: number[]) =>
      counts.map(count => String(count).padStart(width)).join(' ');
    const lines: string[] = [];

    for (let index = 0; index < results.length; index += 1) {
      lines.push(formatRow(formatCounts(rows[index]), results[index].name));
    }

    // 複数ファイルの場合は合計を追加
    if (results.length > 1) {
      lines.push(formatRow(formatCounts(rows[rows.length - 1]), 'total'));
    }

    return lines.join('\n');
  }

  /**
   * 統計をカウント
   */
  private countStats(input: string | Uint8Array): {
    lines: number;
    words: number;
    bytes: number;
    chars: number;
  } {
    let bytes: Uint8Array;
    if (typeof input === 'string') bytes = new TextEncoder().encode(input);
    else bytes = input;
    const content = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);
    let lines = 0;
    for (const byte of bytes) {
      if (byte === 10) lines += 1;
    }

    const words = countWords(content);

    // バイト数: UTF-8エンコードでのバイト数
    const byteCount = bytes.length;

    // 文字数: Unicodeコードポイント数
    const chars = countUtf8Characters(bytes);

    return { lines, words, bytes: byteCount, chars };
  }
}

function countWords(content: string): number {
  let count = 0;
  let insideWord = false;
  for (const character of content) {
    const whitespace = character !== '\uFEFF' && (/\s/u.test(character) || character === '\u2060');
    if (whitespace) {
      insideWord = false;
    } else if (!insideWord) {
      count += 1;
      insideWord = true;
    }
  }
  return count;
}

function formatRow(counts: string, name: string): string {
  let row = counts;
  if (name) row += ` ${name}`;
  return row;
}

function countUtf8Characters(bytes: Uint8Array): number {
  let count = 0;
  for (let index = 0; index < bytes.length; ) {
    const first = bytes[index];
    if (first <= 0x7f) {
      count += 1;
      index += 1;
      continue;
    }
    const width = validUtf8Width(bytes, index);
    if (width > 0) count += 1;
    if (width > 0) index += width;
    else index += 1;
  }
  return count;
}

function validUtf8Width(bytes: Uint8Array, index: number): number {
  const first = bytes[index];
  const second = bytes[index + 1];
  if (first >= 0xc2 && first <= 0xdf && isContinuation(second)) return 2;
  if (first >= 0xe0 && first <= 0xef) {
    if (!isContinuation(bytes[index + 2])) return 0;
    if (first === 0xe0 && (second < 0xa0 || second > 0xbf)) return 0;
    if (first === 0xed && (second < 0x80 || second > 0x9f)) return 0;
    if (first !== 0xe0 && first !== 0xed && !isContinuation(second)) return 0;
    return 3;
  }
  if (first >= 0xf0 && first <= 0xf4) {
    const third = bytes[index + 2];
    const fourth = bytes[index + 3];
    if (!isContinuation(third) || !isContinuation(fourth)) return 0;
    if (first === 0xf0 && (second < 0x90 || second > 0xbf)) return 0;
    if (first === 0xf4 && (second < 0x80 || second > 0x8f)) return 0;
    if (first !== 0xf0 && first !== 0xf4 && !isContinuation(second)) return 0;
    return 4;
  }
  return 0;
}

function isContinuation(byte: number | undefined): boolean {
  return byte !== undefined && byte >= 0x80 && byte <= 0xbf;
}
