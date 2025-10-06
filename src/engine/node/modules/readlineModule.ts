/**
 * [NEW ARCHITECTURE] readline モジュールのエミュレーション
 *
 * ## 動作モード
 * 1. Terminal経由でnodeコマンドで実行: Terminalの入力インターフェースを使用
 * 2. RunPanel経由で実行: DebugConsoleAPIを使用
 *
 * onInput callbackが渡された場合はそれを優先的に使用
 */

interface ReadlineOptions {
  input?: any;
  output?: any;
  terminal?: boolean;
  prompt?: string;
  onInput?: (prompt: string, callback: (input: string) => void) => void;
}

class Interface {
  private input: any;
  private output: any;
  private terminal: boolean;
  private promptStr: string = '> ';
  private listeners: { [event: string]: Function[] } = {};
  private closed: boolean = false;
  private history: string[] = [];
  private onInput?: (prompt: string, callback: (input: string) => void) => void;

  constructor(options: ReadlineOptions) {
    this.input = options.input;
    this.output = options.output;
    this.terminal = options.terminal ?? false;
    this.onInput = options.onInput;

    if (options.prompt) {
      this.promptStr = options.prompt;
    }
  }

  on(event: string, listener: Function): this {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    this.listeners[event].push(listener);
    return this;
  }

  once(event: string, listener: Function): this {
    const onceWrapper = (...args: any[]) => {
      listener(...args);
      this.removeListener(event, onceWrapper);
    };
    return this.on(event, onceWrapper);
  }

  emit(event: string, ...args: any[]): boolean {
    const listeners = this.listeners[event];
    if (listeners && listeners.length > 0) {
      for (const listener of listeners) {
        try {
          listener(...args);
        } catch (error) {
          console.error('Error in event listener:', error);
        }
      }
      return true;
    }
    return false;
  }

  removeListener(event: string, listener: Function): this {
    const listeners = this.listeners[event];
    if (listeners) {
      const index = listeners.indexOf(listener);
      if (index !== -1) {
        listeners.splice(index, 1);
      }
    }
    return this;
  }

  question(query: string, callback?: (answer: string) => void): Promise<string> {
    return new Promise(resolve => {
      // プロンプトを表示
      if (this.output && this.output.write) {
        this.output.write(query);
      }

      // onInput callbackが渡されている場合はそれを使用
      if (this.onInput) {
        this.onInput(query, (answer: string) => {
          if (answer) {
            this.history.push(answer);
          }
          if (callback) callback(answer);
          resolve(answer);
        });
      } else {
        // lineイベントを待つ
        const onLine = (answer: string) => {
          this.removeListener('line', onLine);
          if (answer) {
            this.history.push(answer);
          }
          if (callback) callback(answer);
          resolve(answer);
        };
        this.on('line', onLine);
      }
    });
  }

  setPrompt(prompt: string): void {
    this.promptStr = prompt;
  }

  prompt(preserveCursor?: boolean): void {
    if (!this.closed && this.output && this.output.write) {
      this.output.write(this.promptStr);
    }
  }

  write(data: string): void {
    if (!this.closed && this.output && this.output.write) {
      this.output.write(data);
    }
  }

  pause(): this {
    return this;
  }

  resume(): this {
    return this;
  }

  close(): void {
    if (!this.closed) {
      this.closed = true;
      this.emit('close');
    }
  }

  getHistory(): string[] {
    return [...this.history];
  }

  clearHistory(): void {
    this.history = [];
  }
}

const cursorTo = (stream: any, x: number, y?: number): boolean => {
  if (!stream || !stream.write) return false;

  if (y !== undefined) {
    stream.write(`\x1b[${y + 1};${x + 1}H`);
  } else {
    stream.write(`\x1b[${x + 1}G`);
  }
  return true;
};

const moveCursor = (stream: any, dx: number, dy: number): boolean => {
  if (!stream || !stream.write) return false;

  if (dy !== 0) stream.write(`\x1b[${Math.abs(dy)}${dy > 0 ? 'B' : 'A'}`);
  if (dx !== 0) stream.write(`\x1b[${Math.abs(dx)}${dx > 0 ? 'C' : 'D'}`);
  return true;
};

const clearLine = (stream: any, dir: number = 0): boolean => {
  if (!stream || !stream.write) return false;

  if (dir < 0) stream.write('\x1b[1K');
  else if (dir > 0) stream.write('\x1b[0K');
  else stream.write('\x1b[2K');
  return true;
};

const clearScreenDown = (stream: any): boolean => {
  if (!stream || !stream.write) return false;

  stream.write('\x1b[0J');
  return true;
};

export function createReadlineModule(
  onInput?: (prompt: string, callback: (input: string) => void) => void
) {
  return {
    createInterface: (options: ReadlineOptions): Interface => {
      // onInputが渡されている場合は優先的に使用
      if (onInput && !options.onInput) {
        options.onInput = onInput;
      }
      return new Interface(options);
    },
    Interface: Interface,
    cursorTo,
    moveCursor,
    clearLine,
    clearScreenDown,
  };
}
