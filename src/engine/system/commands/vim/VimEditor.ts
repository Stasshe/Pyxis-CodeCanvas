import type { IDisposable, Terminal } from '@xterm/xterm';
import { coreError } from '@/engine/core/coreLogger';
import { fsClient } from '@/engine/core/fs/index';
import { displayColumn, renderFrame, type VimMode, verticalCursorPosition } from './render';
import {
  decodeLineEndings,
  errorMessage,
  graphemes,
  isTextInput,
  moveWordPosition,
  nextCodePointOffset,
  nextColumn,
  normalizeColumn,
  parseSubstituteCommand,
  previousColumn,
  substituteLines,
  unsupportedNormalCommandMessage,
} from './text';

export type VimTerminal = Pick<Terminal, 'cols' | 'rows' | 'write' | 'onData' | 'onResize'> & {
  cellWidth(text: string): number;
};
interface Position {
  row: number;
  col: number;
}
interface Snapshot {
  lines: string[];
  cursor: Position;
  endOfLine: boolean;
}
export class VimEditor {
  private readonly term: VimTerminal;
  private readonly fileName: string;
  private readonly absolutePath: string;
  private lines: string[];
  private lineEnding = '\n';
  private endOfLine = false;
  private savedContent: string;
  private cursor: Position = { row: 0, col: 0 };
  private preferredColumn: number | 'MAXCOL' = 0;
  private mode: VimMode = 'NORMAL';
  private modified = false;
  private commandLine = '';
  private message = '';
  private visualStart: Position | null = null;
  private yankBuffer: string[] = [];
  private undoStack: Snapshot[] = [];
  private redoStack: Snapshot[] = [];
  private topLine = 0;
  private leftCol = 0;
  private pending: 'd' | 'y' | 'g' | 'r' | null = null;
  private unsupportedPrefix: string | null = null;
  private searchPattern = '';
  private yankType: 'line' | 'character' = 'line';
  private insertChangeStarted = false;
  private inputSubscription: IDisposable | null = null;
  private resizeSubscription: IDisposable | null = null;
  private onExitCallback: (() => void) | null = null;
  private disposed = false;

  constructor(term: VimTerminal, fileName: string, content: string, absolutePath: string) {
    this.term = term;
    this.fileName = fileName;
    this.absolutePath = absolutePath;
    const { content: normalized, lineEnding } = decodeLineEndings(content);
    this.lineEnding = lineEnding;
    this.endOfLine = content.length > 0;
    this.lines = [''];
    if (normalized) this.lines = normalized.split('\n');
    if (normalized.endsWith('\n')) this.lines.pop();
    if (!this.lines.length) this.lines = [''];
    this.savedContent = this.serialize();
  }

  public start(onExit: () => void): void {
    this.onExitCallback = onExit;
    this.term.write('\x1b[?1049h\x1b[?25l');
    this.inputSubscription = this.term.onData(data => {
      if (this.disposed) return;
      for (const key of this.splitInput(data)) {
        this.handleKey(key);
        if (this.disposed) break;
      }
      this.render();
    });
    this.resizeSubscription = this.term.onResize(() => this.render());
    this.render();
  }

  private handleKey(key: string): void {
    this.message = '';
    if (this.unsupportedPrefix) {
      if (key === '\x1b') this.unsupportedPrefix = null;
      else {
        this.message = this.unsupportedPrefix;
        return;
      }
    }
    if (/^[1-9]$/.test(key) && this.mode !== 'INSERT' && this.mode !== 'COMMAND')
      this.blockUnsupported('Counts are unsupported; press Esc');
    if (this.mode === 'INSERT') {
      this.handleInsert(key);
      return;
    }
    if (this.mode === 'COMMAND') {
      this.handleCommandInput(key);
      return;
    }
    if (this.mode === 'VISUAL') {
      this.handleVisual(key);
      return;
    }
    this.handleNormal(key);
  }

