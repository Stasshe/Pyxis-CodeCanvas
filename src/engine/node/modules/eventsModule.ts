/**
 * Minimal EventEmitter implementation to emulate Node.js `events` module
 * Used by the in-browser Node.js builtins emulation.
 */

type Listener = (...args: any[]) => void

// Internal class implementation (keeps modern class semantics for ESModule consumers)
class InternalEventEmitter {
  private _events: Map<string | symbol, Listener[]> = new Map()
  public defaultMaxListeners = 10

  on(event: string | symbol, listener: Listener): this {
    const list = this._events.get(event) || []
    list.push(listener)
    this._events.set(event, list)
    return this
  }

  addListener(event: string | symbol, listener: Listener): this {
    return this.on(event, listener)
  }

  once(event: string | symbol, listener: Listener): this {
    const wrapped: Listener = (...args: any[]) => {
      ;(this as any).removeListener(event, wrapped)
      listener(...args)
    }
    ;(wrapped as any).__original = listener
    return this.on(event, wrapped)
  }

  removeListener(event: string | symbol, listener: Listener): this {
    const list = this._events.get(event)
    if (!list) return this
    const filtered = list.filter(l => l !== listener && (l as any).__original !== listener)
    if (filtered.length === 0) this._events.delete(event)
    else this._events.set(event, filtered)
    return this
  }

  off(event: string | symbol, listener: Listener): this {
    return this.removeListener(event, listener)
  }

  removeAllListeners(event?: string | symbol): this {
    if (typeof event === 'undefined') {
      this._events.clear()
    } else {
      this._events.delete(event)
    }
    return this
  }

  listeners(event: string | symbol): Listener[] {
    return (this._events.get(event) || []).slice()
  }

  listenerCount(event: string | symbol): number {
    return (this._events.get(event) || []).length
  }

  emit(event: string | symbol, ...args: any[]): boolean {
    const list = this._events.get(event)
    if (!list || list.length === 0) return false
    const copy = list.slice()
    for (const l of copy) {
      try {
        l(...args)
      } catch (err) {
        if (event === 'error') throw err
      }
    }
    return true
  }
}

// Expose a TypeScript interface that matches the instance shape so the
// function-style constructor can be properly typed and consumers won't get
// "property does not exist on type '{}'" errors.
export interface EventEmitter extends InternalEventEmitter {}

// Compatibility: provide a function-style constructor so older CommonJS modules that
// call `EventEmitter.call(this)` or use `util.inherits` continue to work.
function EventEmitter(this: EventEmitter) {
  // Support calling without `new`.
  if (!(this instanceof EventEmitter)) {
    return new (EventEmitter as any)()
  }

  // Initialize the internal fields expected by the prototype methods.
  Object.defineProperty(this, '_events', {
    value: new Map(),
    writable: true,
    configurable: true,
  })
  this.defaultMaxListeners = 10
}

// Delegate prototype methods to InternalEventEmitter's prototype
EventEmitter.prototype = InternalEventEmitter.prototype as any
EventEmitter.prototype.constructor = EventEmitter

export type { EventEmitter }

export function createEventsModule() {
  return {
    EventEmitter,
  }
}

export default createEventsModule
