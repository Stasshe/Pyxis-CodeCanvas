import type EventEmitter from 'events';

type Payload =
  Parameters<EventEmitter['emit']> extends [string | symbol, ...infer Args] ? Args : never;
type Listener = (...args: Payload) => void;
type Source = EventEmitter | EventTarget;
type Options = NonNullable<Parameters<typeof EventEmitter.on>[2]> & {
  highWatermark?: number;
  lowWatermark?: number;
};
type FlowSource = Source & { pause(): void; resume(): void };
type Pending = {
  resolve(value: IteratorResult<Payload>): void;
  reject(error: Error): void;
};

function invalidType(name: string, expected: string): TypeError {
  return Object.assign(new TypeError(`The "${name}" argument must be of type ${expected}.`), {
    code: 'ERR_INVALID_ARG_TYPE',
  });
}

function watermark(value: number, name: string): number {
  if (typeof value !== 'number') throw invalidType(name, 'number');
  if (!Number.isInteger(value) || value < 1 || value > Number.MAX_SAFE_INTEGER) {
    throw Object.assign(new RangeError(`The value of "${name}" is out of range.`), {
      code: 'ERR_OUT_OF_RANGE',
    });
  }
  return value;
}

function abortError(signal: AbortSignal): Error {
  return Object.assign(new Error('The operation was aborted', { cause: signal.reason }), {
    name: 'AbortError',
    code: 'ABORT_ERR',
  });
}

export function on(source: Source, event: string | symbol, options: Options = {}) {
  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    throw invalidType('options', 'Object');
  }
  const signal = options.signal;
  if (
    signal !== undefined &&
    (signal === null || typeof signal !== 'object' || !('aborted' in signal))
  ) {
    throw invalidType('options.signal', 'AbortSignal');
  }
  if (signal?.aborted) throw abortError(signal);
  const high = watermark(
    options.highWaterMark ?? options.highWatermark ?? Number.MAX_SAFE_INTEGER,
    'options.highWaterMark'
  );
  const low = watermark(options.lowWaterMark ?? options.lowWatermark ?? 1, 'options.lowWaterMark');
  const queued: Payload[] = [];
  const pending: Pending[] = [];
  const removals: (() => void)[] = [];
  let paused = false;
  let finished = false;
  let error: Error | null = null;
  const done: IteratorResult<Payload> = { value: undefined, done: true };

  function listen(name: string | symbol, listener: Listener) {
    if (source && 'on' in source && typeof source.on === 'function') {
      source.on(name, listener);
      removals.push(() => source.removeListener(name, listener));
    } else if (
      source &&
      'addEventListener' in source &&
      typeof source.addEventListener === 'function'
    ) {
      source.addEventListener(name as string, listener);
      removals.push(() => source.removeEventListener(name as string, listener));
    } else {
      throw invalidType('emitter', 'EventEmitter');
    }
  }

  function close() {
    signal?.removeEventListener('abort', abort);
    for (const remove of removals.splice(0).reverse()) remove();
    finished = true;
    paused = false;
    for (const promise of pending.splice(0)) promise.resolve(done);
    return Promise.resolve(done);
  }

  function fail(failure: Error) {
    const promise = pending.shift();
    if (promise) promise.reject(failure);
    else error = failure;
    close();
  }

  function abort() {
    if (signal) fail(abortError(signal));
  }

  const iterator = {
    next(): Promise<IteratorResult<Payload>> {
      if (queued.length) {
        const value = queued.shift() as Payload;
        if (paused && queued.length < low) {
          (source as FlowSource).resume();
          paused = false;
        }
        return Promise.resolve({ value, done: false });
      }
      if (error) {
        const failure = error;
        error = null;
        return Promise.reject(failure);
      }
      if (finished) return close();
      return new Promise<IteratorResult<Payload>>((resolve, reject) => {
        pending.push({ resolve, reject });
      });
    },
    return: close,
    throw(failure: Error) {
      if (!(failure instanceof Error)) throw invalidType('EventEmitter.AsyncIterator', 'Error');
      fail(failure);
    },
    [Symbol.asyncIterator]() {
      return this;
    },
  };

  listen(event, (...args) => {
    const promise = pending.shift();
    if (promise) promise.resolve({ value: args, done: false });
    else {
      // Node pauses before inserting the event into its queue.
      if (!paused && queued.length + 1 > high) {
        paused = true;
        (source as FlowSource).pause();
      }
      queued.push(args);
    }
  });
  if (event !== 'error' && 'on' in source && typeof source.on === 'function') {
    listen('error', fail);
  }
  for (const name of options.close ?? []) listen(name, close);
  signal?.addEventListener('abort', abort, { once: true });
  return iterator;
}
