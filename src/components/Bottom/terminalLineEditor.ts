import type { TerminalOutputManager } from '@/engine/cmd/terminalOutputManager';
import { terminalProcessBridge } from '@/engine/cmd/terminalProcessBridge';
import type { UnicodeTerminal } from '@/engine/cmd/unicodeTerminal';
import type { LatestRenderQueue } from './latestRenderQueue';
import type { LineState } from './lineEditor';
import type { LineAnchor } from './lineRenderer';
import { disposeLineAnchor } from './lineRenderer';
import type { TerminalInputState } from './terminalInput';
import type { LineRenderRequest } from './terminalLineRenderQueue';
import { createTerminalLineRenderQueue } from './terminalLineRenderQueue';

export class TerminalLineEditor {
  canonicalAnchor: LineAnchor | null = null;
  interactiveAnchor: LineAnchor | null = null;
  private canonicalAnchorSession = '';
  private interactiveAnchorSession = '';
  private generation = 0;
  readonly renderQueue: LatestRenderQueue<LineRenderRequest>;

  constructor(
    term: UnicodeTerminal,
    outputManager: TerminalOutputManager,
    private readonly inputState: TerminalInputState,
    private readonly canRender: (interactive: boolean) => boolean,
    private readonly getSessionKey: () => string
  ) {
    this.renderQueue = createTerminalLineRenderQueue(
      term,
      outputManager,
      interactive => this.getAnchor(interactive),
      (interactive, anchor) => this.setAnchor(interactive, anchor),
      () => this.generation,
      getSessionKey,
      canRender
    );
  }

  get currentGeneration(): number {
    return this.generation;
  }

  bumpGeneration(): number {
    this.generation += 1;
    return this.generation;
  }

  getAnchor(interactive: boolean): LineAnchor | null {
    const anchor = interactive ? this.interactiveAnchor : this.canonicalAnchor;
    const anchorSession = interactive ? this.interactiveAnchorSession : this.canonicalAnchorSession;
    if (anchor && anchorSession !== this.getSessionKey()) {
      this.clearAnchor(interactive);
      return null;
    }
    return anchor;
  }

  setAnchor(interactive: boolean, anchor: LineAnchor | null): void {
    const current = interactive ? this.interactiveAnchor : this.canonicalAnchor;
    if (current && current !== anchor) disposeLineAnchor(current);
    if (interactive) {
      this.interactiveAnchor = anchor;
      this.interactiveAnchorSession = anchor ? this.getSessionKey() : '';
    } else {
      this.canonicalAnchor = anchor;
      this.canonicalAnchorSession = anchor ? this.getSessionKey() : '';
    }
  }

  getState(interactive: boolean): LineState {
    return {
      text: interactive ? this.inputState.interactiveLine : this.inputState.currentLine,
      cursor: interactive ? this.inputState.interactivePos : this.inputState.cursorPos,
    };
  }

  setState(interactive: boolean, state: LineState): void {
    this.bumpGeneration();
    if (interactive) {
      this.inputState.interactiveLine = state.text;
      this.inputState.interactivePos = state.cursor;
    } else {
      this.inputState.currentLine = state.text;
      this.inputState.cursorPos = state.cursor;
    }
    this.render(interactive);
  }

  render(interactive: boolean): void {
    this.renderQueue.enqueue({
      interactive,
      state: this.getState(interactive),
      generation: this.generation,
      sessionKey: this.getSessionKey(),
    });
  }

  clearAnchor(interactive: boolean): void {
    const anchor = interactive ? this.interactiveAnchor : this.canonicalAnchor;
    if (anchor) disposeLineAnchor(anchor);
    if (interactive) {
      this.interactiveAnchor = null;
      this.interactiveAnchorSession = '';
    } else {
      this.canonicalAnchor = null;
      this.canonicalAnchorSession = '';
    }
  }

  clearAll(): void {
    this.clearAnchor(false);
    this.clearAnchor(true);
  }

  deactivate(): void {
    this.bumpGeneration();
    this.inputState.interactiveLine = '';
    this.inputState.interactivePos = 0;
    this.clearAnchor(true);
  }

  handleResize(): void {
    if (this.getAnchor(false) && this.canRender(false)) this.render(false);
    if (this.getAnchor(true) && this.canRender(true)) this.render(true);
  }

  registerLifecycle(term: Pick<UnicodeTerminal, 'onResize'>) {
    const unsubscribe = terminalProcessBridge.setDeactivateCallback(() => this.deactivate());
    const resize = term.onResize(() => this.handleResize());
    return {
      dispose: () => {
        resize.dispose();
        unsubscribe();
      },
    };
  }
}
