import type { TerminalOutputManager } from '@/engine/system/terminal/terminalOutputManager';
import type { UnicodeTerminal } from '@/engine/system/terminal/unicodeTerminal';
import {
  captureLineAnchor,
  disposeLineAnchor,
  type LineAnchor,
  renderLine,
} from '../../../lib/xterm/lineRenderer';
import { setupTerminalInput, type TerminalInputState } from '../../../lib/xterm/terminalInput';
import type { LatestRenderQueue } from './latestRenderQueue';
import { insertLineText, type LineState } from './lineEditor';
import { completeTerminalLine, type TerminalCompletionSource } from './terminalCompletion';
import type { LineRenderRequest } from './terminalLineRenderQueue';

export type CookedControlDAction = 'eof' | 'flush' | 'delete';

export function cookedControlDAction(text: string, cursor: number): CookedControlDAction {
  if (!text) return 'eof';
  if (cursor >= text.length) return 'flush';
  return 'delete';
}

interface TerminalInputControllerOptions {
  term: UnicodeTerminal;
  inputState: TerminalInputState;
  outputManager: TerminalOutputManager;
  renderQueue: Pick<LatestRenderQueue<LineRenderRequest>, 'flush'>;
  getAnchor(interactive: boolean): LineAnchor | null;
  setAnchor(interactive: boolean, anchor: LineAnchor | null): void;
  getLineState(interactive: boolean): LineState;
  setLineState(interactive: boolean, state: LineState): void;
  renderEditedLine(interactive: boolean): void;
  getGeneration(): number;
  advanceGeneration(): number;
  getSessionKey(): string;
  isSessionActive(): boolean;
  isRaw(): boolean;
  isVimModeActive(): boolean;
  isInputLocked(): boolean;
  canReportInputError(): boolean;
  setInputOutputPending(pending: boolean): void;
  setCompletionListing(listing: boolean): void;
  getCompletionSource(): TerminalCompletionSource | null;
  writeOutput(text: string): Promise<void>;
  showPrompt(): Promise<void>;
  onError(message: string): void;
}

export function createTerminalInputController(options: TerminalInputControllerOptions) {
  const completeLine = async (interactive: boolean) => {
    const generation = options.advanceGeneration();
    const sessionKey = options.getSessionKey();
    const { text: line, cursor } = options.getLineState(interactive);
    const isCurrent = () => {
      if (generation !== options.getGeneration() || sessionKey !== options.getSessionKey()) {
        return false;
      }
      const current = options.getLineState(interactive);
      return current.text === line && current.cursor === cursor;
    };
    const completion = await completeTerminalLine(line, cursor, options.getCompletionSource(), [
      'clear',
      'history',
      'vim',
    ]);
    if (!isCurrent()) return;
    if (!completion) {
      options.renderEditedLine(interactive);
      return;
    }
    if (completion.state) {
      options.setLineState(interactive, completion.state);
      return;
    }

    options.setCompletionListing(true);
    try {
      await options.renderQueue.flush();
      if (!isCurrent()) return;
      let anchor = options.getAnchor(interactive);
      if (!anchor) {
        await options.outputManager.flush();
        if (!isCurrent()) return;
        anchor = captureLineAnchor(
          options.term,
          () =>
            sessionKey === options.getSessionKey() &&
            options.isSessionActive() === interactive &&
            !options.isRaw() &&
            !options.isVimModeActive()
        );
        options.setAnchor(interactive, anchor);
      }
      await options.outputManager.writeRaw('\r\n');
      if (!isCurrent()) return;
      await options.writeOutput(`${completion.candidates.join('  ')}\n`);
      if (!isCurrent()) return;
      await options.outputManager.writeRaw(anchor.prompt);
      if (!isCurrent()) return;
      disposeLineAnchor(anchor);
      options.setAnchor(interactive, null);
      options.renderEditedLine(interactive);
    } finally {
      options.setCompletionListing(false);
    }
  };

  const reportInputError = async (message: string) => {
    if (
      options.isInputLocked() ||
      options.isVimModeActive() ||
      options.isRaw() ||
      !options.canReportInputError()
    ) {
      options.onError(message);
      return;
    }
    const interactive = options.isSessionActive();
    const sessionKey = options.getSessionKey();
    options.advanceGeneration();
    options.renderEditedLine(interactive);
    options.setInputOutputPending(true);
    try {
      await options.renderQueue.flush();
      if (!options.canReportInputError() || sessionKey !== options.getSessionKey()) {
        options.onError(message);
        return;
      }
      const anchor = options.getAnchor(interactive);
      const state = options.getLineState(interactive);
      const prompt = anchor?.prompt;
      if (anchor) await renderLine(options.term, anchor, { ...state, cursor: state.text.length });
      else await options.outputManager.flush();
      if (sessionKey !== options.getSessionKey()) return;
      if (anchor) {
        disposeLineAnchor(anchor);
        options.setAnchor(interactive, null);
      }
      await options.outputManager.writeRaw('\r\n');
      if (sessionKey !== options.getSessionKey()) return;
      await options.outputManager.writeError(`${message}\r\n`);
      if (sessionKey !== options.getSessionKey()) return;
      if (prompt) await options.outputManager.writeRaw(prompt);
      else if (!interactive) await options.showPrompt();
      if (sessionKey !== options.getSessionKey()) return;
      const nextAnchor = captureLineAnchor(
        options.term,
        () => sessionKey === options.getSessionKey() && !options.isRaw()
      );
      options.setAnchor(interactive, nextAnchor);
      await renderLine(options.term, nextAnchor, state);
    } finally {
      options.setInputOutputPending(false);
    }
  };

  const setup = () =>
    setupTerminalInput(
      options.term,
      options.inputState,
      options.isVimModeActive,
      options.isInputLocked,
      (interactive, text) => {
        const line = options.getLineState(interactive);
        options.setLineState(interactive, insertLineText(line, text));
      },
      message => void reportInputError(message).catch(error => options.onError(String(error))),
      options.getGeneration,
      undefined,
      options.getSessionKey
    );

  setup();
  return { completeLine, reportInputError };
}
