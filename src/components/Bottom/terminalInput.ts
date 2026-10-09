import { terminalProcessBridge } from '@/engine/cmd/terminalProcessBridge';

export interface TerminalInputTarget {
  textarea: TerminalInputTextarea | undefined;
  modes: { bracketedPasteMode: boolean };
  attachCustomKeyEventHandler(handler: (event: TerminalInputKeyEvent) => boolean): void;
  getSelection(): string;
  paste(data: string): void;
}

export interface TerminalInputKeyEvent {
  type: string;
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  preventDefault(): void;
  stopPropagation(): void;
}

export interface TerminalInputTextarea {
  addEventListener(type: 'compositionstart' | 'compositionend', listener: () => void): void;
  addEventListener(
    type: 'paste',
    listener: (event: TerminalPasteEvent) => void,
    useCapture?: boolean
  ): void;
}

export interface TerminalPasteEvent {
  preventDefault(): void;
  stopImmediatePropagation(): void;
  clipboardData?: { getData(format: string): string } | null;
}

export interface TerminalInputState {
  currentLine: string;
  cursorPos: number;
  interactiveLine: string;
  interactivePos: number;
  isComposing: boolean;
}

export function createTerminalInputState(): TerminalInputState {
  return {
    currentLine: '',
    cursorPos: 0,
    interactiveLine: '',
    interactivePos: 0,
    isComposing: false,
  };
}

const copyTerminalSelection = (
  terminal: TerminalInputTarget,
  onError: (message: string) => void
): boolean => {
  const selection = terminal.getSelection();
  if (!selection) return false;
  if (!navigator.clipboard?.writeText) {
    onError('Clipboard access is unavailable.');
    return true;
  }
  void navigator.clipboard.writeText(selection).catch(error => {
    onError(`Clipboard copy failed: ${String(error)}`);
  });
  return true;
};

export function setupTerminalInput(
  terminal: TerminalInputTarget,
  state: TerminalInputState,
  isVimModeActive: () => boolean,
  isInputLocked: () => boolean,
  onPaste: (interactive: boolean, text: string) => void,
  onError: (message: string) => void,
  getInputGeneration: () => number = () => 0,
  readClipboardText?: () => Promise<string>,
  getInputSessionKey: () => string = () => String(getInputGeneration())
): void {
  terminal.textarea?.addEventListener('compositionstart', () => {
    state.isComposing = true;
  });
  terminal.textarea?.addEventListener('compositionend', () => {
    state.isComposing = false;
  });

  const handlePaste = (text: string) => {
    if (!text) return;
    if (isVimModeActive()) {
      terminal.paste(text);
      return;
    }
    if (isInputLocked()) return;
    const rawSession = terminalProcessBridge.isActive() && terminalProcessBridge.stdin.isRaw;
    if (!rawSession && /\r|\n/u.test(text)) {
      onError('Multiline paste is not supported.');
      return;
    }
    if (terminalProcessBridge.isActive()) {
      if (rawSession) {
        let data = text.replace(/\r?\n/gu, '\r');
        if (terminal.modes.bracketedPasteMode) data = `\x1b[200~${data}\x1b[201~`;
        terminalProcessBridge.submitData(data);
        return;
      }
      onPaste(true, text);
      return;
    }
    onPaste(false, text);
  };

  // Handle paste before xterm's bubbling listener can emit the same text through onData.
  terminal.textarea?.addEventListener(
    'paste',
    event => {
      event.preventDefault();
      event.stopImmediatePropagation();
      handlePaste(event.clipboardData?.getData('text/plain') ?? '');
    },
    true
  );

  terminal.attachCustomKeyEventHandler((event: TerminalInputKeyEvent) => {
    if (event.type !== 'keydown') return true;
    const control = event.ctrlKey || event.metaKey;

    if (control && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'c') {
      if (copyTerminalSelection(terminal, onError)) {
        event.preventDefault();
        event.stopPropagation();
        return false;
      }
    }

    if (control && !event.altKey && event.key.toLowerCase() === 'v') {
      event.preventDefault();
      const readText = readClipboardText ?? navigator.clipboard?.readText.bind(navigator.clipboard);
      if (!readText) {
        onError('Clipboard access is unavailable.');
      } else {
        const sessionKey = getInputSessionKey();
        void readText()
          .then(text => {
            if (sessionKey === getInputSessionKey()) handlePaste(text);
          })
          .catch(error => {
            if (sessionKey === getInputSessionKey()) {
              onError(`Clipboard paste failed: ${String(error)}`);
            }
          });
      }
      return false;
    }

    return true;
  });
}
