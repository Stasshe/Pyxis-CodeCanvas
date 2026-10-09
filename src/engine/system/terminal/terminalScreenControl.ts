import type { TerminalOutputManager } from '@/engine/system/terminal/terminalOutputManager';
import type { TerminalLineEditor } from './terminalLineEditor';

export async function clearTerminalScreen(
  outputManager: TerminalOutputManager,
  editor: TerminalLineEditor,
  showPrompt: () => Promise<void>,
  getSessionKey: () => string,
  sessionKey: string
): Promise<void> {
  await editor.renderQueue.flush();
  if (sessionKey !== getSessionKey()) return;
  await outputManager.writeRaw('\x1b[H\x1b[2J');
  if (sessionKey !== getSessionKey()) return;
  editor.clearAnchor(false);
  await showPrompt();
  if (sessionKey !== getSessionKey()) return;
  editor.render(false);
}
