import type { AsyncLocalStorage } from 'node:async_hooks';
import type { ChannelListener, Channel as NativeChannel } from 'node:diagnostics_channel';
import { nativeQueueMicrotask } from '../runtimeGlobals';

type ChannelName = string | symbol;
type Message = Parameters<NativeChannel['publish']>[0];
type Store = Pick<AsyncLocalStorage<Message>, 'run'>;
type Transform = (message: Message) => Message;
type TraceContext = object & { result?: Message; error?: Message };
type Callback = (...args: Message[]) => Message;

const NativePromise = Promise;
const promiseThen = NativePromise.prototype.then;
const promiseResolve = NativePromise.resolve.bind(NativePromise) as typeof NativePromise.resolve;
const promiseReject = NativePromise.reject.bind(NativePromise) as typeof NativePromise.reject;

const traceEvents = ['start', 'end', 'asyncStart', 'asyncEnd', 'error'] as const;
type TraceEvent = (typeof traceEvents)[number];

function invalidArgument(name: string, expected: string, value: Message): TypeError {
  return Object.assign(
    new TypeError(
      `The "${name}" argument must be of type ${expected}. Received type ${typeof value}`
    ),
    { code: 'ERR_INVALID_ARG_TYPE' }
  );
}

function validateFunction(value: Message, name: string): asserts value is Callback {
  if (typeof value !== 'function') throw invalidArgument(name, 'function', value);
}

