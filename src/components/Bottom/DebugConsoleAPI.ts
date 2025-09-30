// DebugConsoleAPI.ts
// DebugConsoleと連携するグローバルAPI

export type DebugConsoleInputCallback = (input: string) => void;
export type DebugConsoleActionCallback = (action: TerminalAction) => void;

// ターミナルアクション定義
export interface TerminalAction {
  type:
    | 'log'
    | 'clear'
    | 'clearLine'
    | 'write'
    | 'writeln'
    | 'moveCursor'
    | 'deleteLines'
    | 'insertLines'
    | 'setTitle'
    | 'bell';
  data?: any;
}

class DebugConsoleAPIClass {
  private logListeners: ((msg: string) => void)[] = [];
  private actionListeners: DebugConsoleActionCallback[] = [];
  private inputListeners: DebugConsoleInputCallback[] = [];

  // DebugConsole側から呼ばれる
  _emitLog(msg: string) {
    this.logListeners.forEach(fn => fn(msg));
  }
  _emitAction(action: TerminalAction) {
    this.actionListeners.forEach(fn => fn(action));
  }
  _emitInput(input: string) {
    this.inputListeners.forEach(fn => fn(input));
  }

  // === 基本的なログ出力（従来通り、\x1bエスケープシーケンス対応） ===
  log(msg: string) {
    this._emitLog(msg);
  }

  // === ターミナル制御コマンド ===

  // 画面をクリア
  clear() {
    this._emitAction({ type: 'clear' });
  }

  // 現在行をクリア
  clearLine() {
    this._emitAction({ type: 'clearLine' });
  }

  // 改行なしで文字列を出力
  write(text: string) {
    this._emitAction({ type: 'write', data: text });
  }

  // 改行ありで文字列を出力
  writeln(text: string) {
    this._emitAction({ type: 'writeln', data: text });
  }

  // カーソルを移動（相対位置）
  moveCursor(deltaX: number, deltaY: number) {
    this._emitAction({ type: 'moveCursor', data: { deltaX, deltaY } });
  }

  // カーソルを絶対位置に移動
  setCursorPosition(x: number, y: number) {
    this._emitAction({ type: 'moveCursor', data: { x, y, absolute: true } });
  }

  // 指定した行数を削除
  deleteLines(count: number = 1) {
    this._emitAction({ type: 'deleteLines', data: count });
  }

  // 指定した行数を挿入
  insertLines(count: number = 1) {
    this._emitAction({ type: 'insertLines', data: count });
  }

  // ターミナルのタイトルを設定
  setTitle(title: string) {
    this._emitAction({ type: 'setTitle', data: title });
  }

  // ベル音を鳴らす
  bell() {
    this._emitAction({ type: 'bell' });
  }

  // === 色付きテキスト出力のヘルパー ===

  // 成功メッセージ（緑色）
  success(msg: string) {
    this.writeln(`\x1b[32m✓ ${msg}\x1b[0m`);
  }

  // エラーメッセージ（赤色）
  error(msg: string) {
    this.writeln(`\x1b[31m✗ ${msg}\x1b[0m`);
  }

  // 警告メッセージ（黄色）
  warn(msg: string) {
    this.writeln(`\x1b[33m⚠ ${msg}\x1b[0m`);
  }

  // 情報メッセージ（青色）
  info(msg: string) {
    this.writeln(`\x1b[34mℹ ${msg}\x1b[0m`);
  }

  // デバッグメッセージ（マゼンタ）
  debug(msg: string) {
    this.writeln(`\x1b[35m[DEBUG] ${msg}\x1b[0m`);
  }

  // === プログレスバー ===

  // プログレスバーを表示
  progress(percentage: number, width: number = 50, label?: string) {
    const filled = Math.floor((percentage / 100) * width);
    const empty = width - filled;
    const bar = '█'.repeat(filled) + '░'.repeat(empty);
    const text = label ? `${label} ` : '';
    this.write(`\r${text}[${bar}] ${percentage.toFixed(1)}%`);
  }

  // プログレスバーを完了して改行
  progressComplete(label?: string) {
    const text = label ? `${label} ` : '';
    this.writeln(`\r${text}[█████████████████████████████████████████████████████] 100.0% ✓`);
  }

  // === リスナー管理 ===

  onInput(cb: DebugConsoleInputCallback) {
    this.inputListeners.push(cb);
    return () => {
      this.inputListeners = this.inputListeners.filter(f => f !== cb);
    };
  }

  removeInputListener(cb: DebugConsoleInputCallback) {
    this.inputListeners = this.inputListeners.filter(f => f !== cb);
  }

  // DebugConsoleがxtermインスタンスを渡す（後方互換性のため残す）
  onLog(fn: (msg: string) => void) {
    this.logListeners.push(fn);
    return () => {
      this.logListeners = this.logListeners.filter(f => f !== fn);
    };
  }

  // 新しいアクション型リスナー
  onAction(fn: DebugConsoleActionCallback) {
    this.actionListeners.push(fn);
    return () => {
      this.actionListeners = this.actionListeners.filter(f => f !== fn);
    };
  }
}

export const DebugConsoleAPI = new DebugConsoleAPIClass();
