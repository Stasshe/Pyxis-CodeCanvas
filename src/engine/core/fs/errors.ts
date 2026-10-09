import * as Comlink from 'comlink';

export class FSError extends Error {
  readonly cause?: Error;

  constructor(
    public readonly code: string,
    public readonly path: string,
    cause?: Error
  ) {
    let message = `${code}: ${path}`;
    if (cause !== undefined) message += `: ${describeError(cause)}`;
    super(message);
    this.name = 'FSError';
    this.cause = cause;
  }
}

function describeError(error: unknown): string {
  if (error instanceof AggregateError) {
    const children = Array.from(error.errors, describeError).filter(Boolean);
    let cause: unknown;
    if ('cause' in error) cause = error.cause;
    if (cause !== undefined) children.push(`cause: ${describeError(cause)}`);
    if (children.length === 0) return error.message;
    return `${error.message} [${children.join('; ')}]`;
  }
  if (error instanceof Error) {
    let cause: unknown;
    if ('cause' in error) cause = error.cause;
    if (cause === undefined) return error.message;
    return `${error.message} [cause: ${describeError(cause)}]`;
  }
  return String(error);
}

export function translateFsError(error: Error | DOMException, path: string): FSError {
  if (error instanceof FSError) return error;
  let code = 'EIO';
  if (error.name === 'NotFoundError') code = 'ENOENT';
  else if (error.name === 'TypeMismatchError') code = 'ENOTDIR';
  else if (error.name === 'InvalidModificationError') code = 'ENOTEMPTY';
  else if (error.name === 'QuotaExceededError') code = 'ENOSPC';
  else if (error.name === 'NotAllowedError') code = 'EACCES';
  return new FSError(code, path, error);
}

interface ThrownFsError {
  value: FSError;
}
interface SerializedFsError {
  code: string;
  path: string;
  message: string;
  stack?: string;
  cause?: SerializedError;
}
interface SerializedError {
  name: string;
  message: string;
  stack?: string;
  cause?: SerializedError;
  errors?: SerializedError[];
}

function serializeError(error: unknown): SerializedError | undefined {
  if (error === undefined) return undefined;
  if (!(error instanceof Error)) return { name: typeof error, message: String(error) };
  let cause: SerializedError | undefined;
  if ('cause' in error) cause = serializeError(error.cause);
  const serialized: SerializedError = {
    name: error.name,
    message: error.message,
    stack: error.stack,
  };
  if (cause) serialized.cause = cause;
  if (error instanceof AggregateError) {
    serialized.errors = Array.from(
      error.errors,
      nested => serializeError(nested) ?? { name: 'undefined', message: '' }
    );
  }
  return serialized;
}

function deserializeError(error: SerializedError): Error {
  let cause: Error | undefined;
  if (error.cause) cause = deserializeError(error.cause);
  let restored: Error;
  if (error.name === 'AggregateError') {
    restored = new AggregateError((error.errors ?? []).map(deserializeError), error.message);
  } else {
    restored = new Error(error.message);
  }
  restored.name = error.name;
  if (cause) Object.assign(restored, { cause });
  if (error.stack) restored.stack = error.stack;
  return restored;
}

/** Comlink's default Error handler discards errno; preserve it on every endpoint. */
export function registerFsErrors(): void {
  const thrown = Comlink.transferHandlers.get('throw');
  const handler: Comlink.TransferHandler<ThrownFsError, SerializedFsError> = {
    canHandle(value): value is ThrownFsError {
      return (
        Boolean(thrown?.canHandle(value)) &&
        typeof value === 'object' &&
        value !== null &&
        'value' in value &&
        value.value instanceof FSError
      );
    },
    serialize({ value }) {
      const serialized: SerializedFsError = {
        code: value.code,
        path: value.path,
        message: value.message,
        stack: value.stack,
      };
      const cause = serializeError(value.cause);
      if (cause) serialized.cause = cause;
      return [serialized, []];
    },
    deserialize(value) {
      let cause: Error | undefined;
      if (value.cause) cause = deserializeError(value.cause);
      const error = new FSError(value.code, value.path, cause);
      error.message = value.message;
      error.stack = value.stack;
      throw error;
    },
  };
  // The specialized handler must be visited before Comlink's generic thrown Error handler.
  if (!thrown) throw new Error('Comlink throw transfer handler is unavailable.');
  Comlink.transferHandlers.delete('throw');
  Comlink.transferHandlers.set('fs-error', handler);
  Comlink.transferHandlers.set('throw', thrown);
}
