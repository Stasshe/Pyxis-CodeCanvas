import { describe, expect, it, vi } from 'vitest';
import {
  setupTerminalInput,
  type TerminalInputKeyEvent,
  type TerminalInputState,
  type TerminalInputTarget,
  type TerminalPasteEvent,
} from '@/lib/xterm/terminalInput';
import { ProcessStdin, terminalProcessBridge } from '@/engine/system/terminal/terminalProcessBridge';

function createInputHarness() {
  const pasteListeners: Array<{
    listener: (event: TerminalPasteEvent) => void;
    capture: boolean;
  }> = [];
  let keyHandler: ((event: TerminalInputKeyEvent) => boolean) | undefined;
  const terminal: TerminalInputTarget = {
    textarea: {
      addEventListener: (type, listener, useCapture = false) => {
        if (type === 'paste') pasteListeners.push({ listener, capture: useCapture });
      },
    },
    modes: { bracketedPasteMode: false },
    attachCustomKeyEventHandler: handler => {
      keyHandler = handler;
    },
    getSelection: () => '',
    paste: vi.fn(),
  };
  const state: TerminalInputState = {
    currentLine: 'abc',
    cursorPos: 3,
    interactiveLine: '',
    interactivePos: 0,
    isComposing: false,
  };
  return {
    terminal,
    state,
    addXtermPasteListener: (listener: (event: TerminalPasteEvent) => void) => {
      pasteListeners.push({ listener, capture: false });
    },
    dispatchPaste: (event: ReturnType<typeof pasteEvent>) => {
      for (const capture of [true, false]) {
        for (const registered of pasteListeners) {
          if (registered.capture !== capture) continue;
          registered.listener(event);
          if (event.immediatePropagationStopped) return;
        }
      }
    },
    getKeyHandler: () => keyHandler,
  };
}

function pasteEvent(text: string) {
  return {
    preventDefault: vi.fn(),
    immediatePropagationStopped: false,
    stopImmediatePropagation() {
      this.immediatePropagationStopped = true;
    },
    clipboardData: { getData: () => text },
  };
}

describe('setupTerminalInput', () => {
  it('forwards paste to Vim without changing shell input', () => {
    const harness = createInputHarness();
    setupTerminalInput(
      harness.terminal,
      harness.state,
      () => true,
      () => true,
      vi.fn(),
      vi.fn()
    );
    const event = pasteEvent('inserted text');
    harness.dispatchPaste(event);

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.immediatePropagationStopped).toBe(true);
    expect(harness.terminal.paste).toHaveBeenCalledWith('inserted text');
    expect(harness.state.currentLine).toBe('abc');
  });

  it('handles one browser paste before xterm can forward the same data through onData', () => {
    const harness = createInputHarness();
    const onPaste = vi.fn((_interactive: boolean, text: string) => {
      harness.state.currentLine += text;
    });
    harness.addXtermPasteListener(event => {
      onPaste(false, event.clipboardData?.getData('text/plain') ?? '');
    });
    setupTerminalInput(
      harness.terminal,
      harness.state,
      () => false,
      () => false,
      onPaste,
      vi.fn()
    );

    harness.dispatchPaste(pasteEvent('printf "paste-界😀"'));

    expect(onPaste).toHaveBeenCalledOnce();
    expect(harness.state.currentLine).toBe('abcprintf "paste-界😀"');
  });

  it('ignores paste while a shell command is running', () => {
    const harness = createInputHarness();
    const onPaste = vi.fn();
    setupTerminalInput(
      harness.terminal,
      harness.state,
      () => false,
      () => true,
      onPaste,
      vi.fn()
    );
    harness.dispatchPaste(pasteEvent('ignored'));

    expect(onPaste).not.toHaveBeenCalled();
    expect(harness.state.currentLine).toBe('abc');
  });

  it('routes interactive paste to the active line editor', () => {
    const harness = createInputHarness();
    const onPaste = vi.fn();
    setupTerminalInput(
      harness.terminal,
      harness.state,
      () => false,
      () => false,
      onPaste,
      vi.fn()
    );
    harness.dispatchPaste(pasteEvent('日本語'));

    expect(onPaste).toHaveBeenCalledWith(false, '日本語');
  });

  it('rejects multiline paste instead of changing the command', () => {
    const harness = createInputHarness();
    const onPaste = vi.fn();
    const onError = vi.fn();
    setupTerminalInput(
      harness.terminal,
      harness.state,
      () => false,
      () => false,
      onPaste,
      onError
    );
    harness.dispatchPaste(pasteEvent('rm -rf a\nls'));

    expect(onPaste).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith('Multiline paste is not supported.');
    expect(harness.state.currentLine).toBe('abc');
  });

  it('blocks paste while an active cooked input line is being submitted', () => {
    const harness = createInputHarness();
    const onPaste = vi.fn();
    const lease = terminalProcessBridge.activate(new ProcessStdin());
    try {
      setupTerminalInput(
        harness.terminal,
        harness.state,
        () => false,
        () => true,
        onPaste,
        vi.fn()
      );
      harness.dispatchPaste(pasteEvent('late'));

      expect(onPaste).not.toHaveBeenCalled();
    } finally {
      lease.release();
    }
  });

  it('normalizes raw multiline paste line endings to carriage returns', () => {
    const harness = createInputHarness();
    const onPaste = vi.fn();
    const lease = terminalProcessBridge.activate(new ProcessStdin());
    const submitData = vi.spyOn(lease.stdin, 'submitData');
    try {
      lease.stdin.setRawMode(true);
      setupTerminalInput(
        harness.terminal,
        harness.state,
        () => false,
        () => false,
        onPaste,
        vi.fn()
      );
      harness.dispatchPaste(pasteEvent('line 1\nline 2'));

      expect(submitData).toHaveBeenCalledWith('line 1\rline 2');
      expect(onPaste).not.toHaveBeenCalled();
    } finally {
      lease.release();
    }
  });

  it('wraps raw TTY paste in bracketed paste markers when the terminal mode is active', () => {
    const harness = createInputHarness();
    const lease = terminalProcessBridge.activate(new ProcessStdin());
    const submitData = vi.spyOn(lease.stdin, 'submitData');
    try {
      lease.stdin.setRawMode(true);
      harness.terminal.modes.bracketedPasteMode = true;
      setupTerminalInput(
        harness.terminal,
        harness.state,
        () => false,
        () => false,
        vi.fn(),
        vi.fn()
      );
      harness.dispatchPaste(pasteEvent('line 1\nline 2'));

      expect(submitData).toHaveBeenCalledWith('\x1b[200~line 1\rline 2\x1b[201~');
    } finally {
      lease.release();
    }
  });

  it('drops an async clipboard read after the input session changes', async () => {
    const harness = createInputHarness();
    const onPaste = vi.fn();
    let resolveRead: ((text: string) => void) | undefined;
    const readClipboardText = () =>
      new Promise<string>(resolve => {
        resolveRead = resolve;
      });
    const generation = 4;
    let sessionKey = 'session-1';
    setupTerminalInput(
      harness.terminal,
      harness.state,
      () => false,
      () => false,
      onPaste,
      vi.fn(),
      () => generation,
      readClipboardText,
      () => sessionKey
    );
    harness.getKeyHandler()?.({
      type: 'keydown',
      key: 'v',
      ctrlKey: true,
      metaKey: false,
      shiftKey: false,
      altKey: false,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    });
    sessionKey = 'session-2';
    resolveRead?.('from old input');
    await Promise.resolve();

    expect(onPaste).not.toHaveBeenCalled();
  });
});
