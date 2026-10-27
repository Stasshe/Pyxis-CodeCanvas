import { describe, expect, it } from 'vitest';
import { resolveCanonicalCommand } from '@/engine/system/terminal/canonicalCommandState';
import { getTerminalInterruptAction } from '@/engine/system/terminal/terminalInterrupt';

describe('canonical command submission state', () => {
  it('clears a canceled empty submission before the next idle interrupt', () => {
    const state = { queued: Boolean('echo'.trim()), cancelled: true };

    expect(resolveCanonicalCommand(state, '')).toBe('empty');
    expect(state).toEqual({ queued: false, cancelled: false });

    const nextInterrupt = getTerminalInterruptAction({
      shellWasRunning: false,
      isShellCommandRunning: () => false,
      stdin: null,
      sessionKey: 'session-1',
      getSessionKey: () => 'session-1',
      isCommandQueued: () => state.queued,
      commandWasProcessing: false,
      isProcessingCommand: () => false,
    });

    expect(nextInterrupt).toBe('prompt');
  });

  it('consumes cancellation when a queued command is canceled', () => {
    const state = { queued: true, cancelled: true };

    expect(resolveCanonicalCommand(state, 'echo')).toBe('cancel');
    expect(state).toEqual({ queued: false, cancelled: false });
  });
});
