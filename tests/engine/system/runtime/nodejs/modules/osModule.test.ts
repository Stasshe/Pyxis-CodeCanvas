import { describe, expect, it } from 'vitest';
import { signalExitCode } from '@/engine/system/shell/process';
import { createOSModule } from '@/engine/system/runtime/nodejs/modules/osModule';
import { signalConstants } from '@/engine/system/runtime/nodejs/signalConstants';

describe('Node os module', () => {
  it('exposes Linux signal constants shared with shell signal handling', () => {
    const os = createOSModule('/home/test');

    expect(os.constants.signals).toBe(signalConstants);
    expect(os.constants.signals).toMatchObject({
      SIGINT: 2,
      SIGTERM: 15,
      SIGSTKFLT: 16,
      SIGCHLD: 17,
      SIGIO: 29,
      SIGPOLL: 29,
      SIGSYS: 31,
    });
    expect(signalExitCode('SIGTERM')).toBe(143);
    expect(signalExitCode('SIGSTKFLT')).toBe(144);
    expect(signalExitCode('unknown')).toBe(1);
    expect(Object.isFrozen(os.constants.signals)).toBe(true);
  });
});
