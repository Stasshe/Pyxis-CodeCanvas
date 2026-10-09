import {
  clearTerminalHistory,
  getTerminalHistory,
  saveTerminalHistory,
} from '@/stores/terminalHistoryStorage';
import type { TerminalInputState } from '../../../lib/xterm/terminalInput';
import type { TerminalLineEditor } from './terminalLineEditor';

export interface TerminalHistoryPosition {
  index: number;
  draft: string;
  line: string;
}

export class TerminalHistory {
  private commands: string[] = [];
  private index = -1;
  private draft = '';

  constructor(private readonly key: string) {}

  get entries(): string[] {
    return this.commands;
  }

  async load(): Promise<void> {
    const saved = await getTerminalHistory(this.key);
    if (Array.isArray(saved)) this.commands = saved;
    else this.commands = [];
  }

  async add(command: string): Promise<void> {
    this.commands.push(command);
    if (this.commands.length > 100) this.commands.shift();
    this.resetNavigation();
    await saveTerminalHistory(this.key, this.commands);
  }

  async clear(): Promise<void> {
    this.commands = [];
    this.resetNavigation();
    await clearTerminalHistory(this.key);
  }

  resetNavigation(): void {
    this.index = -1;
    this.draft = '';
  }

  navigate(direction: 'up' | 'down', currentLine: string): string {
    const next = moveHistory(
      this.commands,
      { index: this.index, draft: this.draft, line: currentLine },
      direction
    );
    this.index = next.index;
    this.draft = next.draft;
    return next.line;
  }
}

export function moveHistory(
  history: string[],
  position: TerminalHistoryPosition,
  direction: 'up' | 'down'
): TerminalHistoryPosition {
  if (history.length === 0) return position;
  if (direction === 'up') {
    if (position.index === -1) {
      return { index: history.length - 1, draft: position.line, line: history.at(-1) ?? '' };
    }
    if (position.index > 0) {
      const index = position.index - 1;
      return { ...position, index, line: history[index] };
    }
    return position;
  }
  if (position.index === -1) return position;
  if (position.index < history.length - 1) {
    const index = position.index + 1;
    return { ...position, index, line: history[index] };
  }
  return { index: -1, draft: position.draft, line: position.draft };
}

export function navigateTerminalHistory(
  data: string,
  history: TerminalHistory,
  inputState: TerminalInputState,
  lineEditor: TerminalLineEditor
): boolean {
  if (data !== '\u001b[A' && data !== '\u001b[B') return false;
  if (history.entries.length === 0) return true;
  let direction: 'up' | 'down' = 'down';
  if (data === '\u001b[A') direction = 'up';
  const next = history.navigate(direction, inputState.currentLine);
  lineEditor.bumpGeneration();
  inputState.currentLine = next;
  inputState.cursorPos = next.length;
  lineEditor.render(false);
  return true;
}
