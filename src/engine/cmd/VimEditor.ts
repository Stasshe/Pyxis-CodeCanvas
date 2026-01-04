import { fileRepository } from '@/engine/core/fileRepository';
import type { Terminal } from '@xterm/xterm';

type VimMode = 'NORMAL' | 'INSERT' | 'VISUAL' | 'COMMAND';

interface VimState {
  mode: VimMode;
  cursorRow: number;
  cursorCol: number;
  lines: string[];
  modified: boolean;
  fileName: string;
  projectId: string;
  relativePath: string;
  commandLine: string;
  message: string;
  visualStart: { row: number; col: number } | null;
  yankBuffer: string[];
  undoStack: { lines: string[]; cursor: { row: number; col: number } }[];
  redoStack: { lines: string[]; cursor: { row: number; col: number } }[];
  searchPattern: string;
  searchMatches: { row: number; col: number }[];
  currentSearchIndex: number;
}

export class VimEditor {
  private term: Terminal;
  private state: VimState;
  private onExitCallback: (() => void) | null = null;
  private disposed = false;
  private keyHandler: ((e: { key: string; domEvent: KeyboardEvent }) => void) | null = null;
  private topLine = 0; // スクロール位置（表示開始行）

  constructor(
    term: Terminal,
    fileName: string,
    content: string,
    projectId: string,
    relativePath: string
  ) {
    this.term = term;
    this.state = {
      mode: 'NORMAL',
      cursorRow: 0,
      cursorCol: 0,
      lines: content ? content.split('\n') : [''],
      modified: false,
      fileName,
      projectId,
      relativePath,
      commandLine: '',
      message: '',
      visualStart: null,
      yankBuffer: [],
      undoStack: [],
      redoStack: [],
      searchPattern: '',
      searchMatches: [],
      currentSearchIndex: -1,
    };
  }

  public start(onExit: () => void) {
    this.onExitCallback = onExit;
    this.render();
    this.setupKeyHandler();
  }

  private setupKeyHandler() {
    this.keyHandler = (e: { key: string; domEvent: KeyboardEvent }) => {
      if (this.disposed) return;
      e.domEvent.preventDefault();
      e.domEvent.stopPropagation();

      this.handleKey(e.key, e.domEvent);
    };

    this.term.onKey(this.keyHandler);
  }

  private handleKey(key: string, domEvent: KeyboardEvent) {
    // Clear message on any key press
    this.state.message = '';

    switch (this.state.mode) {
      case 'NORMAL':
        this.handleNormalMode(key, domEvent);
        break;
      case 'INSERT':
        this.handleInsertMode(key, domEvent);
        break;
      case 'VISUAL':
        this.handleVisualMode(key, domEvent);
        break;
      case 'COMMAND':
        this.handleCommandMode(key, domEvent);
        break;
    }

    this.render();
  }

