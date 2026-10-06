import type { Terminal as XTerm } from '@xterm/xterm';
import { terminalProcessBridge } from '@/engine/cmd/terminalProcessBridge';

export interface TerminalInputState {
  currentLine: string;
  cursorPos: number;
  interactiveLine: string;
  interactivePos: number;
  isSelecting: boolean;
  isComposing: boolean;
  ignoreNextOnData: boolean;
}

const insertAtCursor = (
  terminal: XTerm,
  line: string,
  position: number,
  text: string
): { line: string; position: number } => {
  const next = line.slice(0, position) + text + line.slice(position);
  terminal.write(next.slice(position));
  const nextPosition = position + text.length;
  for (let count = next.length - nextPosition; count > 0; count -= 1) terminal.write('\b');
  return { line: next, position: nextPosition };
};

const copyTerminalSelection = (terminal: XTerm): boolean => {
  const selection = terminal.getSelection();
  if (!selection) return false;

  const fallbackCopy = () => {
    const textarea = document.createElement('textarea');
    textarea.value = selection;
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    textarea.style.top = '0';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    try {
      document.execCommand('copy');
    } finally {
      textarea.remove();
      terminal.focus();
    }
  };

  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(selection).catch(fallbackCopy);
  else fallbackCopy();
  return true;
};

export function setupTerminalInput(
  terminal: XTerm,
  state: TerminalInputState,
  isVimModeActive: () => boolean
): void {
  terminal.textarea?.addEventListener('compositionstart', () => {
    state.isComposing = true;
  });
  terminal.textarea?.addEventListener('compositionend', () => {
    state.isComposing = false;
  });

  const handlePaste = (text: string) => {
    if (!text || isVimModeActive()) return;
    if (terminalProcessBridge.isActive()) {
      const inserted = insertAtCursor(terminal, state.interactiveLine, state.interactivePos, text);
      state.interactiveLine = inserted.line;
      state.interactivePos = inserted.position;
      return;
    }
    const inserted = insertAtCursor(terminal, state.currentLine, state.cursorPos, text);
    state.currentLine = inserted.line;
    state.cursorPos = inserted.position;
  };

  terminal.textarea?.addEventListener('paste', event => {
    event.preventDefault();
    handlePaste(event.clipboardData?.getData('text/plain') ?? '');
  });

  terminal.attachCustomKeyEventHandler((event: KeyboardEvent) => {
    if (event.type !== 'keydown') return true;
    const control = event.ctrlKey || event.metaKey;

    if (control && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'c') {
      if (copyTerminalSelection(terminal)) {
        event.preventDefault();
        event.stopPropagation();
        return false;
      }
    }

    if (control && !event.altKey && event.key.toLowerCase() === 'v') {
      event.preventDefault();
      navigator.clipboard
        .readText()
        .then(handlePaste)
        .catch(() => {});
      return false;
    }

    return true;
  });

  terminal.onKey(({ key, domEvent }) => {
    if (state.isComposing) return;
    if (domEvent.key === 'Home' || (domEvent.metaKey && domEvent.key === 'ArrowLeft')) {
      for (let count = state.cursorPos; count > 0; count -= 1) terminal.write('\b');
      state.cursorPos = 0;
      state.ignoreNextOnData = true;
      domEvent.preventDefault();
      return;
    }

    if (domEvent.key === 'End' || (domEvent.metaKey && domEvent.key === 'ArrowRight')) {
      terminal.write(state.currentLine.slice(state.cursorPos));
      state.cursorPos = state.currentLine.length;
      state.ignoreNextOnData = true;
      domEvent.preventDefault();
      return;
    }

    if (domEvent.ctrlKey && !domEvent.shiftKey && !domEvent.altKey) {
      if (domEvent.key === 'ArrowLeft' || key === '\u001b[D') {
        if (state.cursorPos > 0) {
          let position = state.cursorPos - 1;
          while (position > 0 && state.currentLine[position - 1] !== ' ') position -= 1;
          for (let count = state.cursorPos - position; count > 0; count -= 1) terminal.write('\b');
          state.cursorPos = position;
        }
        state.ignoreNextOnData = true;
        domEvent.preventDefault();
      } else if (domEvent.key === 'ArrowRight' || key === '\u001b[C') {
        let position = state.cursorPos;
        while (position < state.currentLine.length && state.currentLine[position] !== ' ')
          position += 1;
        while (position < state.currentLine.length && state.currentLine[position] === ' ')
          position += 1;
        terminal.write(state.currentLine.slice(state.cursorPos, position));
        state.cursorPos = position;
        state.ignoreNextOnData = true;
        domEvent.preventDefault();
      }
    }

    if (domEvent.shiftKey && !domEvent.ctrlKey && !domEvent.altKey) {
      if (key === '\u001b[D') {
        state.isSelecting = true;
        if (state.cursorPos > 0) {
          state.cursorPos -= 1;
          terminal.write('\b');
        }
        domEvent.preventDefault();
      } else if (key === '\u001b[C') {
        state.isSelecting = true;
        if (state.cursorPos < state.currentLine.length) {
          terminal.write(state.currentLine[state.cursorPos]);
          state.cursorPos += 1;
        }
        domEvent.preventDefault();
      }
    }
  });
}
