import type StreamShell from '@/engine/system/shell/streamShell';
import type { TerminalOutputManager } from '@/engine/system/terminal/terminalOutputManager';
import type { ProcessStdin } from '@/engine/system/terminal/terminalProcessBridge';
import type { TerminalInputState } from '../../../lib/xterm/terminalInput';
import type { TerminalLineEditor } from './terminalLineEditor';

interface TerminalInterruptTarget {
  shellWasRunning: boolean;
  isShellCommandRunning(): boolean;
  shell: Pick<StreamShell, 'killForeground'> | null;
  stdin: ProcessStdin | null;
  sessionKey: string;
  getSessionKey(): string;
  commandWasProcessing: boolean;
  isCommandQueued(): boolean;
  cancelQueuedCommand(): void;
  isProcessingCommand(): boolean;
  showPrompt(): Promise<void>;
}

export type TerminalInterruptAction =
  | 'kill-shell'
  | 'interrupt-stdin'
  | 'cancel-command'
  | 'prompt'
  | 'none';

export function getTerminalInterruptAction(
  target: Pick<
    TerminalInterruptTarget,
    | 'shellWasRunning'
    | 'isShellCommandRunning'
    | 'stdin'
    | 'sessionKey'
    | 'getSessionKey'
    | 'isCommandQueued'
    | 'commandWasProcessing'
    | 'isProcessingCommand'
  >
): TerminalInterruptAction {
  if (target.shellWasRunning || target.isShellCommandRunning()) return 'kill-shell';
  if (target.stdin && target.sessionKey === target.getSessionKey()) return 'interrupt-stdin';
  if (target.isCommandQueued()) return 'cancel-command';
  if (!target.commandWasProcessing && !target.isProcessingCommand()) return 'prompt';
  return 'none';
}

export async function finishTerminalInterrupt(
  editor: TerminalLineEditor,
  output: TerminalOutputManager,
  inputState: TerminalInputState,
  target: TerminalInterruptTarget
): Promise<void> {
  await editor.renderQueue.flush();
  editor.clearAll();
  inputState.currentLine = '';
  inputState.cursorPos = 0;
  inputState.interactiveLine = '';
  inputState.interactivePos = 0;
  await output.writeRaw('^C\r\n');
  const action = getTerminalInterruptAction(target);
  if (action === 'kill-shell') {
    target.shell?.killForeground('SIGINT');
  } else if (action === 'interrupt-stdin') {
    target.stdin?.interrupt();
  } else if (action === 'cancel-command') {
    target.cancelQueuedCommand();
  } else if (action === 'prompt') {
    await target.showPrompt();
  }
}