  private handleNormalMode(key: string, domEvent: KeyboardEvent) {
    const ctrl = domEvent.ctrlKey;

    // Movement commands
    if (key === 'h' && !ctrl) {
      this.moveCursorLeft();
    } else if (key === 'j' && !ctrl) {
      this.moveCursorDown();
    } else if (key === 'k' && !ctrl) {
      this.moveCursorUp();
    } else if (key === 'l' && !ctrl) {
      this.moveCursorRight();
    } else if (key === 'w' && !ctrl) {
      this.moveWordForward();
    } else if (key === 'b' && !ctrl) {
      this.moveWordBackward();
    } else if (key === 'e' && !ctrl) {
      this.moveWordEnd();
    } else if (key === '0' && !ctrl) {
      this.state.cursorCol = 0;
    } else if (key === '$' && !ctrl) {
      this.state.cursorCol = Math.max(0, this.getCurrentLine().length - 1);
    } else if (key === 'g' && !ctrl) {
      // gg - go to first line (need to handle double 'g')
      // For simplicity, we'll use a timeout-based approach
      setTimeout(() => {
        if (this.state.mode === 'NORMAL') {
          this.state.cursorRow = 0;
          this.state.cursorCol = 0;
          this.topLine = 0;
          this.render();
        }
      }, 300);
    } else if (key === 'G' && !ctrl) {
      this.state.cursorRow = this.state.lines.length - 1;
      this.state.cursorCol = 0;
      this.ensureCursorVisible();
    }
    // Insert mode commands
    else if (key === 'i' && !ctrl) {
      this.enterInsertMode();
    } else if (key === 'a' && !ctrl) {
      this.moveCursorRight();
      this.enterInsertMode();
    } else if (key === 'o' && !ctrl) {
      this.saveUndo();
      this.state.lines.splice(this.state.cursorRow + 1, 0, '');
      this.state.cursorRow++;
      this.state.cursorCol = 0;
      this.state.modified = true;
      this.enterInsertMode();
    } else if (key === 'O' && !ctrl) {
      this.saveUndo();
      this.state.lines.splice(this.state.cursorRow, 0, '');
      this.state.cursorCol = 0;
      this.state.modified = true;
      this.enterInsertMode();
    } else if (key === 'A' && !ctrl) {
      this.state.cursorCol = this.getCurrentLine().length;
      this.enterInsertMode();
    }
    // Delete commands
    else if (key === 'x' && !ctrl) {
      this.deleteChar();
    } else if (key === 'd' && !ctrl) {
      // dd - delete line (need to handle double 'd')
      setTimeout(() => {
        if (this.state.mode === 'NORMAL') {
          this.deleteLine();
        }
      }, 300);
    }
    // Yank (copy) commands
    else if (key === 'y' && !ctrl) {
      // yy - yank line
      setTimeout(() => {
        if (this.state.mode === 'NORMAL') {
          this.yankLine();
        }
      }, 300);
    }
    // Paste
    else if (key === 'p' && !ctrl) {
      this.paste();
    }
    // Undo/Redo
    else if (key === 'u' && !ctrl) {
      this.undo();
    } else if (key === 'r' && ctrl) {
      this.redo();
    }
    // Visual mode
    else if (key === 'v' && !ctrl) {
      this.enterVisualMode();
    }
    // Command mode
    else if (key === ':' && !ctrl) {
      this.enterCommandMode();
    }
    // Search
    else if (key === '/' && !ctrl) {
      this.enterSearchMode();
    } else if (key === 'n' && !ctrl) {
      this.searchNext();
    } else if (key === 'N' && !ctrl) {
      this.searchPrevious();
    }
  }

  private handleInsertMode(key: string, domEvent: KeyboardEvent) {
    if (key === '\x1b') {
      // ESC
      this.state.mode = 'NORMAL';
      if (this.state.cursorCol > 0) {
        this.state.cursorCol--;
      }
    } else if (key === '\r') {
      // Enter
      this.saveUndo();
      const currentLine = this.getCurrentLine();
      const before = currentLine.slice(0, this.state.cursorCol);
      const after = currentLine.slice(this.state.cursorCol);
      this.state.lines[this.state.cursorRow] = before;
      this.state.lines.splice(this.state.cursorRow + 1, 0, after);
      this.state.cursorRow++;
      this.state.cursorCol = 0;
      this.state.modified = true;
    } else if (key === '\x7f') {
      // Backspace
      if (this.state.cursorCol > 0) {
        this.saveUndo();
        const line = this.getCurrentLine();
        this.state.lines[this.state.cursorRow] =
          line.slice(0, this.state.cursorCol - 1) + line.slice(this.state.cursorCol);
        this.state.cursorCol--;
        this.state.modified = true;
      } else if (this.state.cursorRow > 0) {
        this.saveUndo();
        const currentLine = this.getCurrentLine();
        this.state.cursorRow--;
        this.state.cursorCol = this.getCurrentLine().length;
        this.state.lines[this.state.cursorRow] += currentLine;
        this.state.lines.splice(this.state.cursorRow + 1, 1);
        this.state.modified = true;
      }
    } else if (key.length === 1 && key >= ' ') {
      // Regular character
      this.saveUndo();
      const line = this.getCurrentLine();
      this.state.lines[this.state.cursorRow] =
        line.slice(0, this.state.cursorCol) + key + line.slice(this.state.cursorCol);
      this.state.cursorCol++;
      this.state.modified = true;
    }
  }

