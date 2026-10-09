import { EventEmitter as NativeEventEmitter, on as nativeOn } from 'node:events';
import { inherits } from 'node:util';
import BrowserifyEventEmitter from 'events';
import { describe, expect, it } from 'vitest';
import { createEventsModule } from '@/engine/system/runtime/nodejs/modules/eventsModule';

function captureError(action: () => void): Error | undefined {
  try {
    action();
  } catch (error) {
    if (error instanceof Error) return error;
  }
  return undefined;
}

async function captureRejection<T>(promise: Promise<T>): Promise<Error | undefined> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof Error) return error;
  }
  return undefined;
}

function errorCode(error: Error | undefined): string | undefined {
  const code = error && Reflect.get(error, 'code');
  if (typeof code === 'string') return code;
  return undefined;
}

describe('events.on async iterator', () => {
  it('keeps module adapters isolated and interoperates with callable inheritance', () => {
    const nativeStaticOn = Reflect.get(NativeEventEmitter, 'on');
    const nativeStaticOnce = NativeEventEmitter.once;
    const browserifyStaticOn = Reflect.get(BrowserifyEventEmitter, 'on');
    const browserifyStaticOnce = BrowserifyEventEmitter.once;
    const browserifyDefaultMaxListeners = Object.getOwnPropertyDescriptor(
      BrowserifyEventEmitter,
      'defaultMaxListeners'
    );
    const nativeDefaultMaxListeners = Object.getOwnPropertyDescriptor(
      NativeEventEmitter,
      'defaultMaxListeners'
    );
    const events = createEventsModule();

    expect(events.EventEmitter).toBe(events);
    expect(events.on).toBeTypeOf('function');
    expect(Object.hasOwn(events, 'once')).toBe(true);
    expect(events.once).toBe(browserifyStaticOnce);
    expect(Object.getOwnPropertyDescriptor(events, 'defaultMaxListeners')).toEqual(
      browserifyDefaultMaxListeners
    );
    expect(Reflect.get(NativeEventEmitter, 'on')).toBe(nativeStaticOn);
    expect(NativeEventEmitter.once).toBe(nativeStaticOnce);
    expect(Object.getOwnPropertyDescriptor(NativeEventEmitter, 'defaultMaxListeners')).toEqual(
      nativeDefaultMaxListeners
    );
    expect(Reflect.get(BrowserifyEventEmitter, 'on')).toBe(browserifyStaticOn);
    expect(BrowserifyEventEmitter.once).toBe(browserifyStaticOnce);
    const nativeCallError = captureError(() => Reflect.apply(NativeEventEmitter, undefined, []));
    const callError = captureError(() => Reflect.apply(events, undefined, []));
    expect(nativeCallError).toBeInstanceOf(TypeError);
    expect(callError).toBeInstanceOf(TypeError);

    function LegacyEmitter(this: NativeEventEmitter) {
      Function.prototype.call.call(events, this);
    }
    inherits(LegacyEmitter, events);
    const emitter = new LegacyEmitter();
    expect(emitter).toBeInstanceOf(events);
    expect(emitter).toBeInstanceOf(BrowserifyEventEmitter);
  });

  it('attaches immediately and preserves queued argument tuples and symbol order', async () => {
    const events = createEventsModule();
    const nativeEmitter = new NativeEventEmitter();
    const emitter = new events();
    const symbol = Symbol('data');
    const nativeData = nativeOn(nativeEmitter, 'data');
    const data = events.on(emitter, 'data');
    const nativeSymbol = nativeOn(nativeEmitter, symbol);
    const symbolIterator = events.on(emitter, symbol);

    expect(nativeEmitter.listenerCount('data')).toBe(1);
    expect(emitter.listenerCount('data')).toBe(1);
    expect(emitter.listenerCount('error')).toBe(nativeEmitter.listenerCount('error'));
    expect(emitter.listenerCount('error')).toBe(2);
    nativeEmitter.emit('data', 'first', 2);
    emitter.emit('data', 'first', 2);
    nativeEmitter.emit(symbol, 'symbol', 3);
    emitter.emit(symbol, 'symbol', 3);
    nativeEmitter.emit('data', 'last', 4);
    emitter.emit('data', 'last', 4);

    expect(await data.next()).toEqual(await nativeData.next());
    expect(await data.next()).toEqual(await nativeData.next());
    expect(await symbolIterator.next()).toEqual(await nativeSymbol.next());
    await data.return();
    await nativeData.return();
    await symbolIterator.return();
    await nativeSymbol.return();
  });

  it('drains queued events before rejecting with the original error', async () => {
    const events = createEventsModule();
    const nativeEmitter = new NativeEventEmitter();
    const emitter = new events();
    const nativeIterator = nativeOn(nativeEmitter, 'data');
    const iterator = events.on(emitter, 'data');
    const failure = new Error('stream failed');
    nativeEmitter.emit('data', 'buffered', 7);
    emitter.emit('data', 'buffered', 7);
    nativeEmitter.emit('error', failure);
    emitter.emit('error', failure);

    expect(await iterator.next()).toEqual(await nativeIterator.next());
    expect(await captureRejection(iterator.next())).toBe(failure);
    expect(await captureRejection(nativeIterator.next())).toBe(failure);
    expect(emitter.listenerCount('data')).toBe(0);
    expect(emitter.listenerCount('error')).toBe(0);
  });

  it('yields the error object when error itself is the observed event', async () => {
    const events = createEventsModule();
    const nativeEmitter = new NativeEventEmitter();
    const emitter = new events();
    const nativeIterator = nativeOn(nativeEmitter, 'error');
    const iterator = events.on(emitter, 'error');
    const failure = new Error('observed error');
    nativeEmitter.emit('error', failure);
    emitter.emit('error', failure);

    expect(await iterator.next()).toEqual(await nativeIterator.next());
    expect(emitter.listenerCount('error')).toBe(1);
    await iterator.return();
    await nativeIterator.return();
    expect(emitter.listenerCount('error')).toBe(0);
  });

  it('resolves pending reads and removes every listener when returned', async () => {
    const events = createEventsModule();
    const nativeEmitter = new NativeEventEmitter();
    const emitter = new events();
    const nativeIterator = nativeOn(nativeEmitter, 'data');
    const iterator = events.on(emitter, 'data');
    const nativePending = nativeIterator.next();
    const pending = iterator.next();

    expect(emitter.listenerCount('data')).toBe(1);
    expect(emitter.listenerCount('error')).toBe(1);
    await iterator.return();
    await nativeIterator.return();
    expect(await pending).toEqual(await nativePending);
    expect(emitter.listenerCount('data')).toBe(0);
    expect(emitter.listenerCount('error')).toBe(0);
  });

  it('matches Node throw(error) return and queued-error behavior', async () => {
    const events = createEventsModule();
    const nativeEmitter = new NativeEventEmitter();
    const emitter = new events();
    const nativeIterator = nativeOn(nativeEmitter, 'data');
    const iterator = events.on(emitter, 'data');
    const failure = new Error('iterator failed');
    nativeEmitter.emit('data', 'queued');
    emitter.emit('data', 'queued');

    expect(iterator.throw(failure)).toBe(nativeIterator.throw(failure));
    expect(await iterator.next()).toEqual(await nativeIterator.next());
    expect(await captureRejection(iterator.next())).toBe(failure);
    expect(await captureRejection(nativeIterator.next())).toBe(failure);
    expect(emitter.listenerCount('data')).toBe(0);
    expect(emitter.listenerCount('error')).toBe(0);
  });

  it('matches already-aborted and late-aborted signal errors and cleanup', async () => {
    const events = createEventsModule();
    const reason = new Error('cancelled by caller');
    const nativeAlready = captureError(() =>
      nativeOn(new NativeEventEmitter(), 'data', { signal: AbortSignal.abort(reason) })
    );
    const already = captureError(() =>
      events.on(new events(), 'data', { signal: AbortSignal.abort(reason) })
    );
    expect(already?.name).toBe(nativeAlready?.name);
    expect(errorCode(already)).toBe(errorCode(nativeAlready));
    expect(Reflect.get(already ?? {}, 'cause')).toBe(Reflect.get(nativeAlready ?? {}, 'cause'));

    const nativeEmitter = new NativeEventEmitter();
    const emitter = new events();
    const nativeController = new AbortController();
    const controller = new AbortController();
    const nativeIterator = nativeOn(nativeEmitter, 'data', { signal: nativeController.signal });
    const iterator = events.on(emitter, 'data', { signal: controller.signal });
    nativeController.abort(reason);
    controller.abort(reason);
    const nativeFailure = await captureRejection(nativeIterator.next());
    const failure = await captureRejection(iterator.next());
    expect(failure?.name).toBe(nativeFailure?.name);
    expect(errorCode(failure)).toBe(errorCode(nativeFailure));
    expect(Reflect.get(failure ?? {}, 'cause')).toBe(reason);
    expect(emitter.listenerCount('data')).toBe(0);
    expect(emitter.listenerCount('error')).toBe(0);
  });

  it('drains buffered events before an explicit close event ends iteration', async () => {
    const events = createEventsModule();
    const nativeEmitter = new NativeEventEmitter();
    const emitter = new events();
    const nativeIterator = nativeOn(nativeEmitter, 'data', { close: ['close'] });
    const iterator = events.on(emitter, 'data', { close: ['close'] });
    nativeEmitter.emit('data', 'buffered');
    emitter.emit('data', 'buffered');
    nativeEmitter.emit('close');
    emitter.emit('close');

    expect(await iterator.next()).toEqual(await nativeIterator.next());
    expect(await iterator.next()).toEqual(await nativeIterator.next());
    expect(emitter.listenerCount('data')).toBe(0);
    expect(emitter.listenerCount('error')).toBe(0);
    expect(emitter.listenerCount('close')).toBe(0);
  });

  it('pauses above highWaterMark and resumes at lowWaterMark', async () => {
    const events = createEventsModule();
    const nativeCalls: string[] = [];
    const calls: string[] = [];
    const nativeEmitter = Object.assign(new NativeEventEmitter(), {
      pause: () => nativeCalls.push('pause'),
      resume: () => nativeCalls.push('resume'),
    });
    const emitter = Object.assign(new events(), {
      pause: () => calls.push('pause'),
      resume: () => calls.push('resume'),
    });
    const nativeIterator = nativeOn(nativeEmitter, 'data', {
      highWaterMark: 2,
      lowWaterMark: 1,
    });
    const iterator = events.on(emitter, 'data', { highWaterMark: 2, lowWaterMark: 1 });

    for (const value of [1, 2, 3]) {
      nativeEmitter.emit('data', value);
      emitter.emit('data', value);
    }
    expect(calls).toEqual(nativeCalls);
    expect(await iterator.next()).toEqual(await nativeIterator.next());
    expect(await iterator.next()).toEqual(await nativeIterator.next());
    expect(await iterator.next()).toEqual(await nativeIterator.next());
    expect(calls).toEqual(['pause', 'resume']);
  });

  it('matches Node error codes for invalid watermarks and abort signals', () => {
    const events = createEventsModule();
    const nativeEmitter = new NativeEventEmitter();
    const emitter = new events();
    const cases = [
      { options: { highWaterMark: -1 }, event: 'highWaterMark' },
      { options: { lowWaterMark: -1 }, event: 'lowWaterMark' },
      { options: { signal: {} }, event: 'signal' },
    ];

    for (const { options, event } of cases) {
      const nativeError = captureError(() =>
        Reflect.apply(nativeOn, undefined, [nativeEmitter, event, options])
      );
      const error = captureError(() =>
        Reflect.apply(events.on, undefined, [emitter, event, options])
      );
      expect(error?.name).toBe(nativeError?.name);
      expect(errorCode(error)).toBe(errorCode(nativeError));
    }
  });

  it('accepts EventTarget sources and yields dispatched events', async () => {
    const events = createEventsModule();
    const nativeTarget = new EventTarget();
    const target = new EventTarget();
    const nativeIterator = nativeOn(nativeTarget, 'message');
    const iterator = events.on(target, 'message');
    nativeTarget.dispatchEvent(new Event('message'));
    target.dispatchEvent(new Event('message'));

    const [actualEvent] = (await iterator.next()).value;
    const [nativeEvent] = (await nativeIterator.next()).value;
    expect(actualEvent.type).toBe(nativeEvent.type);
    await iterator.return();
    await nativeIterator.return();
  });
});
