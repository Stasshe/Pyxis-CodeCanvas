import { UnixCommandBase } from './base';
import { fsPathToAppPath, resolvePath as pathResolve, toFSPath } from '@/engine/core/pathUtils';

/**
 * cd - カレントディレクトリを変更
 *
 * 使用法:
 *   cd [directory]
 *
 * オプション:
 *   なし（Linuxのcd組み込みコマンドに準拠）
 *
 * 動作:
 *   - 引数なしの場合はプロジェクトルートに移動
 *   - -はサポートしない（前のディレクトリへの移動）
 *   - プロジェクト外への移動は禁止
 */
export class CdCommand extends UnixCommandBase {
  async execute(args: string[]): Promise<{ newDir: string; message: string }> {
    const { positional } = this.parseOptions(args);

    let targetDir: string;

    if (positional.length === 0) {
      // 引数なしの場合はプロジェクトルートへ
      targetDir = this.getProjectRoot();
    } else {
      const dir = positional[0];

      // 特殊ケース: -（前のディレクトリ）は未実装
      if (dir === '-') {
        throw new Error('cd: OLDPWD not set');
      }

      const baseApp = fsPathToAppPath(this.currentDir, this.projectName);
      const app = pathResolve(baseApp, dir);
      targetDir = toFSPath(this.projectName, app);
    }

    // プロジェクト外への移動を禁止
    if (!this.isWithinProject(targetDir)) {
      throw new Error('cd: Permission denied - Cannot navigate outside project directory');
    }

    // ディレクトリの存在確認
    const exists = await this.exists(targetDir);
    if (!exists) {
      throw new Error(`cd: ${positional[0] || '~'}: No such file or directory`);
    }

    const isDir = await this.isDirectory(targetDir);
    if (!isDir) {
      throw new Error(`cd: ${positional[0]}: Not a directory`);
    }

    return {
      newDir: targetDir,
      message: '',
    };
  }
}
