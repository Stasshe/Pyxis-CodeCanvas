import { afterEach, describe, expect, it } from 'vitest';
import { TerminalLineEditor } from '@/engine/system/terminal/terminalLineEditor';
import { TerminalOutputManager } from '@/engine/system/terminal/terminalOutputManager';
import type { UnicodeTerminal } from '@/engine/system/terminal/unicodeTerminal';
import { createUnicodeTerminal } from '../../../_helpers/unicodeTerminal';

const terminals: UnicodeTerminal[] = [];

async function terminal(): Promise<UnicodeTerminal> {
  const instance = await createUnicodeTerminal({ cols: 20, rows: 4 });
  terminals.push(instance);
  return instance;
}

function write(term: UnicodeTerminal, data: string): Promise<void> {
  return new Promise(resolve => term.write(data, resolve));
}

afterEach(() => {
  for (const instance of terminals.splice(0)) instance.dispose();
});

describe('terminal line editor lifecycle', () => {
  it('discards a queued redraw when the input session changes before output flush', async () => {
    const term = await terminal();
    await write(term, '$ ');
    const state = {
      currentLine: '',
      cursorPos: 0,
      interactiveLine: '',
      interactivePos: 0,
      isComposing: false,
    };
    let sessionVersion = 1;
    const editor = new TerminalLineEditor(
      term,
      new TerminalOutputManager(term),
      state,
      () => true,
      () => String(sessionVersion)
    );

    editor.setState(false, { text: 'stale', cursor: 5 });
    sessionVersion += 1;
    await editor.renderQueue.flush();

    expect(term.buffer.active.getLine(0)?.translateToString(true)).toBe('$ ');
  });

  it('discards a queued interactive redraw after process deactivation', async () => {
    const term = await terminal();
    await write(term, 'input> ');
    const state = {
      currentLine: '',
      cursorPos: 0,
      interactiveLine: '',
      interactivePos: 0,
      isComposing: false,
    };
    const editor = new TerminalLineEditor(
      term,
      new TerminalOutputManager(term),
      state,
      () => true,
      () => 'active'
    );

    editor.setState(true, { text: 'stale', cursor: 5 });
    editor.deactivate();
    await editor.renderQueue.flush();

    expect(state.interactiveLine).toBe('');
    expect(term.buffer.active.getLine(0)?.translateToString(true)).toBe('input> ');
    expect(editor.interactiveAnchor).toBeNull();
  });

  it('disposes a prompt anchor when the stdin session version changes', async () => {
    const term = await terminal();
    await write(term, '$ ');
    const state = {
      currentLine: '',
      cursorPos: 0,
      interactiveLine: '',
      interactivePos: 0,
      isComposing: false,
    };
    let sessionVersion = 1;
    const editor = new TerminalLineEditor(
      term,
      new TerminalOutputManager(term),
      state,
      () => true,
      () => String(sessionVersion)
    );
    editor.setState(false, { text: 'input', cursor: 5 });
    await editor.renderQueue.flush();
    const staleAnchor = editor.canonicalAnchor;

    sessionVersion += 1;

    expect(editor.getAnchor(false)).toBeNull();
    expect(staleAnchor?.disposed).toBe(true);
  });
});
