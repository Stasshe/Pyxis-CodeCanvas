/**
 * Command Registry
 * 拡張機能が追加するカスタムコマンドを管理
 */

/**
 * コマンド実行時のコンテキスト
 *
 * Terminal側から渡される基本情報のみを含む
 * 実際にはExtensionManagerでExtensionContext全体とマージされる
 */
export interface CommandContext {
  /** プロジェクト名 */
  projectName: string;

  /** プロジェクトID (IndexedDB参照用) */
  projectId: string;

  /** 現在のディレクトリ (絶対パス) */
  currentDirectory: string;

  /** ExtensionManagerによって拡張された追加プロパティ */
  [key: string]: any;
}

/**
 * コマンドハンドラー
 */
export type CommandHandler = (args: string[], context: CommandContext) => Promise<string>;

/**
 * 登録されたコマンド情報
 */
interface RegisteredCommand {
  extensionId: string;
  handler: CommandHandler;
}

/**
 * Command Registry
 * 拡張機能からターミナルコマンドを動的に登録・実行
 */
export class CommandRegistry {
  /** 登録されたコマンド (commandName -> RegisteredCommand) */
  private commands: Map<string, RegisteredCommand> = new Map();

  /**
   * コマンドを登録
   * @returns アンサブスクライブ関数
   */
  registerCommand(extensionId: string, commandName: string, handler: CommandHandler): () => void {
    if (this.commands.has(commandName)) {
      const existing = this.commands.get(commandName);
      console.warn(
        `[CommandRegistry] Command "${commandName}" already registered by extension "${existing?.extensionId}". Overwriting...`
      );
    }

    this.commands.set(commandName, { extensionId, handler });
    console.log(`[CommandRegistry] Command "${commandName}" registered by "${extensionId}"`);

    // アンサブスクライブ関数を返す
    return () => {
      this.unregisterCommand(commandName);
    };
  }

  /**
   * コマンドを登録解除
   */
  unregisterCommand(commandName: string): void {
    const removed = this.commands.delete(commandName);
    if (removed) {
      console.log(`[CommandRegistry] Command "${commandName}" unregistered`);
    }
  }

  /**
   * 拡張機能が登録した全コマンドを削除
   */
  unregisterExtensionCommands(extensionId: string): void {
    const toRemove: string[] = [];

    for (const [commandName, registered] of this.commands.entries()) {
      if (registered.extensionId === extensionId) {
        toRemove.push(commandName);
      }
    }

    for (const commandName of toRemove) {
      this.unregisterCommand(commandName);
    }

    if (toRemove.length > 0) {
      console.log(
        `[CommandRegistry] Unregistered ${toRemove.length} commands from extension "${extensionId}"`
      );
    }
  }

  /**
   * コマンドを実行
   */
  async executeCommand(
    commandName: string,
    args: string[],
    context: CommandContext
  ): Promise<string> {
    const registered = this.commands.get(commandName);

    if (!registered) {
      throw new Error(`Command "${commandName}" is not registered`);
    }

    try {
      console.log(
        `[CommandRegistry] Executing command "${commandName}" from extension "${registered.extensionId}"`
      );
      return await registered.handler(args, context);
    } catch (error) {
      console.error(`[CommandRegistry] Error executing command "${commandName}":`, error);
      throw error;
    }
  }

  /**
   * コマンドが登録されているか確認
   */
  hasCommand(commandName: string): boolean {
    return this.commands.has(commandName);
  }

  /**
   * 登録されている全コマンド名を取得
   */
  getRegisteredCommands(): string[] {
    return Array.from(this.commands.keys());
  }

  /**
   * 登録されているコマンドの詳細情報を取得
   */
  getCommandInfo(): Array<{ command: string; extensionId: string }> {
    return Array.from(this.commands.entries()).map(([command, registered]) => ({
      command,
      extensionId: registered.extensionId,
    }));
  }
}

/**
 * グローバルインスタンス
 */
export const commandRegistry = new CommandRegistry();
