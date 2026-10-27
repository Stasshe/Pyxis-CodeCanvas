import type { RuntimeFsMount } from '@/engine/system/runtime/fs/RuntimeFsMount';
import { constants } from './constantsModule';
import type { RuntimeFsDescriptors } from './fsDescriptors';
import type { FsPath } from './fsPaths';

type NormalizePath = (path: FsPath) => string;
export interface ModeOptions {
  mode?: number | string;
}

function typeError(value: number | string): TypeError {
  let received = 'an object with a null prototype';
  try {
    received = String(value);
  } catch {}
  return Object.assign(
    new TypeError(`The "mode" argument must be of type number or string. Received ${received}`),
    { code: 'ERR_INVALID_ARG_TYPE' }
  );
}

function modeError(value: number | string): Error {
  if (typeof value === 'string')
    return Object.assign(
      new TypeError(
        `The argument 'mode' must be a 32-bit unsigned integer or an octal string. Received '${value}'`
      ),
      { code: 'ERR_INVALID_ARG_VALUE' }
    );
  let requirement = 'It must be an integer.';
  if (Number.isInteger(value)) requirement = 'It must be >= 0 && <= 4294967295.';
  return Object.assign(
    new RangeError(`The value of "mode" is out of range. ${requirement} Received ${value}`),
    { code: 'ERR_OUT_OF_RANGE' }
  );
}

export function parseMode(value: number | string): number {
  let mode: number;
  if (typeof value === 'number') mode = value;
  else if (typeof value === 'string' && /^[0-7]+$/.test(value)) mode = Number.parseInt(value, 8);
  else if (typeof value === 'string') throw modeError(value);
  else throw typeError(value);
  if (!Number.isInteger(mode) || mode < 0 || mode > 0xffffffff) throw modeError(value);
  return mode;
}

export function creationMode(value: number | string): number {
  return parseMode(value) & 0o7777 & ~0o022;
}

export function writeCreationMode(
  options: ModeOptions | string | null | undefined
): number | undefined {
  if (options === null || typeof options !== 'object') return undefined;
  if (!('mode' in options) || options.mode === undefined) return undefined;
  return creationMode(options.mode);
}

function fileSystemError(error: unknown, syscall: string, path?: FsPath): Error {
  if (!(error instanceof Error)) return new Error(String(error));
  let result = Object.assign(error, { syscall });
  if (path !== undefined && !('path' in result))
    result = Object.assign(result, { path: String(path) });
  if ('code' in result && typeof result.code === 'string' && !('errno' in result)) {
    let errno: number | undefined;
    if (result.code === 'ENOENT') errno = -2;
    else if (result.code === 'EBADF') errno = -9;
    else if (result.code === 'EACCES') errno = -13;
    if (errno !== undefined) result = Object.assign(result, { errno });
  }
  return result;
}

function missingPath(syscall: string, path: FsPath): Error {
  return Object.assign(new Error(`ENOENT: ${syscall} '${String(path)}'`), {
    code: 'ENOENT',
    errno: -2,
    syscall,
    path: String(path),
  });
}

function accessError(path: string): Error {
  return Object.assign(new Error(`EACCES: access '${path}'`), {
    code: 'EACCES',
    errno: -13,
    syscall: 'access',
    path,
  });
}

function checkPermissions(path: string, requested: number, available: number): void {
  if ((requested & constants.R_OK) !== 0 && (available & 0o444) === 0) {
    throw accessError(path);
  }
  if ((requested & constants.W_OK) !== 0 && (available & 0o222) === 0) {
    throw accessError(path);
  }
  if ((requested & constants.X_OK) !== 0 && (available & 0o111) === 0) {
    throw accessError(path);
  }
}

export function createFsPermissionOperations(
  filesystem: RuntimeFsMount,
  descriptors: RuntimeFsDescriptors,
  normalize: NormalizePath
) {
  async function accessPath(path: FsPath, requested: number = constants.F_OK): Promise<void> {
    const value = await filesystem.stat(normalize(path));
    if (!value) throw missingPath('access', path);
    checkPermissions(String(path), requested, value.mode);
  }

  function checkAccess(path: FsPath, requested: number = constants.F_OK): void {
    const value = filesystem.statSync(normalize(path));
    if (!value) throw missingPath('access', path);
    checkPermissions(String(path), requested, value.mode);
  }

  function chmodPath(path: FsPath, mode: number | string): Promise<void> {
    const parsedMode = parseMode(mode);
    const normalized = normalize(path);
    let task: Promise<void>;
    try {
      task = filesystem.chmod(normalized, parsedMode);
    } catch (error) {
      throw fileSystemError(error, 'chmod', path);
    }
    return task.catch(error => {
      throw fileSystemError(error, 'chmod', path);
    });
  }

  async function chmodPathPromise(path: FsPath, mode: number | string): Promise<void> {
    await chmodPath(path, mode);
  }

  function chmodPathSync(path: FsPath, mode: number | string): void {
    const parsedMode = parseMode(mode);
    try {
      filesystem.chmodSync(normalize(path), parsedMode);
    } catch (error) {
      throw fileSystemError(error, 'chmod', path);
    }
  }

  function chmodDescriptor(descriptor: number, mode: number | string): void {
    const parsedMode = parseMode(mode);
    try {
      descriptors.chmodSync(descriptor, parsedMode);
    } catch (error) {
      throw fileSystemError(error, 'fchmod');
    }
  }

  function chmodDescriptorAsync(descriptor: number, mode: number | string): Promise<void> {
    return descriptors.chmod(descriptor, parseMode(mode)).catch(error => {
      throw fileSystemError(error, 'fchmod');
    });
  }

  return {
    accessPath,
    checkAccess,
    chmodPath,
    chmodPathPromise,
    chmodPathSync,
    chmodDescriptor,
    chmodDescriptorAsync,
  };
}
