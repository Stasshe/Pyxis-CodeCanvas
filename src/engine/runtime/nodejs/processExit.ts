export interface ProcessExitSignal {
  __pyxisProcessExit: true;
  code: number;
}

export function normalizeProcessExitCode(code: unknown): number {
  const numeric = code === undefined ? 0 : Number(code);

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
  return !!error && typeof error === 'object' && (error as ProcessExitSignal).__pyxisProcessExit === true;
}
