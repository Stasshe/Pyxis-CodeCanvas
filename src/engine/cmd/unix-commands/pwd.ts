import { UnixCommandBase } from './base';

/**
 * pwd - カレントディレクトリのパスを表示
 * 
 * 使用法:
 *   pwd [-L | -P]
 * 
 * オプション:
 *   -L  論理パスを表示（デフォルト、シンボリックリンク未実装のため-Pと同じ）
 *   -P  物理パスを表示
 * 
 * 動作:
 *   - カレントディレクトリの絶対パスを表示
 */
export class PwdCommand extends UnixCommandBase {
  async execute(args: string[]): Promise<string> {
    // オプションは無視（シンボリックリンク未実装のため-L/-Pは同じ）
    return this.currentDir;
  }
}