  private splitInput(data: string): string[] {
    const characters = graphemes(data);
    const keys: string[] = [];
    let offset = 0;
    let characterIndex = 0;
    while (offset < data.length) {
      if (data.charCodeAt(offset) === 27) {
        const sequence = data.slice(offset + 1).match(/^(?:\[[0-9;?]*[A-Za-z~]|O[A-Za-z])/);
        if (sequence) {
          keys.push(`${String.fromCharCode(27)}${sequence[0]}`);
          offset += sequence[0].length + 1;
          while (characterIndex < characters.length && characters[characterIndex].end <= offset)
            characterIndex++;
          continue;
        }
      }
      const character = characters[characterIndex].value;
      keys.push(character);
      offset += character.length;
      characterIndex++;
    }
    return keys;
  }

  private handleNormal(key: string): void {
    const pending = this.pending;
    this.pending = null;
    if (pending === 'd' && key === 'd') {
      this.yankType = 'line';
      this.deleteLine();
      return;
    }
    if (pending === 'y' && key === 'y') {
      this.yankBuffer = [this.currentLine()];
      this.yankType = 'line';
      this.message = '1 line yanked';
      return;
    }
    if (pending === 'g' && key === 'g') {
      this.setCursor(0, 0);
      return;
    }
    if (pending === 'r' && isTextInput(key) && this.cursor.col < this.currentLine().length) {
      this.change(() => {
        const line = this.currentLine();
        const next = nextColumn(line, this.cursor.col);
        this.lines[this.cursor.row] = line.slice(0, this.cursor.col) + key + line.slice(next);
      });
      return;
    }
    if (pending) return;
    if (key === '\x12') {
      this.redo();
      return;
    }
    if (key === 'h' || key === '\x1b[D' || key === '\x1bOD') this.moveHorizontal(-1);
    else if (key === 'l' || key === '\x1b[C' || key === '\x1bOC') this.moveHorizontal(1);
    else if (key === 'j' || key === '\x1b[B' || key === '\x1bOB') this.moveVertical(1);
    else if (key === 'k' || key === '\x1b[A' || key === '\x1bOA') this.moveVertical(-1);
    else if (key === 'w') this.moveWord(1);
    else if (key === 'b') this.moveWord(-1);
    else if (key === 'e') this.moveWord(1, true);
    else if (key === '0') this.setCursor(this.cursor.row, 0);
    else if (key === '$') {
      this.setCursor(this.cursor.row, Math.max(0, this.currentLine().length - 1));
      this.preferredColumn = 'MAXCOL';
    } else if (key === 'G') this.setCursor(this.lines.length - 1, 0);
    else if (key === 'g' || key === 'd' || key === 'y') this.pending = key;
    else if (key === 'r') this.pending = 'r';
    else if (key === '"' || key === 'q' || key === '@' || key === 'c' || key === '.') {
      this.blockUnsupported(unsupportedNormalCommandMessage(key));
    } else if (key === 'i') this.enterInsertMode();
    else if (key === 'a') {
      this.cursor.col = nextColumn(this.currentLine(), this.cursor.col);
      this.enterInsertMode();
    } else if (key === 'A') {
      this.cursor.col = this.currentLine().length;
      this.enterInsertMode();
    } else if (key === 'I') {
      const firstNonblank = this.currentLine().search(/\S/);
      this.cursor.col = Math.max(0, firstNonblank);
      this.enterInsertMode();
    } else if (key === 'D') this.deleteToEnd();
    else if (key === 'o') this.openLine(this.cursor.row + 1);
    else if (key === 'O') this.openLine(this.cursor.row);
    else if (key === 'x') this.deleteChar();
    else if (key === 'p') this.paste();
    else if (key === 'u') this.undo();
    else if (key === 'n') this.repeatSearch(1);
    else if (key === 'N') this.repeatSearch(-1);
    else if (key === 'v') {
      this.mode = 'VISUAL';
      this.visualStart = { ...this.cursor };
    } else if (key === ':') {
      this.mode = 'COMMAND';
      this.commandLine = '';
    } else if (key === '/') {
      this.mode = 'COMMAND';
      this.commandLine = '/';
    } else if (key === '\x1b') this.pending = null;
  }

  private handleInsert(key: string): void {
    const previousCursor = { ...this.cursor };
    const isVertical = key === '\x1b[A' || key === '\x1b[B' || key === '\x1bOA' || key === '\x1bOB';
    if (key === '\x1b') {
      this.mode = 'NORMAL';
      this.cursor.col = previousColumn(this.currentLine(), this.cursor.col);
      this.insertChangeStarted = false;
      this.resetPreferredColumn();
    } else if (
      key === '\x1b[A' ||
      key === '\x1b[B' ||
      key === '\x1b[C' ||
      key === '\x1b[D' ||
      key === '\x1bOA' ||
      key === '\x1bOB' ||
      key === '\x1bOC' ||
      key === '\x1bOD'
    ) {
      if (key === '\x1b[A' || key === '\x1bOA') this.moveToVerticalColumn(-1, true);
      else if (key === '\x1b[B' || key === '\x1bOB') this.moveToVerticalColumn(1, true);
      else if (key === '\x1b[C' || key === '\x1bOC')
        this.cursor.col = nextColumn(this.currentLine(), this.cursor.col);
      else this.cursor.col = previousColumn(this.currentLine(), this.cursor.col);
    } else if (key === '\x1b[H' || key === '\x1b[1~') {
      this.cursor.col = 0;
      this.resetPreferredColumn();
    } else if (key === '\x1b[F' || key === '\x1b[4~') {
      this.cursor.col = this.currentLine().length;
      this.resetPreferredColumn();
    } else if (key === '\x1b[3~') {
      if (this.cursor.col < this.currentLine().length) {
        this.beginInsertChange();
        const line = this.currentLine();
        const next = nextColumn(line, this.cursor.col);
        this.lines[this.cursor.row] = line.slice(0, this.cursor.col) + line.slice(next);
        this.updateModified();
      }
    } else if (key === '\r' || key === '\n') {
      this.beginInsertChange();
      const line = this.currentLine();
      this.lines[this.cursor.row] = line.slice(0, this.cursor.col);
      this.lines.splice(this.cursor.row + 1, 0, line.slice(this.cursor.col));
      this.cursor.row++;
      this.cursor.col = 0;
      this.updateModified();
      this.ensureCursorVisible();
    } else if (key === '\t') {
      this.beginInsertChange();
      const line = this.currentLine();
      const updatedLine = line.slice(0, this.cursor.col) + '\t' + line.slice(this.cursor.col);
      this.lines[this.cursor.row] = updatedLine;
      this.cursor.col = normalizeColumn(updatedLine, this.cursor.col + 1, true);
      this.updateModified();
    } else if (key === '\x7f' || key === '\b') {
      if (this.cursor.col > 0) {
        this.beginInsertChange();
        const line = this.currentLine();
        const previous = previousColumn(line, this.cursor.col);
        this.lines[this.cursor.row] = line.slice(0, previous) + line.slice(this.cursor.col);
        this.cursor.col = previous;
        this.updateModified();
      } else if (this.cursor.row > 0) {
        this.beginInsertChange();
        const current = this.currentLine();
        this.cursor.row--;
        this.cursor.col = this.currentLine().length;
        this.lines[this.cursor.row] += current;
        this.lines.splice(this.cursor.row + 1, 1);
        this.updateModified();
      }
      this.ensureCursorVisible();
    } else if (isTextInput(key)) {
      this.beginInsertChange();
      const line = this.currentLine();
      const updatedLine = line.slice(0, this.cursor.col) + key + line.slice(this.cursor.col);
      this.lines[this.cursor.row] = updatedLine;
      this.cursor.col = normalizeColumn(updatedLine, this.cursor.col + key.length, true);
      this.updateModified();
    }
    if (
      !isVertical &&
      (this.cursor.row !== previousCursor.row || this.cursor.col !== previousCursor.col)
    )
      this.resetPreferredColumn();
  }

  private handleVisual(key: string): void {
    if (key === '\x1b') {
      this.mode = 'NORMAL';
      this.visualStart = null;
      this.resetPreferredColumn();
    } else if (key === 'h' || key === '\x1b[D' || key === '\x1bOD') this.moveHorizontal(-1);
    else if (key === 'l' || key === '\x1b[C' || key === '\x1bOC') this.moveHorizontal(1);
    else if (key === 'j' || key === '\x1b[B' || key === '\x1bOB') this.moveVertical(1);
    else if (key === 'k' || key === '\x1b[A' || key === '\x1bOA') this.moveVertical(-1);
    else if (key === 'd' || key === 'x') {
      this.deleteSelection();
      this.mode = 'NORMAL';
      this.visualStart = null;
    } else if (key === 'i' || key === 'a') {
      this.blockUnsupported('Visual text objects are unsupported; press Esc');
    } else if (key === '"' || key === '@') {
      this.blockUnsupported('Registers and macros are unsupported; press Esc');
    } else if (key === 'y') {
      const start = this.visualStart;
      const end = this.cursor;
      let first = end;
      if (start && (start.row < end.row || (start.row === end.row && start.col <= end.col)))
        first = start;
      this.yankSelection();
      this.setCursor(first.row, first.col);
      this.mode = 'NORMAL';
      this.visualStart = null;
    }
  }

  private handleCommandInput(key: string): void {
    if (key === '\x1b') {
      this.mode = 'NORMAL';
      this.commandLine = '';
    } else if (key === '\r' || key === '\n') {
      const command = this.commandLine;
      this.commandLine = '';
      this.mode = 'NORMAL';
      if (command.startsWith('/')) {
        const pattern = command.slice(1);
        if (pattern) this.searchPattern = pattern;
        if (pattern) this.search(1);
        else this.repeatSearch(1);
        return;
      }
      void this.executeCommand(command);
    } else if (key === '\x7f' || key === '\b') {
      if (this.commandLine) {
        const previous = previousColumn(this.commandLine, this.commandLine.length);
        this.commandLine = this.commandLine.slice(0, previous);
      } else this.mode = 'NORMAL';
    } else if (isTextInput(key)) this.commandLine += key;
  }

  private async executeCommand(command: string): Promise<void> {
    const normalizedCommand = command.trimEnd();
    const saveCommand = normalizedCommand.replace(/^(w|wq|x)!$/, '$1');
    if (saveCommand === 'w' || saveCommand === 'wq' || saveCommand === 'x') {
      const shouldExit = saveCommand !== 'w';
      let saved = true;
      if (saveCommand !== 'x' || this.modified) saved = await this.saveFile();
      if (this.disposed) return;
      if (shouldExit && saved && !this.modified) this.exit();
    } else if (normalizedCommand === 'q') {
      if (this.modified) this.message = 'No write since last change (add ! to override)';
      else this.exit();
    } else if (normalizedCommand === 'q!') this.exit();
    else if (/^\d+$/.test(normalizedCommand)) this.setCursor(Number(normalizedCommand) - 1, 0);
    else if (command.startsWith('s/') || command.startsWith('%s/')) this.substitute(command);
    else this.message = `Unknown command: ${normalizedCommand}`;
    if (!this.disposed) this.render();
  }

  private async saveFile(): Promise<boolean> {
    const content = this.serialize();
    try {
      await fsClient.writeFile(this.absolutePath, content);
      if (this.disposed) return false;
      this.savedContent = content;
      this.updateModified();
      this.message = `"${this.fileName}" ${this.lines.length}L written`;
      return true;
    } catch (error) {
      if (this.disposed) return false;
      const detail = errorMessage(error);
      coreError('Vim save failed', this.absolutePath, detail);
      this.message = `Error: ${detail}`;
      return false;
    }
  }

  private blockUnsupported(message: string): void {
    this.unsupportedPrefix = message;
    this.message = message;
  }

  private enterInsertMode(): void {
    this.insertChangeStarted = false;
    this.mode = 'INSERT';
    this.resetPreferredColumn();
  }

  private beginInsertChange(): void {
    if (this.insertChangeStarted) return;
    this.recordUndo();
    this.insertChangeStarted = true;
    this.endOfLine = true;
  }

  private substitute(command: string): void {
    const parsed = parseSubstituteCommand(command);
    if (typeof parsed === 'string') {
      this.message = parsed;
      return;
    }
    let rows = [this.cursor.row];
    if (parsed.wholeFile) rows = this.lines.map((_, index) => index);
    const result = substituteLines(this.lines, rows, parsed.regex, parsed.replacement);
    const { lines: nextLines, count, changed } = result;
    if (changed) {
      this.recordUndo();
      this.lines = nextLines;
      this.cursor.col = normalizeColumn(this.currentLine(), this.cursor.col, false);
      this.endOfLine = true;
      this.updateModified();
      this.resetPreferredColumn();
    }
    this.message = `${count} substitutions`;
  }

  private openLine(row: number): void {
    this.change(() => {
      this.lines.splice(row, 0, '');
      this.cursor = { row, col: 0 };
      this.mode = 'INSERT';
      this.insertChangeStarted = true;
    });
  }

  private deleteChar(): void {
    if (this.cursor.col >= this.currentLine().length) return;
    this.change(() => {
      const line = this.currentLine();
      const next = nextColumn(line, this.cursor.col);
      this.yankBuffer = [line.slice(this.cursor.col, next)];
      this.yankType = 'character';
      this.lines[this.cursor.row] = line.slice(0, this.cursor.col) + line.slice(next);
      this.cursor.col = normalizeColumn(this.currentLine(), this.cursor.col, false);
    });
  }

  private deleteToEnd(): void {
    const line = this.currentLine();
    if (this.cursor.col >= line.length) return;
    this.change(() => {
      this.yankBuffer = [line.slice(this.cursor.col)];
      this.yankType = 'character';
      this.lines[this.cursor.row] = line.slice(0, this.cursor.col);
      this.cursor.col = previousColumn(line, this.cursor.col);
    });
  }

  private deleteLine(): void {
    this.change(() => {
      this.yankBuffer = [this.currentLine()];
      if (this.lines.length === 1) this.lines = [''];
      else this.lines.splice(this.cursor.row, 1);
      this.cursor.row = Math.min(this.cursor.row, this.lines.length - 1);
      this.cursor.col = 0;
    });
    if (this.lines.length === 1 && this.lines[0] === '') {
      this.endOfLine = false;
      this.updateModified();
    }
  }

  private paste(): void {
    if (!this.yankBuffer.length) return;
    if (this.yankType === 'character') {
      this.change(() => {
        const line = this.currentLine();
        const offset = Math.min(line.length, nextColumn(line, this.cursor.col));
        const text = this.yankBuffer.join('\n');
        const pasted = `${line.slice(0, offset)}${text}${line.slice(offset)}`.split('\n');
        this.lines.splice(this.cursor.row, 1, ...pasted);
        this.cursor.col = offset;
        if (pasted.length === 1 && text.length > 0) {
          this.cursor.col = offset + previousColumn(text, text.length);
        }
      });
      return;
    }
    this.change(() => {
      this.lines.splice(this.cursor.row + 1, 0, ...this.yankBuffer);
      this.cursor.row++;
      this.cursor.col = 0;
    });
  }

  private deleteSelection(): void {
    if (!this.visualStart) return;
    const start = this.visualStart;
    const end = this.cursor;
    const forward = start.row < end.row || (start.row === end.row && start.col <= end.col);
    let first = end;
    let last = start;
    if (forward) {
      first = start;
      last = end;
    }
    this.change(() => {
      const firstLine = this.lines[first.row];
      const lastLine = this.lines[last.row];
      const lastEnd = nextColumn(lastLine, last.col);
      const selected = [firstLine.slice(first.col)];
      if (first.row !== last.row) {
        for (let row = first.row + 1; row < last.row; row++) selected.push(this.lines[row]);
        selected.push(lastLine.slice(0, lastEnd));
      } else selected[0] = firstLine.slice(first.col, lastEnd);
      this.yankBuffer = [selected.join('\n')];
      this.yankType = 'character';
      this.lines.splice(
        first.row,
        last.row - first.row + 1,
        firstLine.slice(0, first.col) + lastLine.slice(lastEnd)
      );
      this.cursor = {
        row: first.row,
        col: normalizeColumn(this.lines[first.row], first.col, false),
      };
    });
  }

  private yankSelection(): void {
    if (!this.visualStart) return;
    const start = this.visualStart;
    const end = this.cursor;
    const forward = start.row < end.row || (start.row === end.row && start.col <= end.col);
    let first = end;
    let last = start;
    if (forward) {
      first = start;
      last = end;
    }
    const lastEnd = nextColumn(this.lines[last.row], last.col);
    const selected = [this.lines[first.row].slice(first.col)];
    if (first.row !== last.row) {
      for (let row = first.row + 1; row < last.row; row++) selected.push(this.lines[row]);
      selected.push(this.lines[last.row].slice(0, lastEnd));
    } else selected[0] = this.lines[first.row].slice(first.col, lastEnd);
    this.yankBuffer = [selected.join('\n')];
    this.yankType = 'character';
    this.message = 'yanked';
  }

  private change(operation: () => void): void {
    this.recordUndo();
    operation();
    this.endOfLine = true;
    this.updateModified();
    this.ensureCursorVisible();
    this.resetPreferredColumn();
  }

  private recordUndo(): void {
    this.undoStack.push({
      lines: [...this.lines],
      cursor: { ...this.cursor },
      endOfLine: this.endOfLine,
    });
    if (this.undoStack.length > 100) this.undoStack.shift();
    this.redoStack = [];
  }

  private undo(): void {
    const previous = this.undoStack.pop();
    if (!previous) {
      this.message = 'Already at oldest change';
      return;
    }
    this.redoStack.push({
      lines: [...this.lines],
      cursor: { ...this.cursor },
      endOfLine: this.endOfLine,
    });
    this.restore(previous);
  }

  private redo(): void {
    const next = this.redoStack.pop();
    if (!next) {
      this.message = 'Already at newest change';
      return;
    }
    this.undoStack.push({
      lines: [...this.lines],
      cursor: { ...this.cursor },
      endOfLine: this.endOfLine,
    });
    this.restore(next);
  }

  private restore(snapshot: Snapshot): void {
    this.lines = snapshot.lines;
    this.cursor = { ...snapshot.cursor };
    this.endOfLine = snapshot.endOfLine;
    this.updateModified();
    this.ensureCursorVisible();
    this.resetPreferredColumn();
  }

  private moveHorizontal(delta: number): void {
    const line = this.currentLine();
    const previous = this.cursor.col;
    if (delta > 0) {
      const next = nextColumn(line, this.cursor.col);
      if (next < line.length) this.cursor.col = next;
    } else {
      this.cursor.col = previousColumn(line, this.cursor.col);
    }
    if (this.cursor.col !== previous) this.resetPreferredColumn();
  }

  private moveVertical(delta: number): void {
    this.moveToVerticalColumn(delta, false);
  }

  private moveToVerticalColumn(delta: number, allowEnd: boolean): void {
    this.cursor = verticalCursorPosition(
      this.lines,
      this.cursor.row,
      delta,
      this.preferredColumn,
      text => this.term.cellWidth(text),
      allowEnd
    );
    this.ensureCursorVisible();
  }

  private moveWord(delta: number, toEnd = false): void {
    const position = moveWordPosition(this.lines, this.cursor, delta, toEnd);
    this.setCursor(position.row, position.col);
  }

  private setCursor(row: number, col: number): void {
    this.cursor.row = Math.max(0, Math.min(this.lines.length - 1, row));
    this.cursor.col = normalizeColumn(this.currentLine(), col, false);
    this.ensureCursorVisible();
    this.resetPreferredColumn();
  }

  private resetPreferredColumn(): void {
    this.preferredColumn = displayColumn(this.currentLine(), this.cursor.col, text =>
      this.term.cellWidth(text)
    );
  }

  private currentLine(): string {
    return this.lines[this.cursor.row] ?? '';
  }

  private updateModified(): void {
    this.modified = this.serialize() !== this.savedContent;
  }

  private serialize(): string {
    if (!this.endOfLine && this.lines.length === 1 && this.lines[0] === '') return '';
    const content = this.lines.join(this.lineEnding);
    if (!this.endOfLine) return content;
    return `${content}${this.lineEnding}`;
  }

  private repeatSearch(direction: number): void {
    if (!this.searchPattern) {
      this.message = 'No previous search pattern';
      return;
    }
    this.search(direction);
  }

  private search(direction: number): void {
    if (!this.searchPattern) return;
    let regex: RegExp;
    try {
      regex = new RegExp(this.searchPattern, 'gu');
    } catch (error) {
      this.message = `Invalid pattern: ${errorMessage(error)}`;
      return;
    }
    const positions: Position[] = [];
    this.lines.forEach((line, row) => {
      regex.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = regex.exec(line)) !== null) {
        positions.push({ row, col: normalizeColumn(line, match.index, false) });
        if (match[0].length === 0) {
          if (match.index === line.length) break;
          regex.lastIndex = nextCodePointOffset(line, match.index);
        }
      }
    });
    if (!positions.length) {
      this.message = 'Pattern not found';
      return;
    }
    let offset = -1;
    for (let index = 0; index < positions.length; index++) {
      let positionIndex = index;
      if (direction < 0) positionIndex = positions.length - index - 1;
      const position = positions[positionIndex];
      const isAfterCursor =
        position.row > this.cursor.row ||
        (position.row === this.cursor.row && position.col > this.cursor.col);
      const isBeforeCursor =
        position.row < this.cursor.row ||
        (position.row === this.cursor.row && position.col < this.cursor.col);
      if ((direction > 0 && isAfterCursor) || (direction < 0 && isBeforeCursor)) {
        offset = positionIndex;
        break;
      }
    }
    let index = offset;
    if (offset === -1) {
      index = positions.length - 1;
      if (direction > 0) index = 0;
    }
    this.setCursor(positions[index].row, positions[index].col);
    this.message = `${positions.length} matches`;
  }

  private ensureCursorVisible(): void {
    const height = Math.max(1, this.term.rows - 2);
    if (this.cursor.row < this.topLine) this.topLine = this.cursor.row;
    else if (this.cursor.row >= this.topLine + height) this.topLine = this.cursor.row - height + 1;
  }

  private render(): void {
    if (this.disposed) return;
    this.ensureCursorVisible();
    const frame = renderFrame({
      lines: this.lines,
      cursor: this.cursor,
      topLine: this.topLine,
      leftCol: this.leftCol,
      rows: this.term.rows,
      cols: this.term.cols,
      mode: this.mode,
      visualStart: this.visualStart,
      fileName: this.fileName,
      modified: this.modified,
      commandLine: this.commandLine,
      message: this.message,
      cellWidth: text => this.term.cellWidth(text),
    });
    this.topLine = frame.topLine;
    this.leftCol = frame.leftCol;
    this.term.write(frame.output);
  }

  private exit(): void {
    if (this.disposed) return;
    this.dispose();
    this.onExitCallback?.();
    this.onExitCallback = null;
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.inputSubscription?.dispose();
    this.inputSubscription = null;
    this.resizeSubscription?.dispose();
    this.resizeSubscription = null;
    this.term.write('\x1b[?25h\x1b[?1049l');
  }

  public pressEsc(): void {
    if (this.disposed) return;
    if (this.mode === 'INSERT') this.handleInsert('\x1b');
    else if (this.mode === 'VISUAL') this.resetPreferredColumn();
    this.mode = 'NORMAL';
    this.commandLine = '';
    this.visualStart = null;
    this.pending = null;
    this.unsupportedPrefix = null;
    this.insertChangeStarted = false;
    this.render();
  }
}
