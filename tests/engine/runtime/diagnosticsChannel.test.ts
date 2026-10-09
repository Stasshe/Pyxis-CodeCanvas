import { AsyncLocalStorage } from 'node:async_hooks';
import * as nativeDiagnosticsChannel from 'node:diagnostics_channel';
import { describe, expect, it } from 'vitest';
import { createDiagnosticsChannelModule } from '@/engine/runtime/nodejs/modules/diagnosticsChannel';

type SnapshotChannel = {
  subscribe(subscription: (message: unknown) => void): void;
  unsubscribe(subscription: (message: unknown) => void): boolean;
  publish(message: unknown): void;
};

describe('Node diagnostics_channel builtin', () => {
  it('shares named channels within one module and isolates separate runtimes', () => {
    const firstRuntime = createDiagnosticsChannelModule();
    const secondRuntime = createDiagnosticsChannelModule();
    const first = firstRuntime.channel('service:request');

    expect(firstRuntime.channel('service:request')).toBe(first);
    expect(first.name).toBe('service:request');
    expect(first.hasSubscribers).toBe(false);
    expect(firstRuntime.hasSubscribers('service:request')).toBe(false);
    expect(secondRuntime.channel('service:request')).not.toBe(first);
  });

  it('preserves string and symbol channel identities', () => {
    const diagnostics = createDiagnosticsChannelModule();
    const symbolName = Symbol('request');
    const byString = diagnostics.channel('request');
    const bySymbol = diagnostics.channel(symbolName);

    expect(diagnostics.channel('request')).toBe(byString);
    expect(diagnostics.channel(symbolName)).toBe(bySymbol);
    expect(byString.name).toBe('request');
    expect(bySymbol.name).toBe(symbolName);
    expect(bySymbol).not.toBe(byString);
  });

  it('matches native validation errors for invalid channel names', () => {
    const diagnostics = createDiagnosticsChannelModule();
    const readErrorCode = (operation: () => unknown): string | undefined => {
      try {
        operation();
      } catch (error) {
        if (error instanceof TypeError && 'code' in error && typeof error.code === 'string') {
          return `${error.name}:${error.code}`;
        }
      }
      return undefined;
    };
    const localErrorCode = readErrorCode(() =>
      Reflect.apply(diagnostics.channel, diagnostics, [42])
    );
    const nativeErrorCode = readErrorCode(() =>
      Reflect.apply(nativeDiagnosticsChannel.channel, nativeDiagnosticsChannel, [42])
    );
    const localListenerChannel = diagnostics.channel('service:invalid-listener');
    const localListenerErrorCode = readErrorCode(() =>
      Reflect.apply(localListenerChannel.subscribe, localListenerChannel, [42])
    );
    const nativeListenerChannel = nativeDiagnosticsChannel.channel('test:invalid-listener');
    const nativeListenerErrorCode = readErrorCode(() =>
      Reflect.apply(nativeListenerChannel.subscribe, nativeListenerChannel, [42])
    );

    expect(localErrorCode).toBe(nativeErrorCode);
    expect(localErrorCode).toBe('TypeError:ERR_INVALID_ARG_TYPE');
    expect(localListenerErrorCode).toBe(nativeListenerErrorCode);
    expect(localListenerErrorCode).toBe('TypeError:ERR_INVALID_ARG_TYPE');
  });

  it('accepts a complete channel map like the native tracing factory', () => {
    const diagnostics = createDiagnosticsChannelModule();
    const localChannels = {
      start: diagnostics.channel('service:map:start'),
      end: diagnostics.channel('service:map:end'),
      asyncStart: diagnostics.channel('service:map:async-start'),
      asyncEnd: diagnostics.channel('service:map:async-end'),
      error: diagnostics.channel('service:map:error'),
    };
    const nativeChannels = {
      start: nativeDiagnosticsChannel.channel('test:map:start'),
      end: nativeDiagnosticsChannel.channel('test:map:end'),
      asyncStart: nativeDiagnosticsChannel.channel('test:map:async-start'),
      asyncEnd: nativeDiagnosticsChannel.channel('test:map:async-end'),
      error: nativeDiagnosticsChannel.channel('test:map:error'),
    };
    const localTracing = diagnostics.tracingChannel(localChannels);
    const nativeTracing = nativeDiagnosticsChannel.tracingChannel(nativeChannels);

    expect(localTracing.start).toBe(localChannels.start);
    expect(nativeTracing.start).toBe(nativeChannels.start);
    expect(Object.keys(localTracing)).toEqual(Object.keys(nativeTracing));
  });

  it('matches native listener snapshot behavior when a pending listener is removed', () => {
    const diagnostics = createDiagnosticsChannelModule();
    const localCalls: string[] = [];
    const nativeCalls: string[] = [];
    const localChannel = diagnostics.channel('service:snapshot');
    const nativeChannel = nativeDiagnosticsChannel.channel('test:service:snapshot');

    function runSnapshot(channel: SnapshotChannel, calls: string[]): void {
      let changed = false;
      const added = (message: unknown) => {
        calls.push(`added:${message === payload}`);
      };
      const removed = (message: unknown) => {
        calls.push(`removed:${message === payload}`);
      };
      const first = (message: unknown) => {
        calls.push(`first:${message === payload}`);
        if (changed) return;
        changed = true;
        channel.unsubscribe(removed);
        channel.subscribe(added);
      };

      channel.subscribe(first);
      channel.subscribe(removed);
      channel.publish(payload);
      channel.publish(payload);
    }

    const payload = { requestId: 12 };
    runSnapshot(localChannel, localCalls);
    runSnapshot(nativeChannel, nativeCalls);

    expect(localCalls).toEqual(nativeCalls);
    expect(localCalls).toEqual(['first:true', 'removed:true', 'first:true', 'added:true']);
    expect(localChannel.hasSubscribers).toBe(true);
  });

  it('reports subscriber errors through the injected next-tick scheduler', () => {
    const scheduled: Array<() => void> = [];
    const diagnostics = createDiagnosticsChannelModule(callback => scheduled.push(callback));
    const channel = diagnostics.channel('service:failure');
    const calls: string[] = [];
    const failure = new Error('subscriber failed');

    channel.subscribe(() => {
      calls.push('first');
      throw failure;
    });
    channel.subscribe(() => calls.push('second'));

    expect(() => channel.publish({})).not.toThrow();
    expect(calls).toEqual(['first', 'second']);
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0]).toThrow(failure);
  });

  it('supports unsubscribe and module-level subscribe helpers', () => {
    const diagnostics = createDiagnosticsChannelModule();
    const seen: unknown[] = [];
    const subscriber = (message: unknown) => seen.push(message);

    expect(diagnostics.subscribe('service:helper', subscriber)).toBeUndefined();
    expect(diagnostics.hasSubscribers('service:helper')).toBe(true);
    diagnostics.channel('service:helper').publish(5);
    expect(diagnostics.unsubscribe('service:helper', subscriber)).toBe(true);
    expect(diagnostics.unsubscribe('service:helper', subscriber)).toBe(false);
    expect(diagnostics.hasSubscribers('service:helper')).toBe(false);
    diagnostics.channel('service:helper').publish(6);
    expect(seen).toEqual([5]);
  });
});

