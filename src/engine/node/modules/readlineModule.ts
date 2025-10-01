/**
 * [NEW ARCHITECTURE] readline モジュールのエミュレーション
 */

class Interface {
  private input: any;
  private output: any;
  private terminal: boolean;
  private promptStr: string = '> ';
  private listeners: { [event: string]: Function[] } = {};
  private closed: boolean = false;
  private lineBuffer: string = '';
  private historyIndex: number = -1;
  private history: string[] = [];

  constructor(options: any) {
    this.input = options.input;
    this.output = options.output;
    this.terminal = options.terminal ?? false;
    if (options.prompt) {
      this.promptStr = options.prompt;
    }

    if (this.input && this.input.on) {
      this.input.on('data', (data: any) => {
        this.handleInput(data.toString());
      });
    }
  }

  private handleInput(data: string): void {
    if (this.closed) return;

    for (const char of data) {
      if (char === '\n' || char === '\r') {
        this.emit('line', this.lineBuffer);
        if (this.lineBuffer) {
          this.history.push(this.lineBuffer);
          this.historyIndex = this.history.length;
        }
        this.lineBuffer = '';
        if (this.output) {
          this.output.write('\n');
        }
      } else if (char === '\x7f' || char === '\b') {
        if (this.lineBuffer.length > 0) {
          this.lineBuffer = this.lineBuffer.slice(0, -1);
          if (this.output) {
            this.output.write('\b \b');
          }
        }
      } else {
        this.lineBuffer += char;
        if (this.output) {
          this.output.write(char);
        }
      }
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
    if (listeners) {
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

  question(query: string, callback?: Function): Promise<string> {
    return new Promise(resolve => {
      if (this.output) {
        this.output.write(query);
      }

      const onLine = (answer: string) => {
        this.removeListener('line', onLine);
        if (callback) callback(answer);
        resolve(answer);
      };

      this.on('line', onLine);
    });
  }

  setPrompt(prompt: string): void {
    this.promptStr = prompt;
  }

  prompt(preserveCursor?: boolean): void {
    if (this.output && !this.closed) {
      this.output.write(this.promptStr);
    }
  }

  write(data: string): void {
    if (this.output && !this.closed) {
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
    this.historyIndex = -1;
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

export function createReadlineModule() {
  return {
    createInterface: (options: any): Interface => {
      return new Interface(options);
    },
    Interface: Interface,
    cursorTo,
    moveCursor,
    clearLine,
    clearScreenDown,
    question: (query: string): Promise<string> => {
      return new Promise(resolve => {
        console.log(query);
        setTimeout(() => {
          resolve('');
        }, 0);
      });
    },
  };
}
