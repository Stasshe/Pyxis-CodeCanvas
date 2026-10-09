import NativeEventEmitter from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { createEventsModule } from '@/engine/runtime/nodejs/modules/eventsModule';

function observeEmitter(Emitter: typeof NativeEventEmitter): string[] {
  const emitter = new Emitter();
  const results: string[] = [];
  const handler = function (this: NativeEventEmitter, value: string) {
    results.push(`${this === emitter}:${value}`);
  };

  emitter.on('duplicate', handler);
  emitter.on('duplicate', handler);
  emitter.removeListener('duplicate', handler);
  emitter.emit('duplicate', 'remaining');

  const symbolEvent = Symbol('symbol-event');
  emitter.once(symbolEvent, handler);
  results.push(`once-visible:${emitter.listeners(symbolEvent)[0] === handler}`);
  emitter.removeListener(symbolEvent, handler);
  results.push(`once-removed:${!emitter.emit(symbolEvent, 'removed')}`);

  const failure = new Error('unhandled error');
  try {
    emitter.emit('error', failure);
  } catch (error) {
    results.push(`error-thrown:${error === failure}`);
  }

  return results;
}

function errorCode(action: () => void): string | undefined {
  try {
    action();
  } catch (error) {
    if (error instanceof Error) {
      const code = Reflect.get(error, 'code');
      if (typeof code === 'string') return code;
    }
  }
  return undefined;
}