describe('Node diagnostics tracing channels', () => {
  it('emits sync start and end with the same context object and records the result', () => {
    const diagnostics = createDiagnosticsChannelModule();
    const tracing = diagnostics.tracingChannel('service:trace-sync');
    const context: { requestId: number; result?: number } = { requestId: 12 };
    const phases: Array<[string, unknown]> = [];

    tracing.start.subscribe(message => phases.push(['start', message]));
    tracing.end.subscribe(message => phases.push(['end', message]));

    const result = tracing.traceSync(() => 42, context);

    expect(result).toBe(42);
    expect(phases).toEqual([
      ['start', context],
      ['end', context],
    ]);
    expect(context).toEqual({ requestId: 12, result: 42 });
  });

  it('emits error and end, preserves the thrown error, and records it on context', () => {
    const diagnostics = createDiagnosticsChannelModule();
    const tracing = diagnostics.tracingChannel('service:trace-error');
    const nativeTracing = nativeDiagnosticsChannel.tracingChannel('test:trace-error');
    const context: { operation: string; error?: Error } = { operation: 'read' };
    const nativeContext: { operation: string; error?: Error } = { operation: 'read' };
    const phases: string[] = [];
    const nativePhases: string[] = [];
    const failure = new Error('read failed');
    const nativeFailure = new Error('read failed');

    tracing.start.subscribe(() => phases.push('start'));
    tracing.error.subscribe(() => phases.push('error'));
    tracing.end.subscribe(() => phases.push('end'));
    nativeTracing.start.subscribe(() => nativePhases.push('start'));
    nativeTracing.error.subscribe(() => nativePhases.push('error'));
    nativeTracing.end.subscribe(() => nativePhases.push('end'));

    expect(() =>
      tracing.traceSync(() => {
        throw failure;
      }, context)
    ).toThrow(failure);
    expect(() =>
      nativeTracing.traceSync(() => {
        throw nativeFailure;
      }, nativeContext)
    ).toThrow(nativeFailure);
    expect(phases).toEqual(nativePhases);
    expect(phases).toEqual(['start', 'error', 'end']);
    expect(context.error).toBe(failure);
    expect(nativeContext.error).toBe(nativeFailure);
  });

  it('runs a sync trace without subscribers and preserves this and arguments', () => {
    const diagnostics = createDiagnosticsChannelModule();
    const tracing = diagnostics.tracingChannel('service:trace-unobserved');
    const receiver = { value: 5 };
    const result = tracing.traceSync(
      function (this: typeof receiver, increment: number) {
        return this.value + increment;
      },
      {},
      receiver,
      7
    );

    expect(tracing.hasSubscribers).toBe(false);
    expect(result).toBe(12);
  });
});

