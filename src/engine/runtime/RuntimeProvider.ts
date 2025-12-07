/**
 * Runtime Provider Interface
 *
 * ランタイムの抽象インターフェース
 * - 各言語ランタイム（Node.js、Python等）はこのインターフェースを実装
 * - 拡張可能で体系的な設計
 * - メモリリーク防止を最優先
 */

/**
 * ランタイム実行オプション
 */
export interface RuntimeExecutionOptions {
  /** プロジェクトID */
  projectId: string;
  /** プロジェクト名 */
  projectName: string;
  /** 実行するファイルのパス */
  filePath: string;
  /** コマンドライン引数 */
  argv?: string[];
  /** デバッグコンソール */
  debugConsole?: {
    log: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    clear: () => void;
  };
  /** 入力コールバック（readline等） */
  onInput?: (prompt: string, callback: (input: string) => void) => void;
  /** ターミナル幅 */
  terminalColumns?: number;
  /** ターミナル高さ */
  terminalRows?: number;
}

/**
 * ランタイム実行結果
 */
export interface RuntimeExecutionResult {
  /** 標準出力 */
  stdout?: string;
  /** 標準エラー出力 */
  stderr?: string;
  /** 実行結果（REPLモード用） */
  result?: unknown;
  /** 終了コード */
  exitCode?: number;
}

/**
 * ランタイムプロバイダーインターフェース
 *
 * すべてのランタイム（Node.js、Python、その他言語）はこのインターフェースを実装する
 */
export interface RuntimeProvider {
  /**
   * ランタイムの識別子（例: "nodejs", "python"）
   */
  readonly id: string;

  /**
   * ランタイムの表示名（例: "Node.js", "Python"）
   */
  readonly name: string;

  /**
   * サポートするファイル拡張子のリスト
   */
  readonly supportedExtensions: string[];

  /**
   * ファイルがこのランタイムで実行可能か判定
   */
  canExecute(filePath: string): boolean;

  /**
   * ランタイムの初期化
   * - プロジェクト切り替え時に呼ばれる
   * - 必要なリソースの準備（例: Pyodideの初期化）
   */
  initialize?(projectId: string, projectName: string): Promise<void>;

  /**
   * ファイルを実行
   * - メモリリークを起こさないよう注意
   * - キャッシュ戦略を適切に使用
   */
  execute(options: RuntimeExecutionOptions): Promise<RuntimeExecutionResult>;

  /**
   * コードスニペットを実行（REPLモード）
   * - 一時的なコード実行用
   */
  executeCode?(code: string, options: RuntimeExecutionOptions): Promise<RuntimeExecutionResult>;

  /**
   * キャッシュをクリア
   * - メモリリーク防止のため定期的に呼ばれる
   */
  clearCache?(): void;

  /**
   * ランタイムのクリーンアップ
   * - プロジェクト切り替え時やアンマウント時に呼ばれる
   */
  dispose?(): Promise<void>;

  /**
   * ランタイムが準備完了しているか
   */
  isReady?(): boolean;
}

/**
 * トランスパイラープロバイダーインターフェース
 *
 * TypeScript、JSX等のトランスパイルが必要な言語用
 */
export interface TranspilerProvider {
  /**
   * トランスパイラーの識別子
   */
  readonly id: string;

  /**
   * サポートするファイル拡張子
   */
  readonly supportedExtensions: string[];

  /**
   * トランスパイルが必要か判定
   */
  needsTranspile(filePath: string, content?: string): boolean;

  /**
   * コードをトランスパイル
   */
  transpile(code: string, options: {
    filePath: string;
    isTypeScript?: boolean;
    isESModule?: boolean;
    isJSX?: boolean;
  }): Promise<{
    code: string;
    map?: string;
    dependencies?: string[];
  }>;
}
