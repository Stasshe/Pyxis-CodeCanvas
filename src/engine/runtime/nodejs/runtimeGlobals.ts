import type { RuntimeGlobal } from './runtimeTypes';

const hostGlobal = globalThis;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const getOwnPropertyDescriptors = Object.getOwnPropertyDescriptors;
const entries = Object.entries;
const defineProperty = Object.defineProperty;
const deleteProperty = Reflect.deleteProperty;

export const nativeSetTimeout = hostGlobal.setTimeout.bind(hostGlobal);
export const nativeClearTimeout = hostGlobal.clearTimeout.bind(hostGlobal);
export const nativeSetInterval = hostGlobal.setInterval.bind(hostGlobal);
export const nativeClearInterval = hostGlobal.clearInterval.bind(hostGlobal);
export const nativeQueueMicrotask = hostGlobal.queueMicrotask.bind(hostGlobal);

/** Only runtime-owned descriptors are temporary; program globals belong to the Worker. */
export class RuntimeGlobals {
  readonly global = hostGlobal as RuntimeGlobal;
  private readonly originals = new Map<string, PropertyDescriptor | undefined>();

  install(values: object): void {
    for (const [name, descriptor] of entries(getOwnPropertyDescriptors(values))) {
      if (!this.originals.has(name)) {
        this.originals.set(name, getOwnPropertyDescriptor(hostGlobal, name));
      }
      const original = this.originals.get(name);
      if (original) descriptor.enumerable = original.enumerable;
      defineProperty(hostGlobal, name, descriptor);
    }
  }

  restore(): void {
    for (const [name, descriptor] of this.originals) {
      if (descriptor) defineProperty(hostGlobal, name, descriptor);
      else if (!deleteProperty(hostGlobal, name)) {
        throw new TypeError(`Cannot restore runtime global ${name}.`);
      }
    }
    this.originals.clear();
  }
}