describe('Node diagnostics tracing helpers', () => {
  it('matches native promise identity and tracing phases when subscribers are present', async () => {
    const diagnostics = createDiagnosticsChannelModule();
    const tracing = diagnostics.tracingChannel('service:trace-promise');
    const context: { requestId: number; result?: string } = { requestId: 3 };
    const phases: string[] = [];

    tracing.start.subscribe(() => phases.push('start'));
    tracing.end.subscribe(() => phases.push('end'));
    tracing.asyncStart.subscribe(() => phases.push('asyncStart'));
    tracing.asyncEnd.subscribe(message => {
      phases.push('asyncEnd');
      expect(message).toBe(context);
    });

    const sourcePromise = Promise.resolve('ok');
    const nativeTracing = nativeDiagnosticsChannel.tracingChannel('test:trace-promise');
    nativeTracing.start.subscribe(() => {});
    const nativeSourcePromise = Promise.resolve('ok');
    const nativeReturnedPromise = nativeTracing.tracePromise(() => nativeSourcePromise, {});
    const promise = tracing.tracePromise(() => sourcePromise, context);

    expect(promise).toBeInstanceOf(Promise);
    expect(promise).not.toBe(sourcePromise);
    expect(promise === sourcePromise).toBe(nativeReturnedPromise === nativeSourcePromise);
    expect(phases).toEqual(['start', 'end']);
    await expect(promise).resolves.toBe('ok');
    expect(phases).toEqual(['start', 'end', 'asyncStart', 'asyncEnd']);
    expect(context).toEqual({ requestId: 3, result: 'ok' });
  });

  it('matches native phases and context mutation when a traced promise rejects', async () => {
    const diagnostics = createDiagnosticsChannelModule();
    const tracing = diagnostics.tracingChannel('service:trace-promise-reject');
    const nativeTracing = nativeDiagnosticsChannel.tracingChannel('test:trace-promise-reject');
    const context: { operation: string; error?: Error } = { operation: 'load' };
    const nativeContext: { operation: string; error?: Error } = { operation: 'load' };
    const phases: string[] = [];
    const nativePhases: string[] = [];
    const failure = new Error('load failed');
    const nativeFailure = new Error('load failed');
    const events = ['start', 'end', 'error', 'asyncStart', 'asyncEnd'] as const;

    for (const phase of events) {
      tracing[phase].subscribe(() => phases.push(phase));
      nativeTracing[phase].subscribe(() => nativePhases.push(phase));
    }

    const promise = tracing.tracePromise(() => Promise.reject(failure), context);
    const nativePromise = nativeTracing.tracePromise(
      () => Promise.reject(nativeFailure),
      nativeContext
    );

    await expect(promise).rejects.toBe(failure);
    await expect(nativePromise).rejects.toBe(nativeFailure);
    expect(phases).toEqual(nativePhases);
    expect(phases).toEqual(['start', 'end', 'error', 'asyncStart', 'asyncEnd']);
    expect(context.error).toBe(failure);
    expect(nativeContext.error).toBe(nativeFailure);
  });

  it('wraps a callback at its requested argument position and preserves its call', () => {
    const diagnostics = createDiagnosticsChannelModule();
    const tracing = diagnostics.tracingChannel('service:trace-callback');
    const nativeTracing = nativeDiagnosticsChannel.tracingChannel('test:trace-callback-sync');
    const context: { operation: string; result?: string } = { operation: 'read' };
    const phases: string[] = [];
    const nativePhases: string[] = [];
    const receiver = { label: 'receiver' };
    let callbackThis: unknown;
    let callbackArgs: unknown[] = [];

    tracing.start.subscribe(() => phases.push('start'));
    tracing.end.subscribe(() => phases.push('end'));
    tracing.asyncStart.subscribe(() => phases.push('asyncStart'));
    tracing.asyncEnd.subscribe(() => phases.push('asyncEnd'));
    nativeTracing.start.subscribe(() => nativePhases.push('start'));
    nativeTracing.end.subscribe(() => nativePhases.push('end'));
    nativeTracing.asyncStart.subscribe(() => nativePhases.push('asyncStart'));
    nativeTracing.asyncEnd.subscribe(() => nativePhases.push('asyncEnd'));

    const result = tracing.traceCallback(
      function (this: typeof receiver, callback: (error: Error | null, value?: string) => void) {
        expect(this).toBe(receiver);
        callback.call(receiver, null, 'done');
        return 'function result';
      },
      0,
      context,
      receiver,
      function (this: typeof receiver, ...args: unknown[]) {
        callbackThis = this;
        callbackArgs = args;
      }
    );

    expect(result).toBe('function result');
    expect(callbackThis).toBe(receiver);
    expect(callbackArgs).toEqual([null, 'done']);
    expect(context.result).toBe('done');
    nativeTracing.traceCallback(
      function (this: typeof receiver, callback: (error: Error | null, value?: string) => void) {
        callback.call(receiver, null, 'done');
        return 'function result';
      },
      0,
      {},
      receiver,
      () => {}
    );
    expect(phases).toEqual(nativePhases);
    expect(phases).toEqual(['start', 'asyncStart', 'asyncEnd', 'end']);
  });

  it('keeps a bound synchronous store active for phase publication and the traced function', () => {
    const diagnostics = createDiagnosticsChannelModule();
    const tracing = diagnostics.tracingChannel('service:trace-store');
    let activeStore: unknown;
    const store = {
      getStore: () => activeStore,
      run<T>(value: unknown, callback: () => T): T {
        const previous = activeStore;
        activeStore = value;
        try {
          return callback();
        } finally {
          activeStore = previous;
        }
      },
    };
    const observed: Array<{ phase: string; store: unknown }> = [];

    tracing.start.bindStore(store, (message: unknown) => {
      if (typeof message !== 'object' || message === null) {
        throw new TypeError('Expected a trace context object.');
      }
      const requestId = Reflect.get(message, 'requestId');
      if (typeof requestId !== 'number') {
        throw new TypeError('Expected a numeric requestId.');
      }
      return { requestId };
    });
    tracing.start.subscribe(() => {
      observed.push({ phase: 'start', store: store.getStore() });
    });
    tracing.end.subscribe(() => {
      observed.push({ phase: 'end', store: store.getStore() });
    });

    const result = tracing.traceSync(
      () => {
        expect(store.getStore()).toEqual({ requestId: 8 });
        return 'done';
      },
      { requestId: 8 }
    );

    expect(result).toBe('done');
    expect(observed).toEqual([
      { phase: 'start', store: { requestId: 8 } },
      { phase: 'end', store: { requestId: 8 } },
    ]);
    expect(store.getStore()).toBeUndefined();
  });

  it('emits async trace phases when the wrapped callback runs after return', () => {
    const diagnostics = createDiagnosticsChannelModule();
    const tracing = diagnostics.tracingChannel('service:trace-callback-delayed');
    const nativeTracing = nativeDiagnosticsChannel.tracingChannel('test:trace-callback-delayed');
    const phases: string[] = [];
    const nativePhases: string[] = [];
    let savedCallback: ((error: Error | null, value?: string) => void) | undefined;
    let savedNativeCallback: ((error: Error | null, value?: string) => void) | undefined;
    const callbackArguments: unknown[][] = [];
    const nativeCallbackArguments: unknown[][] = [];

    tracing.start.subscribe(() => phases.push('start'));
    tracing.end.subscribe(() => phases.push('end'));
    tracing.asyncStart.subscribe(() => phases.push('asyncStart'));
    tracing.asyncEnd.subscribe(() => phases.push('asyncEnd'));
    nativeTracing.start.subscribe(() => nativePhases.push('start'));
    nativeTracing.end.subscribe(() => nativePhases.push('end'));
    nativeTracing.asyncStart.subscribe(() => nativePhases.push('asyncStart'));
    nativeTracing.asyncEnd.subscribe(() => nativePhases.push('asyncEnd'));

    const operation = (callback: (error: Error | null, value?: string) => void) => {
      savedCallback = callback;
      return 'scheduled';
    };
    const nativeOperation = (callback: (error: Error | null, value?: string) => void) => {
      savedNativeCallback = callback;
      return 'scheduled';
    };

    expect(
      tracing.traceCallback(operation, 0, {}, undefined, (...args: unknown[]) => {
        callbackArguments.push(args);
      })
    ).toBe('scheduled');
    expect(phases).toEqual(['start', 'end']);
    expect(
      nativeTracing.traceCallback(nativeOperation, 0, {}, undefined, (...args: unknown[]) => {
        nativeCallbackArguments.push(args);
      })
    ).toBe('scheduled');
    expect(nativePhases).toEqual(['start', 'end']);
    if (!savedCallback || !savedNativeCallback) {
      throw new Error('The traced operations did not capture their callbacks.');
    }
    savedCallback(null, 'complete');
    savedNativeCallback(null, 'complete');

    expect(phases).toEqual(nativePhases);
    expect(phases).toEqual(['start', 'end', 'asyncStart', 'asyncEnd']);
    expect(callbackArguments).toEqual([[null, 'complete']]);
    expect(nativeCallbackArguments).toEqual(callbackArguments);
  });

  it('matches native error phase and context when a delayed callback fails', () => {
    const diagnostics = createDiagnosticsChannelModule();
    const tracing = diagnostics.tracingChannel('service:trace-callback-error');
    const nativeTracing = nativeDiagnosticsChannel.tracingChannel('test:trace-callback-error');
    const context: { operation: string; error?: Error } = { operation: 'read' };
    const nativeContext: { operation: string; error?: Error } = { operation: 'read' };
    const phases: string[] = [];
    const nativePhases: string[] = [];
    const failure = new Error('callback failed');
    const nativeFailure = new Error('callback failed');
    let savedCallback: ((error: Error | null) => void) | undefined;
    let savedNativeCallback: ((error: Error | null) => void) | undefined;
    let callbackError: Error | null | undefined;
    let nativeCallbackError: Error | null | undefined;

    for (const phase of ['start', 'end', 'error', 'asyncStart', 'asyncEnd'] as const) {
      tracing[phase].subscribe(() => phases.push(phase));
      nativeTracing[phase].subscribe(() => nativePhases.push(phase));
    }

    const operation = (callback: (error: Error | null) => void) => {
      savedCallback = callback;
      return 'scheduled';
    };
    const nativeOperation = (callback: (error: Error | null) => void) => {
      savedNativeCallback = callback;
      return 'scheduled';
    };

    expect(
      tracing.traceCallback(operation, 0, context, undefined, error => {
        callbackError = error;
      })
    ).toBe('scheduled');
    expect(
      nativeTracing.traceCallback(nativeOperation, 0, nativeContext, undefined, error => {
        nativeCallbackError = error;
      })
    ).toBe('scheduled');
    if (!savedCallback || !savedNativeCallback) {
      throw new Error('The traced operations did not capture their callbacks.');
    }

    savedCallback(failure);
    savedNativeCallback(nativeFailure);

    expect(phases).toEqual(nativePhases);
    expect(phases).toEqual(['start', 'end', 'error', 'asyncStart', 'asyncEnd']);
    expect(callbackError).toBe(failure);
    expect(nativeCallbackError).toBe(nativeFailure);
    expect(context.error).toBe(failure);
    expect(nativeContext.error).toBe(nativeFailure);
  });

  it('matches native multiple-store values and unbind results synchronously', () => {
    type StoreValue = { label: string; requestId: number };
    const diagnostics = createDiagnosticsChannelModule();
    const tracing = diagnostics.tracingChannel('service:trace-multiple-stores');
    const nativeTracing = nativeDiagnosticsChannel.tracingChannel('test:trace-multiple-stores');
    const localFirst: { value: unknown } = { value: undefined };
    const localSecond: { value: unknown } = { value: undefined };
    const firstStore = {
      getStore: () => localFirst.value,
      run<T>(value: unknown, callback: () => T): T {
        const previous = localFirst.value;
        localFirst.value = value;
        try {
          return callback();
        } finally {
          localFirst.value = previous;
        }
      },
    };
    const secondStore = {
      getStore: () => localSecond.value,
      run<T>(value: unknown, callback: () => T): T {
        const previous = localSecond.value;
        localSecond.value = value;
        try {
          return callback();
        } finally {
          localSecond.value = previous;
        }
      },
    };
    const nativeFirst = new AsyncLocalStorage<StoreValue>();
    const nativeSecond = new AsyncLocalStorage<StoreValue>();
    const localObserved: unknown[][] = [];
    const nativeObserved: unknown[][] = [];
    const firstTransform = (message: unknown): StoreValue => ({
      label: 'first',
      requestId: readRequestId(message),
    });
    const secondTransform = (message: unknown): StoreValue => ({
      label: 'second',
      requestId: readRequestId(message),
    });

    function readRequestId(message: unknown): number {
      if (typeof message !== 'object' || message === null) {
        throw new TypeError('Expected a trace context object.');
      }
      const requestId = Reflect.get(message, 'requestId');
      if (typeof requestId !== 'number') {
        throw new TypeError('Expected a numeric requestId.');
      }
      return requestId;
    }

    tracing.start.bindStore(firstStore, firstTransform);
    tracing.start.bindStore(secondStore, secondTransform);
    nativeTracing.start.bindStore(nativeFirst, firstTransform);
    nativeTracing.start.bindStore(nativeSecond, secondTransform);
    tracing.start.subscribe(() => localObserved.push([localFirst.value, localSecond.value]));
    nativeTracing.start.subscribe(() =>
      nativeObserved.push([nativeFirst.getStore(), nativeSecond.getStore()])
    );

    tracing.traceSync(() => localObserved.push([localFirst.value, localSecond.value]), {
      requestId: 1,
    });
    nativeTracing.traceSync(
      () => nativeObserved.push([nativeFirst.getStore(), nativeSecond.getStore()]),
      { requestId: 1 }
    );
    expect(tracing.start.unbindStore(firstStore)).toBe(true);
    expect(nativeTracing.start.unbindStore(nativeFirst)).toBe(true);
    tracing.traceSync(() => localObserved.push([localFirst.value, localSecond.value]), {
      requestId: 2,
    });
    nativeTracing.traceSync(
      () => nativeObserved.push([nativeFirst.getStore(), nativeSecond.getStore()]),
      { requestId: 2 }
    );

    expect(tracing.start.unbindStore(firstStore)).toBe(false);
    expect(nativeTracing.start.unbindStore(nativeFirst)).toBe(false);
    expect(tracing.start.unbindStore(secondStore)).toBe(true);
    expect(nativeTracing.start.unbindStore(nativeSecond)).toBe(true);
    expect(localObserved).toEqual(nativeObserved);
    expect(localObserved).toEqual([
      [
        { label: 'first', requestId: 1 },
        { label: 'second', requestId: 1 },
      ],
      [
        { label: 'first', requestId: 1 },
        { label: 'second', requestId: 1 },
      ],
      [undefined, { label: 'second', requestId: 2 }],
      [undefined, { label: 'second', requestId: 2 }],
    ]);
  });
});