describe('events builtin', () => {
  it('exports the callable EventEmitter constructor and named alias', () => {
    const events = createEventsModule();
    const emitter = new events();

    expect(events.EventEmitter).toBe(events);
    expect(emitter).toBeInstanceOf(events);
  });

  it('matches Node listener binding, removal, symbols, once, and error behavior', () => {
    const events = createEventsModule();

    expect(observeEmitter(events)).toEqual(observeEmitter(NativeEventEmitter));
  });

  it('sets and gets limits for emitters and EventTargets', () => {
    const events = createEventsModule();
    const emitter = new events();
    const target = new EventTarget();

    events.setMaxListeners(2, emitter, target);

    expect(events.getMaxListeners(emitter)).toBe(2);
    expect(events.getMaxListeners(target)).toBe(2);
    expect(emitter.getMaxListeners()).toBe(2);
    expect(events.defaultMaxListeners).toBe(10);
  });

  it('uses and restores the copied default listener limit', () => {
    const events = createEventsModule();
    const originalDefault = events.defaultMaxListeners;

    try {
      events.setMaxListeners(4);
      const emitter = new events();
      const explicitUndefined = new events();
      Reflect.apply(events.setMaxListeners, events, [undefined, explicitUndefined]);

      expect(events.defaultMaxListeners).toBe(4);
      expect(emitter.getMaxListeners()).toBe(4);
      expect(events.getMaxListeners(explicitUndefined)).toBe(4);
    } finally {
      events.defaultMaxListeners = originalDefault;
    }
  });

  it('validates limits before mutation and applies target changes in order', () => {
    const events = createEventsModule();
    const first = new EventTarget();
    const invalid = {};
    const captureError = (action: () => void): Error => {
      try {
        action();
      } catch (caught) {
        if (caught instanceof Error) return caught;
      }
      throw new Error('Expected action to throw');
    };

    expect(
      Reflect.get(
        captureError(() => Reflect.apply(events.setMaxListeners, events, [-1])),
        'code'
      )
    ).toBe('ERR_OUT_OF_RANGE');
    expect(
      Reflect.get(
        captureError(() => Reflect.apply(events.setMaxListeners, events, ['1'])),
        'code'
      )
    ).toBe('ERR_INVALID_ARG_TYPE');
    const invalidTargets = [null, undefined, 1, invalid];
    for (const target of invalidTargets) {
      expect(() => Reflect.apply(events.setMaxListeners, events, [3, first, target])).toThrow(
        /eventTargets/
      );
      expect(
        Reflect.get(
          captureError(() => Reflect.apply(events.getMaxListeners, events, [target])),
          'code'
        )
      ).toBe('ERR_INVALID_ARG_TYPE');
    }
    expect(events.getMaxListeners(first)).toBe(3);
  });

  it('accepts independent set and get listener target capabilities', () => {
    const events = createEventsModule();
    let configuredCount = 0;
    const setOnly = {
      setMaxListeners(count: number) {
        configuredCount = count;
      },
    };
    const getOnly = {
      getMaxListeners() {
        return 7;
      },
    };

    Reflect.apply(events.setMaxListeners, events, [4, setOnly]);

    expect(configuredCount).toBe(4);
    expect(Reflect.apply(events.getMaxListeners, events, [getOnly])).toBe(7);
  });

  it('preserves EventTarget once and object listener receiver behavior', () => {
    const events = createEventsModule();
    const target = new EventTarget();
    const results: boolean[] = [];
    const listener = {
      handleEvent(this: { handleEvent: EventListener }, event: Event) {
        results.push(this === listener);
        expect(event.type).toBe('change');
      },
    };
    events.setMaxListeners(0, target);
    target.addEventListener('change', listener, { once: true });
    target.dispatchEvent(new Event('change'));
    target.dispatchEvent(new Event('change'));

    expect(results).toEqual([true]);
    expect(events.getMaxListeners(new AbortController().signal)).toBe(0);
  });

  it('leaves EventTarget listener methods and delivery unchanged', () => {
    const events = createEventsModule();
    const target = new EventTarget();
    const callback = vi.fn();
    const addEventListener = target.addEventListener;
    const removeEventListener = target.removeEventListener;
    target.addEventListener('existing', callback);
    events.setMaxListeners(1, target);
    target.addEventListener('existing', callback);
    target.dispatchEvent(new Event('existing'));

    expect(target.addEventListener).toBe(addEventListener);
    expect(target.removeEventListener).toBe(removeEventListener);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('delivers abort events once with native receiver and target', () => {
    const events = createEventsModule();
    const controller = new AbortController();
    const results: boolean[] = [];
    const listener = function (this: AbortSignal, event: Event) {
      results.push(this === controller.signal && event.target === controller.signal);
    };

    events.addAbortListener(controller.signal, listener);
    controller.abort();
    controller.abort();

    expect(results).toEqual([true]);
  });

  it('allows disposal to remove a listener repeatedly', () => {
    const events = createEventsModule();
    const controller = new AbortController();
    const listener = vi.fn();
    const disposable = events.addAbortListener(controller.signal, listener);

    disposable[Symbol.dispose]();
    disposable[Symbol.dispose]();
    controller.abort();

    expect(listener).not.toHaveBeenCalled();
  });

  it('queues a pre-aborted callback even when its disposable is disposed', async () => {
    const events = createEventsModule();
    const signal = AbortSignal.abort();
    const listener = vi.fn();
    const disposable = events.addAbortListener(signal, listener);

    expect(listener).not.toHaveBeenCalled();
    disposable[Symbol.dispose]();
    await new Promise<void>(resolve => queueMicrotask(resolve));

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith();
  });

  it('validates AbortSignal and callback arguments', () => {
    const events = createEventsModule();
    const invalidSignals = [null, 1, Object.create(null)];

    for (const signal of invalidSignals) {
      expect(
        errorCode(() => Reflect.apply(events.addAbortListener, events, [signal, () => {}]))
      ).toBe('ERR_INVALID_ARG_TYPE');
    }
    expect(
      errorCode(() =>
        Reflect.apply(events.addAbortListener, events, [new AbortController().signal, 1])
      )
    ).toBe('ERR_INVALID_ARG_TYPE');
  });

  it('also delivers synthetic abort events with the native target', () => {
    const events = createEventsModule();
    const controller = new AbortController();
    let eventTarget: EventTarget | null = null;
    const listener = function (this: AbortSignal, event: Event) {
      eventTarget = event.target;
      expect(this).toBe(controller.signal);
    };
    events.addAbortListener(controller.signal, listener);

    controller.signal.dispatchEvent(new Event('abort'));

    expect(eventTarget).toBe(controller.signal);
  });
});
