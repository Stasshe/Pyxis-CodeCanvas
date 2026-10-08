import { UnixCommandBase } from './base';

/**
 * echo - テキストを出力
 *
 * 使用法:
 *   echo [string...]
 *
 * オプション:
 *   -n  末尾の改行を出力しない
 *   -e  バックスラッシュエスケープを解釈
 *
 * 動作:
 *   - 複数の引数をスペース区切りで連結
 *   - リダイレクト処理はTerminal.tsxで統一的に処理される
 */
export class EchoCommand extends UnixCommandBase {
  async execute(args: string[]): Promise<string> {
    if (args.length === 0) {
      return '';
    }

    let noNewline = false;
    let interpretEscapes = false;
    let index = 0;

    while (index < args.length) {
      const option = args[index];
      if (option === '--help' || option === '-h') {
        return 'Usage: echo [string...]\n\nOptions:\n  -n\tdo not output trailing newline\n  -e\tinterpret backslash escapes';
      }
      if (option === '--') {
        index++;
        break;
      }
      if (/^-[ne]+$/.test(option)) {
        if (option.includes('n')) noNewline = true;
        if (option.includes('e')) interpretEscapes = true;
        index++;
        continue;
      }
      break;
    }

    let text = args.slice(index).join(' ');

    // エスケープ解釈
    if (interpretEscapes) {
      text = this.interpretEscapes(text);
    }

    // 改行追加（リダイレクトなしの場合のみ）
    if (!noNewline) {
      text += '\n';
    }

    return text;
  }

  /**
   * エスケープシーケンスを解釈
   */
  private interpretEscapes(text: string): string {
    return text
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\\r/g, '\r')
      .replace(/\\b/g, '\b')
      .replace(/\\f/g, '\f')
      .replace(/\\v/g, '\v')
      .replace(/\\0/g, '\0')
      .replace(/\\\\/g, '\\');
  }
}
