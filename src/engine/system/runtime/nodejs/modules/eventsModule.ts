import BrowserifyEventEmitter from 'events';
import { addAbortListener } from './eventAbortListener';
import { on } from './eventIterator';
import { createMaxListenersApi } from './eventMaxListeners';

export type EventEmitterConstructor = typeof BrowserifyEventEmitter &
  ((...args: ConstructorParameters<typeof BrowserifyEventEmitter>) => void);

export function createEventsModule(): EventEmitterConstructor {
  const EventEmitter = function (
    this: BrowserifyEventEmitter,
    ...args: ConstructorParameters<EventEmitterConstructor>
  ) {
    if (new.target) return Reflect.construct(BrowserifyEventEmitter, args, new.target);
    return Reflect.apply(BrowserifyEventEmitter, this, args);
  };
  const maxListenersApi = createMaxListenersApi(BrowserifyEventEmitter);
  const descriptors = Object.getOwnPropertyDescriptors(BrowserifyEventEmitter);
  Object.defineProperties(EventEmitter, {
    ...descriptors,
    setMaxListeners: {
      value: maxListenersApi.setMaxListeners,
      enumerable: true,
      writable: true,
      configurable: true,
    },
    getMaxListeners: {
      value: maxListenersApi.getMaxListeners,
      enumerable: true,
      writable: true,
      configurable: true,
    },
    addAbortListener: {
      value: addAbortListener,
      enumerable: true,
      writable: true,
      configurable: true,
    },
    EventEmitter: { value: EventEmitter, enumerable: true, writable: true, configurable: true },
    on: { value: on, enumerable: true, writable: true, configurable: true },
  });
  // The facade keeps its callable signature and the constructor's own static descriptors.
  return EventEmitter as typeof EventEmitter & EventEmitterConstructor;
}

export default createEventsModule;
