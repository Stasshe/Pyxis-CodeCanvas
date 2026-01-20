/**
 * 開発・テスト用コマンドの型定義
 */

/**
 * 開発コマンドのコンテキスト
 */
export interface DevCommandContext {
  projectName: string;
  projectId: string;
  writeOutput: (output: string) => Promise<void>;
}

/**
 * 開発コマンドハンドラーの型
 */
export type DevCommandHandler = (
  args: string[],
  context: DevCommandContext
) => Promise<void>;

/**
 * 開発コマンドの登録情報
 */
export interface DevCommandInfo {
  name: string;
  description: string;
  usage: string;
  handler: DevCommandHandler;
}
