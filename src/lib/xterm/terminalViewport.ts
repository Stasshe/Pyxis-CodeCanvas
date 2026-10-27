import type { Terminal as XTerm } from '@xterm/xterm';

export function createTerminalScrollHandler(term: XTerm, isMounted: () => boolean): () => void {
  return () => {
    if (!isMounted()) return;
    term.scrollToBottom();
    requestAnimationFrame(() => {
      if (!isMounted()) return;
      const buffer = term.buffer.active;
      const absoluteCursorLine = buffer.baseY + buffer.cursorY;
      const scrollDelta = absoluteCursorLine - buffer.viewportY - term.rows + 1;
      if (scrollDelta > 0) term.scrollLines(scrollDelta);
      term.scrollToBottom();
    });
  };
}
