export type IDisposable = {
  [Symbol.dispose](): void;
};

export type AbortListener = (event: Event) => void;

function invalidArgType(argument: string, expected: string, received: string): TypeError {
  const error = new TypeError(
    `The "${argument}" argument must be ${expected}. Received ${received}`
  );
  Object.assign(error, { code: 'ERR_INVALID_ARG_TYPE' });
  return error;
}

function signalError(signal: AbortSignal): TypeError {
  if (signal === null) return invalidArgType('signal', 'an instance of AbortSignal', 'null');
  if (signal === undefined) {
    return invalidArgType('signal', 'an instance of AbortSignal', 'undefined');
  }
  const signalType = typeof signal;
  if (signalType !== 'object' && signalType !== 'function') {
    return invalidArgType(
      'signal',
      'an instance of AbortSignal',
      `type ${signalType} (${String(signal)})`
    );
  }
  const constructorValue = Reflect.get(signal, 'constructor');
  if (typeof constructorValue !== 'function') {
    return invalidArgType('signal', 'an instance of AbortSignal', 'an instance of Object');
  }
  const constructorName = Reflect.get(constructorValue, 'name');
  if (typeof constructorName !== 'string') {
    return invalidArgType('signal', 'an instance of AbortSignal', 'an instance of Object');
  }
  return invalidArgType(
    'signal',
    'an instance of AbortSignal',
    `an instance of ${constructorName}`
  );
}

function listenerError(listener: AbortListener): TypeError {
  if (typeof listener === 'string') {
    return invalidArgType('listener', 'of type function', `type string ('${listener}')`);
  }
  if (listener === null) return invalidArgType('listener', 'of type function', 'null');
  if (listener === undefined) {
    return invalidArgType('listener', 'of type function', 'undefined');
  }
  return invalidArgType('listener', 'of type function', `type ${typeof listener}`);
}

export function addAbortListener(signal: AbortSignal, listener: AbortListener): IDisposable {
  if (typeof AbortSignal === 'undefined' || !(signal instanceof AbortSignal)) {
    throw signalError(signal);
  }
  if (typeof listener !== 'function') throw listenerError(listener);

  if (signal.aborted) {
    queueMicrotask(() => Reflect.apply(listener, undefined, []));
    return { [Symbol.dispose]() {} };
  }

  signal.addEventListener('abort', listener, { once: true });
  return {
    [Symbol.dispose]() {
      signal.removeEventListener('abort', listener);
    },
  };
}
