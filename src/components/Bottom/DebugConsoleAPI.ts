// DebugConsoleAPI.ts
// DebugConsoleと連携するグローバルAPI

export type DebugConsoleInputCallback = (input: string) => void;

class DebugConsoleAPIClass {
  private logListeners: ((msg: string) => void)[] = [];
  private inputListeners: DebugConsoleInputCallback[] = [];

  // DebugConsole側から呼ばれる
  _emitLog(msg: string) {
    this.logListeners.forEach(fn => fn(msg));
  }
  _emitInput(input: string) {
    this.inputListeners.forEach(fn => fn(input));
  }

  // 外部API
  log(msg: string) {
    this._emitLog(msg);
  }
  onInput(cb: DebugConsoleInputCallback) {
    this.inputListeners.push(cb);
    return () => {
      this.inputListeners = this.inputListeners.filter(f => f !== cb);
    };
  }
  removeInputListener(cb: DebugConsoleInputCallback) {
    this.inputListeners = this.inputListeners.filter(f => f !== cb);
  }
  // DebugConsoleがxtermインスタンスを渡す
  onLog(fn: (msg: string) => void) {
    this.logListeners.push(fn);
    return () => {
      this.logListeners = this.logListeners.filter(f => f !== fn);
    };
  }
}

export const DebugConsoleAPI = new DebugConsoleAPIClass();
