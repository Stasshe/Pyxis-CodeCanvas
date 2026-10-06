import * as Comlink from 'comlink';

export class FSError extends Error {
  constructor(
    public readonly code: string,
    public readonly path: string
  ) {
    super(`${code}: ${path}`);
    this.name = 'FSError';
  }
}

interface ThrownFsError {
  value: FSError;
}
interface SerializedFsError {
  code: string;
  path: string;
  stack?: string;
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
      return [{ code: value.code, path: value.path, stack: value.stack }, []];
    },
    deserialize(value) {
      const error = new FSError(value.code, value.path);
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