  private handleVisualMode(key: string, domEvent: KeyboardEvent) {
    if (key === '\x1b') {
      // ESC
      this.state.mode = 'NORMAL';
      this.state.visualStart = null;
    } else if (key === 'h') {
      this.moveCursorLeft();
    } else if (key === 'j') {
      this.moveCursorDown();
    } else if (key === 'k') {
      this.moveCursorUp();
    } else if (key === 'l') {
      this.moveCursorRight();
    } else if (key === 'd') {
      this.deleteVisualSelection();
      this.state.mode = 'NORMAL';
      this.state.visualStart = null;
    } else if (key === 'y') {
      this.yankVisualSelection();
      this.state.mode = 'NORMAL';
      this.state.visualStart = null;
    }
  }

  private handleCommandMode(key: string, domEvent: KeyboardEvent) {
    if (key === '\x1b') {
      // ESC
      this.state.mode = 'NORMAL';
      this.state.commandLine = '';
    } else if (key === '\r') {
      // Enter
      const cmd = this.state.commandLine;

      // Check if it's a search command
      if (cmd.startsWith('/')) {
        const pattern = cmd.slice(1);
        if (pattern) {
          this.performSearch(pattern);
        }
        this.state.mode = 'NORMAL';
      } else {
        this.executeCommand(cmd);
      }

      this.state.commandLine = '';
      if (this.state.mode === 'COMMAND') {
        this.state.mode = 'NORMAL';
      }
    } else if (key === '\x7f') {
      // Backspace
      if (this.state.commandLine.length > 0) {
        this.state.commandLine = this.state.commandLine.slice(0, -1);
      } else {
        this.state.mode = 'NORMAL';
      }
    } else if (key.length === 1 && key >= ' ') {
      this.state.commandLine += key;
    }
  }

  private executeCommand(cmd: string) {
    if (cmd === 'w') {
      this.saveFile();
    } else if (cmd === 'q') {
      if (this.state.modified) {
        this.state.message = 'No write since last change (add ! to override)';
      } else {
        this.exit();
      }
    } else if (cmd === 'wq' || cmd === 'x') {
      this.saveFile();
      this.exit();
    } else if (cmd === 'q!') {
      this.exit();
    } else if (cmd.startsWith('s/')) {
      this.replaceCommand(cmd);
    } else if (cmd.match(/^\d+$/)) {
      // Go to line number
      const lineNum = Number.parseInt(cmd, 10) - 1;
      if (lineNum >= 0 && lineNum < this.state.lines.length) {
        this.state.cursorRow = lineNum;
        this.state.cursorCol = 0;
        this.ensureCursorVisible();
      }
    } else {
      this.state.message = `Unknown command: ${cmd}`;
    }
  }

  private async saveFile() {
    try {
      const content = this.state.lines.join('\n');
      const existingFile = await fileRepository.getFileByPath(
        this.state.projectId,
        this.state.relativePath
      );

      if (existingFile) {
        await fileRepository.saveFile({
          ...existingFile,
          content,
          updatedAt: new Date(),
        });
      } else {
        await fileRepository.createFile(
          this.state.projectId,
          this.state.relativePath,
          content,
          'file'
        );
      }

      this.state.modified = false;
      this.state.message = `"${this.state.fileName}" ${this.state.lines.length}L written`;
    } catch (e) {
      this.state.message = `Error: ${(e as Error).message}`;
    }
  }

  private replaceCommand(cmd: string) {
    // Parse :%s/old/new/g or :s/old/new/g
    const match = cmd.match(/^(%?)s\/(.+?)\/(.+?)\/(g?)$/);
    if (!match) {
      this.state.message = 'Invalid substitute command';
      return;
    }

    const [, percent, oldPattern, newText, global] = match;
    const isGlobal = percent === '%';
    const replaceAll = global === 'g';

    this.saveUndo();

    try {
      const regex = new RegExp(oldPattern, replaceAll ? 'g' : '');
      let count = 0;

      if (isGlobal) {
        // Replace in all lines
        for (let i = 0; i < this.state.lines.length; i++) {
          const before = this.state.lines[i];
          this.state.lines[i] = this.state.lines[i].replace(regex, newText);
          if (before !== this.state.lines[i]) count++;
        }
      } else {
        // Replace in current line only
        const before = this.getCurrentLine();
        this.state.lines[this.state.cursorRow] = this.getCurrentLine().replace(regex, newText);
        if (before !== this.getCurrentLine()) count++;
      }

      this.state.modified = true;
      this.state.message = `${count} substitution${count !== 1 ? 's' : ''} on ${isGlobal ? this.state.lines.length : 1} line${isGlobal && this.state.lines.length !== 1 ? 's' : ''}`;
    } catch (e) {
      this.state.message = `Invalid regex: ${(e as Error).message}`;
    }
  }

