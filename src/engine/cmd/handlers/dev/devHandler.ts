/**
 * 開発・テスト用コマンドハンドラー
 *
 * `dev` コマンドのメインエントリポイント。
 * サブコマンドを各専門ハンドラーにルーティングする。
 *
 * 使用例:
 *   dev merge-conflict create  - マージコンフリクトシナリオを作成
 *   dev help                   - 利用可能なコマンド一覧を表示
 */

import type { DevCommandContext, DevCommandInfo } from './types';

// サブコマンドのインポート
import { mergeConflictCommands } from './mergeConflictScenario';
import { tabCommands } from './tabScenario';

/**
 * 開発コマンドレジストリ
 */
class DevCommandRegistry {
  private commands: Map<string, DevCommandInfo> = new Map();

  /**
   * コマンドを登録
   */
  register(info: DevCommandInfo): void {
    this.commands.set(info.name, info);
  }

  /**
   * 複数のコマンドを一括登録
   */
  registerAll(infos: DevCommandInfo[]): void {
    for (const info of infos) {
      this.register(info);
    }
  }

  /**
   * コマンドを取得
   */
  get(name: string): DevCommandInfo | undefined {
    return this.commands.get(name);
  }

  /**
   * 全コマンドを取得
   */
  getAll(): DevCommandInfo[] {
    return Array.from(this.commands.values());
  }

  /**
   * コマンドが存在するか確認
   */
  has(name: string): boolean {
    return this.commands.has(name);
  }
}

export const devCommandRegistry = new DevCommandRegistry();

// コマンドを登録
devCommandRegistry.registerAll(mergeConflictCommands);
devCommandRegistry.registerAll(tabCommands);

/**
 * ヘルプコマンド
 */
async function showHelp(context: DevCommandContext): Promise<void> {
  const commands = devCommandRegistry.getAll();

  await context.writeOutput('=== Pyxis Development Commands ===\n');
  await context.writeOutput('Usage: dev <command> [options]\n');
  await context.writeOutput('\nAvailable commands:\n');

  for (const cmd of commands) {
    await context.writeOutput(`  ${cmd.name.padEnd(25)} ${cmd.description}`);
  }

  await context.writeOutput('\nFor detailed usage of a command:');
  await context.writeOutput('  dev <command> --help\n');
}

/**
 * メインハンドラー
 */
export async function handleDevCommand(
  args: string[],
  projectName: string,
  projectId: string,
  writeOutput: (output: string) => Promise<void>
): Promise<void> {
  const context: DevCommandContext = {
    projectName,
    projectId,
    writeOutput,
  };

  // 引数がない場合またはhelpの場合はヘルプを表示
  if (args.length === 0 || args[0] === 'help' || args[0] === '--help' || args[0] === '-h') {
    await showHelp(context);
    return;
  }

  const subCommand = args[0];
  const subArgs = args.slice(1);

  // コマンドを検索
  const commandInfo = devCommandRegistry.get(subCommand);

  if (!commandInfo) {
    await writeOutput(`dev: unknown command '${subCommand}'`);
    await writeOutput('Run "dev help" to see available commands.');
    return;
  }

  // --help オプションの処理
  if (subArgs.includes('--help') || subArgs.includes('-h')) {
    await writeOutput(`${commandInfo.name}: ${commandInfo.description}\n`);
    await writeOutput(`Usage: ${commandInfo.usage}`);
    return;
  }

  // コマンドを実行
  try {
    await commandInfo.handler(subArgs, context);
  } catch (error) {
    await writeOutput(`dev ${subCommand}: ${(error as Error).message}`);
  }
}
