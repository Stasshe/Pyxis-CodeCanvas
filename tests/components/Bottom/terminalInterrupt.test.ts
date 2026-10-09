import { describe, expect, it } from 'vitest';
import { getTerminalInterruptAction } from '@/components/Bottom/terminalInterrupt';

describe('getTerminalInterruptAction', () => {
  const idleTarget = {
    shellWasRunning: false,
    isShellCommandRunning: () => false,
    stdin: null,
    sessionKey: 'session-1',
    getSessionKey: () => 'session-1',
    isCommandQueued: () => false,
    commandWasProcessing: false,
    isProcessingCommand: () => false,
  };

  it('does not print a second prompt when the command finishes during interrupt output', () => {
    const target = {
      ...idleTarget,
      commandWasProcessing: true,
      isProcessingCommand: () => false,
    };

    expect(getTerminalInterruptAction(target)).toBe('none');
  });

  it('does not print a prompt if a queued command starts during interrupt output', () => {
    const target = {
      ...idleTarget,
      isProcessingCommand: () => true,
    };

    expect(getTerminalInterruptAction(target)).toBe('none');
  });

  it('cancels only a command that is still queued', () => {
    const target = {
      ...idleTarget,
      isCommandQueued: () => true,
    };

    expect(getTerminalInterruptAction(target)).toBe('cancel-command');
  });
});