  private enterInsertMode() {
    this.state.mode = 'INSERT';
  }

  private enterVisualMode() {
    this.state.mode = 'VISUAL';
    this.state.visualStart = { row: this.state.cursorRow, col: this.state.cursorCol };
  }

  private enterCommandMode() {
    this.state.mode = 'COMMAND';
    this.state.commandLine = '';
  }

  private enterSearchMode() {
    this.state.mode = 'COMMAND';
    this.state.commandLine = '/';
  }

  private moveCursorLeft() {
    if (this.state.cursorCol > 0) {
      this.state.cursorCol--;
    }
  }

  private moveCursorRight() {
    const line = this.getCurrentLine();
    const maxCol = this.state.mode === 'INSERT' ? line.length : Math.max(0, line.length - 1);
    if (this.state.cursorCol < maxCol) {
      this.state.cursorCol++;
    }
  }

  private moveCursorUp() {
    if (this.state.cursorRow > 0) {
      this.state.cursorRow--;
      const lineLen = this.getCurrentLine().length;
      if (this.state.mode === 'INSERT') {
        this.state.cursorCol = Math.min(this.state.cursorCol, lineLen);
      } else {
        this.state.cursorCol = Math.min(this.state.cursorCol, Math.max(0, lineLen - 1));
      }
      if (this.state.cursorCol < 0) this.state.cursorCol = 0;
      this.ensureCursorVisible();
    }
  }

  private moveCursorDown() {
    if (this.state.cursorRow < this.state.lines.length - 1) {
      this.state.cursorRow++;
      const lineLen = this.getCurrentLine().length;
      if (this.state.mode === 'INSERT') {
        this.state.cursorCol = Math.min(this.state.cursorCol, lineLen);
      } else {
        this.state.cursorCol = Math.min(this.state.cursorCol, Math.max(0, lineLen - 1));
      }
      if (this.state.cursorCol < 0) this.state.cursorCol = 0;
      this.ensureCursorVisible();
    }
  }

  private moveWordForward() {
    const line = this.getCurrentLine();
    let col = this.state.cursorCol;

    // Skip current word
    while (col < line.length && /\w/.test(line[col])) col++;
    // Skip whitespace
    while (col < line.length && /\s/.test(line[col])) col++;

    this.state.cursorCol = Math.min(col, Math.max(0, line.length - 1));
  }

  private moveWordBackward() {
    const line = this.getCurrentLine();
    let col = this.state.cursorCol;

    // Move back one if at word start
    if (col > 0) col--;

    // Skip whitespace
    while (col > 0 && /\s/.test(line[col])) col--;
    // Skip word
    while (col > 0 && /\w/.test(line[col - 1])) col--;

    this.state.cursorCol = col;
  }

  private moveWordEnd() {
    const line = this.getCurrentLine();
    let col = this.state.cursorCol;

    // Move forward one
    if (col < line.length - 1) col++;

    // Skip whitespace
    while (col < line.length && /\s/.test(line[col])) col++;
    // Skip to end of word
    while (col < line.length - 1 && /\w/.test(line[col + 1])) col++;

    this.state.cursorCol = Math.min(col, Math.max(0, line.length - 1));
  }

  private deleteChar() {
    this.saveUndo();
    const line = this.getCurrentLine();
    if (this.state.cursorCol < line.length) {
      this.state.lines[this.state.cursorRow] =
        line.slice(0, this.state.cursorCol) + line.slice(this.state.cursorCol + 1);
      this.state.modified = true;
    }
  }

  private deleteLine() {
    this.saveUndo();
    this.state.yankBuffer = [this.getCurrentLine()];
    if (this.state.lines.length === 1) {
      this.state.lines = [''];
    } else {
      this.state.lines.splice(this.state.cursorRow, 1);
      if (this.state.cursorRow >= this.state.lines.length) {
        this.state.cursorRow = this.state.lines.length - 1;
      }
    }
    this.state.cursorCol = 0;
    this.state.modified = true;
  }

  private yankLine() {
    this.state.yankBuffer = [this.getCurrentLine()];
    this.state.message = '1 line yanked';
  }

