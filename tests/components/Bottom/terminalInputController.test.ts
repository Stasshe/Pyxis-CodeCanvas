import { afterEach, describe, expect, it } from 'vitest';
import {
  cookedControlDAction,
  createTerminalInputController,
} from '@/components/Bottom/terminalInputController';
import { TerminalLineEditor } from '@/components/Bottom/terminalLineEditor';
import { TerminalOutputManager } from '@/engine/cmd/terminalOutputManager';
import type { UnicodeTerminal } from '@/engine/cmd/unicodeTerminal';
import { createUnicodeTerminal } from '../../_helpers/unicodeTerminal';

const terminals: UnicodeTerminal[] = [];

async function terminal(): Promise<UnicodeTerminal> {
  const instance = await createUnicodeTerminal({ cols: 24, rows: 5 });
  terminals.push(instance);
  return instance;
}

function write(term: UnicodeTerminal, data: string): Promise<void> {
  return new Promise(resolve => term.write(data, resolve));
}

describe('cooked terminal Ctrl+D', () => {
  it('sends a nonempty line at its end without treating it as EOF', () => {
    expect(cookedControlDAction('abc', 3)).toBe('flush');
  });

  it('keeps EOF and mid-line deletion distinct', () => {
    expect(cookedControlDAction('', 0)).toBe('eof');
    expect(cookedControlDAction('abc', 1)).toBe('delete');
  });
});

afterEach(() => {
  for (const instance of terminals.splice(0)) instance.dispose();
});

describe('terminal input controller', () => {
  it('keeps clipboard errors visible while restoring the edited input line', async () => {
    const term = await terminal();
    await write(term, '$ ');
    const outputManager = new TerminalOutputManager(term);
    const state = {
      currentLine: '',
      cursorPos: 0,
      interactiveLine: '',
      interactivePos: 0,
      isComposing: false,
    };
    const editor = new TerminalLineEditor(
      term,
      outputManager,
      state,
      () => true,
      () => 'idle'
    );
    editor.setState(false, { text: 'abc', cursor: 1 });
    await editor.renderQueue.flush();
    const controller = createTerminalInputController({
      term,
      inputState: state,
      outputManager,
      renderQueue: editor.renderQueue,
      getAnchor: interactive => editor.getAnchor(interactive),
      setAnchor: (interactive, anchor) => editor.setAnchor(interactive, anchor),
      getLineState: interactive => editor.getState(interactive),
      setLineState: (interactive, next) => editor.setState(interactive, next),
      renderEditedLine: interactive => editor.render(interactive),
      getGeneration: () => editor.currentGeneration,
      advanceGeneration: () => editor.bumpGeneration(),
      getSessionKey: () => 'idle',
      isSessionActive: () => false,
      isRaw: () => false,
      isVimModeActive: () => false,
      isInputLocked: () => false,
      canReportInputError: () => true,
      setInputOutputPending: () => {},
      setCompletionListing: () => {},
      getCompletionSource: () => null,
      writeOutput: async text => outputManager.write(text),
      showPrompt: async () => outputManager.writeRaw('$ '),
      onError: () => {},
    });

    await controller.reportInputError('Clipboard failed');

    const rows = Array.from({ length: term.rows }, (_, row) =>
      term.buffer.active.getLine(row)?.translateToString(true)
    );
    expect(rows).toContain('Clipboard failed');
    expect(rows).toContain('$ abc');
    expect(state.currentLine).toBe('abc');
    expect(state.cursorPos).toBe(1);
  });
});
