import type BrowserifyEventEmitter from 'events';

type SettableEmitter = { setMaxListeners: (count: number) => void };
type GettableEmitter = { getMaxListeners: () => number };
type SetMaxListenerTarget = SettableEmitter | EventTarget;
type GetMaxListenerTarget = GettableEmitter | EventTarget;

function codedError(message: string, code: string, isRange: boolean): TypeError | RangeError {
  let error: TypeError | RangeError;
  if (isRange) error = new RangeError(message);
  else error = new TypeError(message);
  Object.assign(error, { code });
  return error;
}

function validateCount(count: number): void {
  if (typeof count !== 'number') {
    let received = `type ${typeof count}`;
    if (typeof count === 'string') received = `type string ('${count}')`;
    throw codedError(
      `The "setMaxListeners" argument must be of type number. Received ${received}`,
      'ERR_INVALID_ARG_TYPE',
      false
    );
  }
  if (count < 0 || Number.isNaN(count)) {
    throw codedError(
      `The value of "setMaxListeners" is out of range. It must be >= 0. Received ${String(count)}`,
      'ERR_OUT_OF_RANGE',
      true
    );
  }
}

function isSettableEmitter(target: SetMaxListenerTarget): target is SettableEmitter {
  if (target === null || (typeof target !== 'object' && typeof target !== 'function')) {
    return false;
  }
  if (!('setMaxListeners' in target)) return false;
  return typeof Reflect.get(target, 'setMaxListeners') === 'function';
}

function isGettableEmitter(target: GetMaxListenerTarget): target is GettableEmitter {
  if (target === null || (typeof target !== 'object' && typeof target !== 'function')) {
    return false;
  }
  if (!('getMaxListeners' in target)) return false;
  return typeof Reflect.get(target, 'getMaxListeners') === 'function';
}

function isEventTarget(target: SetMaxListenerTarget | GetMaxListenerTarget): target is EventTarget {
  return typeof EventTarget !== 'undefined' && target instanceof EventTarget;
}

export function createMaxListenersApi(base: typeof BrowserifyEventEmitter): {
  setMaxListeners: (count?: number, ...targets: SetMaxListenerTarget[]) => void;
  getMaxListeners: (target: GetMaxListenerTarget) => number;
} {
  const eventTargetLimits = new WeakMap<EventTarget, number>();

  const setMaxListeners = (
    count = base.defaultMaxListeners,
    ...targets: SetMaxListenerTarget[]
  ): void => {
    validateCount(count);
    if (targets.length === 0) {
      base.defaultMaxListeners = count;
      return;
    }
    for (const target of targets) {
      if (isEventTarget(target)) {
        eventTargetLimits.set(target, count);
        continue;
      }
      if (isSettableEmitter(target)) {
        target.setMaxListeners(count);
        continue;
      }
      throw codedError(
        'The "eventTargets" argument must be an instance of EventEmitter or EventTarget. Received an instance of Object',
        'ERR_INVALID_ARG_TYPE',
        false
      );
    }
  };

  const getMaxListeners = (target: GetMaxListenerTarget): number => {
    if (isEventTarget(target)) {
      const configuredLimit = eventTargetLimits.get(target);
      if (configuredLimit !== undefined) return configuredLimit;
      if (typeof AbortSignal !== 'undefined' && target instanceof AbortSignal) return 0;
      return base.defaultMaxListeners;
    }
    if (isGettableEmitter(target)) return target.getMaxListeners();
    throw codedError(
      'The "emitter" argument must be an instance of EventEmitter or EventTarget. Received an instance of Object',
      'ERR_INVALID_ARG_TYPE',
      false
    );
  };

  return { setMaxListeners, getMaxListeners };
}
