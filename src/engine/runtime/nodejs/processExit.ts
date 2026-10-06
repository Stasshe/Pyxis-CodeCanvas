export interface ProcessExitSignal {
  __pyxisProcessExit: true;
  code: number;
}

export function normalizeProcessExitCode(code: unknown): number {
  let numeric = 0;
  if (code !== undefined) {
    numeric = Number(code);
  }

  if (!Number.isFinite(numeric)) {
    return 0;
  }

  return Math.trunc(numeric) & 0xff;
}

export function createProcessExitSignal(code = 0): ProcessExitSignal {
  return {
    __pyxisProcessExit: true,
    code: normalizeProcessExitCode(code),
  };
}

export function isProcessExitSignal(error: unknown): error is ProcessExitSignal {
  if (error === null || typeof error !== 'object') {
    return false;
  }

  if (!('__pyxisProcessExit' in error) || error.__pyxisProcessExit !== true) {
    return false;
  }

  return 'code' in error && typeof error.code === 'number';
}
