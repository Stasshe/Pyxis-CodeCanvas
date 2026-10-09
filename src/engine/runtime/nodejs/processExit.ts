export interface ProcessExitSignal {
  __pyxisProcessExit: true;
  code: number;
}

export function validateProcessExitCode(
  value: number | string | undefined | null
): number | undefined {
  if (value === undefined || value === null) return undefined;

  let numeric: number;
  if (typeof value === 'number') {
    numeric = value;
  } else if (typeof value === 'string') {
    if (value === '') throw createExitCodeTypeError(value);
    numeric = Number(value);
    if (Number.isNaN(numeric)) throw createExitCodeTypeError(value);
  } else {
    throw createExitCodeTypeError(value);
  }

  if (!Number.isInteger(numeric)) throw createExitCodeRangeError(value);
  return numeric | 0;
}

function createExitCodeTypeError(value: number | string | null): TypeError {
  const error = new TypeError(
    `The "code" argument must be an integer or numeric string. Received ${String(value)}`
  );
  Object.assign(error, { code: 'ERR_INVALID_ARG_TYPE' });
  return error;
}

function createExitCodeRangeError(value: number | string): RangeError {
  const error = new RangeError(`The "code" argument must be an integer. Received ${String(value)}`);
  Object.assign(error, { code: 'ERR_OUT_OF_RANGE' });
  return error;
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
