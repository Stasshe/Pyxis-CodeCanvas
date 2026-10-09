import type { TerminalOutputManager } from '@/engine/cmd/terminalOutputManager';
import { LatestRenderQueue } from './latestRenderQueue';
import type { LineState } from './lineEditor';
import { captureLineAnchor, type LineAnchor, type LineTerminal, renderLine } from './lineRenderer';

export interface LineRenderRequest {
  interactive: boolean;
  state: LineState;
  generation: number;
  sessionKey: string;
}

export function createTerminalLineRenderQueue(
  term: LineTerminal,
  outputManager: Pick<TerminalOutputManager, 'flush' | 'writeError'>,
  getAnchor: (interactive: boolean) => LineAnchor | null,
  setAnchor: (interactive: boolean, anchor: LineAnchor) => void,
  getGeneration: () => number,
  getSessionKey: () => string,
  canRender: (interactive: boolean) => boolean
) {
  return new LatestRenderQueue<LineRenderRequest>(
    async ({ interactive, state, generation, sessionKey }) => {
      await outputManager.flush();
      if (
        generation !== getGeneration() ||
        sessionKey !== getSessionKey() ||
        !canRender(interactive)
      ) {
        return;
      }
      let anchor = getAnchor(interactive);
      if (!anchor) {
        anchor = captureLineAnchor(
          term,
          () => sessionKey === getSessionKey() && canRender(interactive)
        );
        setAnchor(interactive, anchor);
      }
      await renderLine(term, anchor, state);
    },
    error => void outputManager.writeError(`${String(error)}\r\n`)
  );
}