  private paste() {
    if (this.state.yankBuffer.length === 0) return;

    this.saveUndo();
    for (let i = 0; i < this.state.yankBuffer.length; i++) {
      this.state.lines.splice(this.state.cursorRow + 1 + i, 0, this.state.yankBuffer[i]);
    }
    this.state.cursorRow++;
    this.state.cursorCol = 0;
    this.state.modified = true;
  }

  private deleteVisualSelection() {
    if (!this.state.visualStart) return;

    this.saveUndo();
    const start = this.state.visualStart;
    const end = { row: this.state.cursorRow, col: this.state.cursorCol };

    // Normalize selection
    const [startRow, endRow] = start.row <= end.row ? [start.row, end.row] : [end.row, start.row];
    const [startCol, endCol] =
      start.row === end.row && start.col > end.col ? [end.col, start.col] : [start.col, end.col];

    if (startRow === endRow) {
      // Single line selection
      const line = this.state.lines[startRow];
      this.state.lines[startRow] = line.slice(0, startCol) + line.slice(endCol + 1);
      this.state.yankBuffer = [line.slice(startCol, endCol + 1)];
    } else {
      // Multi-line selection
      const deleted: string[] = [];
      for (let i = startRow; i <= endRow; i++) {
        deleted.push(this.state.lines[i]);
      }
      this.state.yankBuffer = deleted;
      this.state.lines.splice(startRow, endRow - startRow + 1);
      if (this.state.lines.length === 0) {
        this.state.lines = [''];
      }
    }

    this.state.cursorRow = startRow;
    this.state.cursorCol = startCol;
    this.state.modified = true;
  }

  private yankVisualSelection() {
    if (!this.state.visualStart) return;

    const start = this.state.visualStart;
    const end = { row: this.state.cursorRow, col: this.state.cursorCol };

    const [startRow, endRow] = start.row <= end.row ? [start.row, end.row] : [end.row, start.row];

    const yanked: string[] = [];
    for (let i = startRow; i <= endRow; i++) {
      yanked.push(this.state.lines[i]);
    }
    this.state.yankBuffer = yanked;
    this.state.message = `${yanked.length} line${yanked.length !== 1 ? 's' : ''} yanked`;
  }

  private saveUndo() {
    this.state.undoStack.push({
      lines: [...this.state.lines],
      cursor: { row: this.state.cursorRow, col: this.state.cursorCol },
    });
    this.state.redoStack = [];
    // Limit undo stack size
    if (this.state.undoStack.length > 100) {
      this.state.undoStack.shift();
    }
  }

  private undo() {
    if (this.state.undoStack.length === 0) {
      this.state.message = 'Already at oldest change';
      return;
    }

    this.state.redoStack.push({
      lines: [...this.state.lines],
      cursor: { row: this.state.cursorRow, col: this.state.cursorCol },
    });

    const prev = this.state.undoStack.pop()!;
    this.state.lines = prev.lines;
    this.state.cursorRow = prev.cursor.row;
    this.state.cursorCol = prev.cursor.col;
    this.state.modified = true;
  }

  private redo() {
    if (this.state.redoStack.length === 0) {
      this.state.message = 'Already at newest change';
      return;
    }

    this.state.undoStack.push({
      lines: [...this.state.lines],
      cursor: { row: this.state.cursorRow, col: this.state.cursorCol },
    });

    const next = this.state.redoStack.pop()!;
    this.state.lines = next.lines;
    this.state.cursorRow = next.cursor.row;
    this.state.cursorCol = next.cursor.col;
    this.state.modified = true;
  }

  private searchNext() {
    if (this.state.searchMatches.length === 0) {
      this.state.message = 'No previous search pattern';
      return;
    }

    this.state.currentSearchIndex =
      (this.state.currentSearchIndex + 1) % this.state.searchMatches.length;
    const match = this.state.searchMatches[this.state.currentSearchIndex];
    this.state.cursorRow = match.row;
    this.state.cursorCol = match.col;
    this.ensureCursorVisible();
  }

  private searchPrevious() {
    if (this.state.searchMatches.length === 0) {
      this.state.message = 'No previous search pattern';
      return;
    }

    this.state.currentSearchIndex =
      (this.state.currentSearchIndex - 1 + this.state.searchMatches.length) %
      this.state.searchMatches.length;
    const match = this.state.searchMatches[this.state.currentSearchIndex];
    this.state.cursorRow = match.row;
    this.state.cursorCol = match.col;
    this.ensureCursorVisible();
  }

