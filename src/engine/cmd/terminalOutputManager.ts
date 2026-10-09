import { ANSI } from './terminalUI';

export interface IXTermInstance {
  cols: number;
  write(data: string, callback?: () => void): void;
  buffer: {
    active: {
      cursorX: number;
      cursorY: number;
    };
  };
}

export class TerminalOutputManager {
  private lastCharacterWasCarriageReturn = false;

  constructor(private readonly term: IXTermInstance) {}

  get columns(): number {
    return this.term.cols;
  }

  private normalizeLineEndings(text: string): string {
    let normalized = '';
    let previousWasCarriageReturn = this.lastCharacterWasCarriageReturn;

    for (const character of text) {
      if (character === '\n' && !previousWasCarriageReturn) normalized += '\r\n';
      else normalized += character;
      previousWasCarriageReturn = character === '\r';
    }

    if (text) this.lastCharacterWasCarriageReturn = text.endsWith('\r');
    return normalized;
  }

  private writeData(data: string): Promise<void> {
    return new Promise(resolve => this.term.write(data, resolve));
  }

  write(text: string): Promise<void> {
    return this.writeData(this.normalizeLineEndings(text));
  }

  writeln(text: string): Promise<void> {
    return this.write(`${text}\n`);
  }

  writeRaw(data: string): Promise<void> {
    if (data) this.lastCharacterWasCarriageReturn = data.endsWith('\r');
    return this.writeData(data);
  }

  async writeError(text: string): Promise<void> {
    await this.write(`${ANSI.FG.RED}${text}${ANSI.RESET}`);
  }

  async writeWarning(text: string): Promise<void> {
    await this.write(`${ANSI.FG.YELLOW}${text}${ANSI.RESET}`);
  }

  async writeSuccess(text: string): Promise<void> {
    await this.write(`${ANSI.FG.GREEN}${text}${ANSI.RESET}`);
  }

  async writeInfo(text: string): Promise<void> {
    await this.write(`${ANSI.FG.CYAN}${text}${ANSI.RESET}`);
  }

  async writeDim(text: string): Promise<void> {
    await this.write(`${ANSI.FG.GRAY}${text}${ANSI.RESET}`);
  }

  async ensureNewline(): Promise<void> {
    await this.flush();
    if (this.term.buffer.active.cursorX !== 0) await this.write('\n');
  }

  getCursorState(): { atLineStart: boolean; x: number; y: number } {
    const { cursorX, cursorY } = this.term.buffer.active;
    return { atLineStart: cursorX === 0, x: cursorX, y: cursorY };
  }

  flush(): Promise<void> {
    return this.writeData('');
  }
}

export default TerminalOutputManager;