/** Diagnostics channels and their subscriptions belong to one runtime. */
export function createDiagnosticsChannelModule(
  scheduleNextTick: (callback: () => void) => void = nativeQueueMicrotask
) {
  const channels = new Map<ChannelName, Channel>();

  function reportError(error: Message): void {
    scheduleNextTick(() => {
      throw error;
    });
  }

  class Channel {
    private subscribers: ChannelListener[] | undefined;
    private stores: Map<Store, Transform | undefined> | undefined;

    constructor(readonly name: ChannelName) {
      channels.set(name, this);
    }

    static [Symbol.hasInstance](instance: Message): boolean {
      return Object.getPrototypeOf(instance) === Channel.prototype;
    }

    private activate(): void {
      if (this.subscribers !== undefined) return;
      this.subscribers = [];
      this.stores = new Map();
    }

    private deactivateIfEmpty(): void {
      if (this.subscribers?.length || this.stores?.size) return;
      this.subscribers = undefined;
      this.stores = undefined;
    }

    get hasSubscribers(): boolean {
      return this.subscribers !== undefined;
    }

    subscribe(subscription: ChannelListener): void {
      this.activate();
      validateFunction(subscription, 'subscription');
      this.subscribers = [...(this.subscribers ?? []), subscription];
    }

    unsubscribe(subscription: ChannelListener): boolean {
      const index = this.subscribers?.indexOf(subscription) ?? -1;
      if (index === -1 || this.subscribers === undefined) return false;
      this.subscribers = [
        ...this.subscribers.slice(0, index),
        ...this.subscribers.slice(index + 1),
      ];
      this.deactivateIfEmpty();
      return true;
    }

    publish(message: Message): void {
      const subscribers = this.subscribers;
      if (subscribers === undefined) return;
      for (const subscription of subscribers) {
        try {
          subscription(message, this.name);
        } catch (error) {
          reportError(error);
        }
      }
    }

    bindStore(store: Store, transform?: Transform): void {
      this.activate();
      this.stores?.set(store, transform);
    }

    unbindStore(store: Store): boolean {
      if (!this.stores?.delete(store)) return false;
      this.deactivateIfEmpty();
      return true;
    }

    runStores<ThisArg, Args extends Message[], Result>(
      message: Message,
      fn: (this: ThisArg, ...args: Args) => Result,
      thisArg?: ThisArg,
      ...args: Args
    ): Result {
      if (this.stores === undefined) return Reflect.apply(fn, thisArg, args) as Result;

      let run = () => {
        this.publish(message);
        return Reflect.apply(fn, thisArg, args) as Result;
      };
      for (const [store, transform] of this.stores) {
        const next = run;
        run = () => {
          let context: Message;
          try {
            context = message;
            if (transform !== undefined) context = transform(message);
          } catch (error) {
            reportError(error);
            return next();
          }
          return store.run(context, next);
        };
      }
      return run();
    }
  }

  function channel(name: ChannelName): Channel {
    const existing = channels.get(name);
    if (existing) return existing;
    if (typeof name !== 'string' && typeof name !== 'symbol') {
      throw invalidArgument('channel', 'string or symbol', name);
    }
    return new Channel(name);
  }

  type TraceChannels = Record<TraceEvent, Channel>;
  type TraceHandlers = Partial<Record<TraceEvent, ChannelListener>>;

  class TracingChannel {
    declare readonly start: Channel;
    declare readonly end: Channel;
    declare readonly asyncStart: Channel;
    declare readonly asyncEnd: Channel;
    declare readonly error: Channel;

    constructor(nameOrChannels: string | TraceChannels) {
      for (const event of traceEvents) {
        let value: Channel;
        if (typeof nameOrChannels === 'string') {
          value = channel(`tracing:${nameOrChannels}:${event}`);
        } else if (typeof nameOrChannels === 'object' && nameOrChannels !== null) {
          value = nameOrChannels[event];
          if (!(value instanceof Channel)) {
            throw invalidArgument(`nameOrChannels.${event}`, 'Channel', value);
          }
        } else {
          throw invalidArgument(
            'nameOrChannels',
            'string or object or TracingChannel',
            nameOrChannels
          );
        }
        Object.defineProperty(this, event, { value });
      }
    }

    get hasSubscribers(): boolean {
      return traceEvents.some(event => this[event].hasSubscribers);
    }

    subscribe(handlers: TraceHandlers): void {
      for (const event of traceEvents) {
        const handler = handlers[event];
        if (handler) this[event].subscribe(handler);
      }
    }

    unsubscribe(handlers: TraceHandlers): boolean {
      let done = true;
      for (const event of traceEvents) {
        const handler = handlers[event];
        if (handler && !this[event].unsubscribe(handler)) done = false;
      }
      return done;
    }

    traceSync<ThisArg, Args extends Message[], Result>(
      fn: (this: ThisArg, ...args: Args) => Result,
      context: object = {},
      thisArg?: ThisArg,
      ...args: Args
    ): Result {
      if (!this.hasSubscribers) return Reflect.apply(fn, thisArg, args) as Result;
      const traceContext = context as TraceContext;
      return this.start.runStores(context, () => {
        try {
          const result = Reflect.apply(fn, thisArg, args) as Result;
          traceContext.result = result;
          return result;
        } catch (error) {
          traceContext.error = error;
          this.error.publish(context);
          throw error;
        } finally {
          this.end.publish(context);
        }
      });
    }

    tracePromise<ThisArg, Args extends Message[], Result>(
      fn: (this: ThisArg, ...args: Args) => Result,
      context: object = {},
      thisArg?: ThisArg,
      ...args: Args
    ): Result | Promise<Awaited<Result>> {
      if (!this.hasSubscribers) return Reflect.apply(fn, thisArg, args) as Result;
      const traceContext = context as TraceContext;
      return this.start.runStores(context, () => {
        try {
          const result = Reflect.apply(fn, thisArg, args) as Result;
          let promise: Promise<Awaited<Result>>;
          if (result instanceof NativePromise) {
            promise = result as Promise<Awaited<Result>>;
          } else {
            promise = promiseResolve(result);
          }
          return Reflect.apply(promiseThen, promise, [
            (value: Awaited<Result>) => {
              traceContext.result = value;
              this.asyncStart.publish(context);
              this.asyncEnd.publish(context);
              return value;
            },
            (error: Message) => {
              traceContext.error = error;
              this.error.publish(context);
              this.asyncStart.publish(context);
              this.asyncEnd.publish(context);
              return promiseReject(error);
            },
          ]) as Promise<Awaited<Result>>;
        } catch (error) {
          traceContext.error = error;
          this.error.publish(context);
          throw error;
        } finally {
          this.end.publish(context);
        }
      });
    }

    traceCallback<ThisArg, Args extends Message[], Result>(
      fn: (this: ThisArg, ...args: Args) => Result,
      position = -1,
      context: object = {},
      thisArg?: ThisArg,
      ...args: Args
    ): Result {
      if (!this.hasSubscribers) return Reflect.apply(fn, thisArg, args) as Result;
      const callback = args.at(position);
      validateFunction(callback, 'callback');
      const callable: Callback = callback;
      const traceContext = context as TraceContext;
      const { asyncStart, asyncEnd, error } = this;
      function wrappedCallback(this: Message, ...callbackArgs: Message[]): void {
        const [failure, result] = callbackArgs;
        if (failure) {
          traceContext.error = failure;
          error.publish(context);
        } else {
          traceContext.result = result;
        }
        asyncStart.runStores(context, () => {
          try {
            return Reflect.apply(callable, this, callbackArgs);
          } finally {
            asyncEnd.publish(context);
          }
        });
      }
      args.splice(position, 1, wrappedCallback);
      return this.start.runStores(context, () => {
        try {
          return Reflect.apply(fn, thisArg, args) as Result;
        } catch (failure) {
          traceContext.error = failure;
          error.publish(context);
          throw failure;
        } finally {
          this.end.publish(context);
        }
      });
    }
  }

  return {
    channel,
    hasSubscribers: (name: ChannelName): boolean => channels.get(name)?.hasSubscribers ?? false,
    subscribe: (name: ChannelName, subscription: ChannelListener): void =>
      channel(name).subscribe(subscription),
    tracingChannel: (nameOrChannels: string | TraceChannels) => new TracingChannel(nameOrChannels),
    unsubscribe: (name: ChannelName, subscription: ChannelListener): boolean =>
      channel(name).unsubscribe(subscription),
    Channel,
  };
}