  private performSearch(pattern: string) {
    this.state.searchPattern = pattern;
    this.state.searchMatches = [];

    try {
      const regex = new RegExp(pattern, 'gi');
      for (let i = 0; i < this.state.lines.length; i++) {
        let match;
        while ((match = regex.exec(this.state.lines[i])) !== null) {
          this.state.searchMatches.push({ row: i, col: match.index });
        }
      }

      if (this.state.searchMatches.length > 0) {
        this.state.currentSearchIndex = 0;
        const match = this.state.searchMatches[0];
        this.state.cursorRow = match.row;
        this.state.cursorCol = match.col;
        this.ensureCursorVisible();
        this.state.message = `${this.state.searchMatches.length} match${this.state.searchMatches.length !== 1 ? 'es' : ''}`;
      } else {
        this.state.message = 'Pattern not found';
      }
    } catch (e) {
      this.state.message = `Invalid pattern: ${(e as Error).message}`;
    }
  }

  private ensureCursorVisible() {
    const viewportHeight = this.term.rows - 2; // Reserve 2 lines for status
    if (this.state.cursorRow < this.topLine) {
      this.topLine = this.state.cursorRow;
    } else if (this.state.cursorRow >= this.topLine + viewportHeight) {
      this.topLine = this.state.cursorRow - viewportHeight + 1;
    }
  }

  private getCurrentLine(): string {
    return this.state.lines[this.state.cursorRow] || '';
  }

  // src/engine/cmd/VimEditor.ts の render() メソッド
  private render() {
    if (this.disposed) return;

    // Clear screen and move to home
    this.term.write('\x1b[2J\x1b[3J\x1b[H');

    const viewportHeight = this.term.rows - 2; // ステータス行とコマンド行を除く
    const viewportWidth = this.term.cols;

    // 最初の行から確実に描画を開始
    this.term.write('\x1b[1;1H');

    // Render visible lines
    for (let i = 0; i < viewportHeight; i++) {
      const lineIdx = this.topLine + i;
      if (lineIdx < this.state.lines.length) {
        let line = this.state.lines[lineIdx];

        // Highlight visual selection
        if (
          this.state.mode === 'VISUAL' &&
          this.state.visualStart &&
          lineIdx >= Math.min(this.state.visualStart.row, this.state.cursorRow) &&
          lineIdx <= Math.max(this.state.visualStart.row, this.state.cursorRow)
        ) {
          line = `\x1b[7m${line}\x1b[0m`; // Reverse video
        }

        // Truncate line if too long
        if (line.length > viewportWidth) {
          line = `${line.slice(0, viewportWidth - 1)}>`;
        }

        this.term.write(`${line}\r\n`);
      } else {
        this.term.write('~\r\n');
      }
    }

    // Render status line
    const modifiedFlag = this.state.modified ? '[+]' : '';
    const modeDisplay = `-- ${this.state.mode} --`;
    const position = `${this.state.cursorRow + 1},${this.state.cursorCol + 1}`;
    const statusLine = `\x1b[7m ${this.state.fileName} ${modifiedFlag}${' '.repeat(Math.max(0, viewportWidth - this.state.fileName.length - modifiedFlag.length - position.length - 2))}${position} \x1b[0m`;
    this.term.write(`${statusLine}\r\n`);

    // Render command/message line
    if (this.state.mode === 'COMMAND') {
      this.term.write(`:${this.state.commandLine}`);
    } else if (this.state.message) {
      this.term.write(this.state.message);
    } else {
      this.term.write(modeDisplay);
    }

    // Position cursor - +1を削除してみる
    const screenRow = this.state.cursorRow - this.topLine;
    const screenCol = this.state.cursorCol;
    this.term.write(`\x1b[${screenRow};${screenCol}H`);
  }
  private exit() {
    this.disposed = true;
    if (this.onExitCallback) {
      this.onExitCallback();
    }
  }

  public dispose() {
    this.disposed = true;
  }

  // Public helper to simulate pressing ESC from external UI (e.g. ESC button)
  public pressEsc() {
    if (this.disposed) return;
    this.state.mode = 'NORMAL';
    this.state.commandLine = '';
    this.state.visualStart = null;
    this.render();
  }
}
