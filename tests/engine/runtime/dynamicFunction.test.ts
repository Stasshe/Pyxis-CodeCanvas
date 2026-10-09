import { describe, expect, it, vi } from 'vitest';
import { createRuntimeFunction } from '@/engine/runtime/module/dynamicFunction';

describe('Runtime Function constructor', () => {
  it('routes imports in dynamically supplied bodies and aliases through the module loader', async () => {
    const importer = vi.fn(async (specifier: string) => ({ specifier }));
    const Constructor = createRuntimeFunction(importer);
    const body = ['return ', 'import(name);'].join('');
    const load = new Constructor('name', body);
    await expect(load('package')).resolves.toEqual({ specifier: 'package' });
    expect(importer).toHaveBeenCalledExactlyOnceWith('package');
  });

  it('preserves native global scope and does not capture the source lexical scope', async () => {
    const importer = async () => true;
    const Constructor = createRuntimeFunction(importer);
    const callerLocal = 'private';
    const load = Constructor('return import("pkg").then(() => typeof callerLocal);');
    await expect(load()).resolves.toBe('undefined');
    expect(callerLocal).toBe('private');
  });

  it('preserves this, arguments, name and declared parameter length', async () => {
    const Constructor = createRuntimeFunction(async () => true);
    const load = new Constructor(
      'first',
      'second',
      'return import(first).then(() => [this.value, arguments.length, second]);'
    );
    await expect(load.call({ value: 3 }, 'pkg', 4)).resolves.toEqual([3, 2, 4]);
    expect(load.name).toBe('anonymous');
    expect(load.length).toBe(2);
    expect(load).toBeInstanceOf(Function);
    expect(load).toBeInstanceOf(Constructor);
    expect(Constructor.prototype).toBe(Function.prototype);
  });

  it('preserves strict body this and native constructor instances', () => {
    const Constructor = createRuntimeFunction(async () => true);
    const strict = Constructor('"use strict"; void import("pkg"); return this;');
    expect(strict()).toBeUndefined();
    const construct = Constructor('name', 'this.name = name; void import("pkg");');
    const instance = Reflect.construct(construct, ['created']);
    expect(instance.name).toBe('created');
    expect(instance).toBeInstanceOf(construct);
  });

  it('preserves subclass constructor prototypes', () => {
    class CustomFunction extends Function {}
    const Constructor = createRuntimeFunction(async () => true);
    const load = Reflect.construct(Constructor, ['return import("pkg");'], CustomFunction);
    expect(load).toBeInstanceOf(CustomFunction);
  });

  it('keeps strings and regexes that mention import unchanged', () => {
    const importer = vi.fn(async () => true);
    const Constructor = createRuntimeFunction(importer);
    const text = Constructor('return \'import("fake")\';');
    expect(text()).toBe('import("fake")');
    expect(importer).not.toHaveBeenCalled();
  });

  it('rejects invalid function syntax through the native constructor', () => {
    const Constructor = createRuntimeFunction(async () => true);
    expect(() => Constructor('return import(')).toThrow(SyntaxError);
  });
});
