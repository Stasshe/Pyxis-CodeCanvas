import * as nativeUtil from 'node:util';
import { describe, expect, it } from 'vitest';
import { isBuiltInModule } from '@/engine/system/runtime/module/builtinModules';
import { createAssertModule } from '@/engine/system/runtime/nodejs/modules/assertModule';
import { createRuntimeStreamModule } from '@/engine/system/runtime/nodejs/modules/readableWebAdapters';
import { createUtilModule } from '@/engine/system/runtime/nodejs/modules/utilModule';

describe('Node assert and util modules', () => {
  it('matches callable assert behavior and exposes its strict alias', () => {
    const assert = createAssertModule();

    expect(() => assert('ready')).not.toThrow();
    expect(() => assert.equal('1', 1)).not.toThrow();
    expect(() => assert.strictEqual('1', 1)).toThrow();
    expect(() => assert.throws(() => undefined)).toThrow();
    expect(assert.strict.strictEqual).toBe(assert.strictEqual);
    expect(isBuiltInModule('node:assert/strict')).toBe(true);
  });

  it('uses Node inspection and deep strict equality semantics', () => {
    const util = createUtilModule();
    interface Cycle {
      self?: Cycle;
    }
    const cycle: Cycle = {};
    cycle.self = cycle;

    expect(util.inspect({ value: 'text' })).toBe("{ value: 'text' }");
    expect(util.inspect({ inner: { value: { deep: true } } }, false, 1, false)).toBe(
      '{ inner: { value: [Object] } }'
    );
    const legacy = {
      inner: {
        inspect() {
          throw new Error('Legacy inspect methods must not be invoked');
        },
      },
    };
    expect(util.inspect(legacy, { depth: 3 })).toBe(nativeUtil.inspect(legacy, { depth: 3 }));
    expect(
      util.inspect({
        [util.inspect.custom]: function (
          this: { value: string },
          _depth: number | undefined,
          _options: Parameters<typeof util.inspect>[1],
          inspectValue: typeof util.inspect
        ) {
          return `custom:${inspectValue(this.value)}`;
        },
        value: 'text',
      })
    ).toBe("custom:'text'");
    expect(util.inspect.custom).toBe(Symbol.for('nodejs.util.inspect.custom'));
    let customInspectorCalled = false;
    const custom = {
      [util.inspect.custom]() {
        customInspectorCalled = true;
        return 'custom';
      },
    };
    expect(util.inspect(custom, { customInspect: false })).toBe(
      nativeUtil.inspect(custom, { customInspect: false })
    );
    expect(customInspectorCalled).toBe(false);
    expect(util.isDeepStrictEqual({ left: 1, right: 2 }, { right: 2, left: 1 })).toBe(true);
    expect(util.isDeepStrictEqual(new Date(0), new Date(1))).toBe(false);
    expect(util.isDeepStrictEqual(1, '1')).toBe(false);
    expect(util.isDeepStrictEqual(cycle, cycle)).toBe(true);
    expect(
      util.isDeepStrictEqual(new Map([[1, new Set([2, 3])]]), new Map([[1, new Set([3, 2])]]))
    ).toBe(true);
    expect(util.isDeepStrictEqual(new Uint8Array([1, 2]), new Uint8Array([1, 3]))).toBe(false);
    expect(util.isDeepStrictEqual({ [Symbol.for('key')]: 1 }, { [Symbol.for('key')]: 2 })).toBe(
      false
    );
  });

  it('matches recursive custom inspection depth, options, and returned objects', () => {
    const util = createUtilModule();
    const calls: Array<[number, number | null | undefined, string]> = [];
    const custom = {
      [util.inspect.custom](
        depth: number,
        options: nativeUtil.InspectOptions,
        inspectValue: typeof util.inspect
      ) {
        calls.push([depth, options.depth, typeof inspectValue]);
        return { text: inspectValue('value'), nested: new Map([[1, 2]]) };
      },
    };
    const value = { items: [custom] };
    for (const options of [{}, { depth: 4 }, { depth: null }, { customInspect: false }]) {
      calls.length = 0;
      const expected = nativeUtil.inspect(value, options);
      const expectedCalls = [...calls];
      calls.length = 0;
      expect(util.inspect(value, options)).toBe(expected);
      expect(calls).toEqual(expectedCalls);
    }
    const self = {
      [util.inspect.custom]() {
        return this;
      },
    };
    expect(util.inspect(self)).toBe(nativeUtil.inspect(self));
    const cycle: { self?: object; custom: typeof custom } = { custom };
    cycle.self = cycle;
    expect(util.inspect(cycle)).toBe(nativeUtil.inspect(cycle));
    expect(util.inspect.defaultOptions).toEqual(nativeUtil.inspect.defaultOptions);
  });

  it('formats collections, BigInts, and object placeholders using Node inspection', () => {
    const util = createUtilModule();
    const value = { map: new Map([[1, new Set([2, 3])]]), number: 12n };
    expect(util.inspect(value)).toBe(nativeUtil.inspect(value));
    expect(util.format('%o %O %d', value, value, 12n)).toBe(
      nativeUtil.format('%o %O %d', value, value, 12n)
    );
    expect(util.formatWithOptions({ depth: 0 }, '%O', value)).toBe(
      nativeUtil.formatWithOptions({ depth: 0 }, '%O', value)
    );
  });

  it('strips VT control sequences like Node util', () => {
    const util = createUtilModule();
    const samples = [
      '\u001B[31mred\u001B[0m',
      '\u009B1;32mgreen\u009B0m',
      '\u001B]0;terminal title\u0007text',
      '\u001B]8;;https://example.com/path\u0007linked\u001B]8;;\u0007',
      '日本語😀',
      'plain text',
    ];

    for (const sample of samples) {
      expect(util.stripVTControlCharacters(sample)).toBe(
        nativeUtil.stripVTControlCharacters(sample)
      );
    }
    expect(() =>
      Reflect.apply(nativeUtil.stripVTControlCharacters, undefined, [null])
    ).toThrowError(expect.objectContaining({ code: 'ERR_INVALID_ARG_TYPE' }));
    expect(() => Reflect.apply(util.stripVTControlCharacters, undefined, [null])).toThrowError(
      expect.objectContaining({ code: 'ERR_INVALID_ARG_TYPE' })
    );
  });

  it('styles text with Node ANSI formats and color policy', () => {
    const util = createUtilModule({ stdoutIsTTY: true });
    const formats = ['red', 'bold'];
    expect(util.styleText(formats, 'error', { validateStream: false })).toBe(
      nativeUtil.styleText(formats, 'error', { validateStream: false })
    );
    const nestedText = 'error\u001b[22mbold\u001b[39mplain';
    expect(util.styleText(formats, nestedText, { validateStream: false })).toBe(
      nativeUtil.styleText(formats, nestedText, { validateStream: false })
    );
    const colorReset = 'error\u001b[39mplain';
    expect(util.styleText('red', colorReset, { validateStream: false })).toBe(
      nativeUtil.styleText('red', colorReset, { validateStream: false })
    );
    expect(util.styleText('#abc', 'color', { validateStream: false })).toBe(
      nativeUtil.styleText('#abc', 'color', { validateStream: false })
    );
    expect(util.styleText('none', 'plain', { validateStream: false })).toBe('plain');

    const noColor = createUtilModule({
      stdoutIsTTY: true,
      getEnv: () => ({ NO_COLOR: '1' }),
    });
    expect(noColor.styleText('red', 'plain')).toBe('plain');
    expect(noColor.styleText('red', 'colored', { validateStream: false })).toBe(
      '\u001b[31mcolored\u001b[39m'
    );

    const forcedColor = createUtilModule({
      stdoutIsTTY: false,
      getEnv: () => ({ NO_COLOR: '1', FORCE_COLOR: '3' }),
    });
    expect(forcedColor.styleText('red', 'forced')).toBe('\u001b[31mforced\u001b[39m');

    const forceColorCases: Array<[string, boolean]> = [
      ['', true],
      ['true', true],
      ['1', true],
      ['2', true],
      ['3', true],
      ['0', false],
      ['false', false],
      ['garbage', false],
      ['-1', false],
      ['4', false],
    ];
    for (const [value, enabled] of forceColorCases) {
      const runtimeUtil = createUtilModule({
        stdoutIsTTY: false,
        getEnv: () => ({ FORCE_COLOR: value }),
      });
      let expected = 'text';
      if (enabled) expected = '\u001b[31mtext\u001b[39m';
      expect(runtimeUtil.styleText('red', 'text')).toBe(expected);
    }
  });

  it('validates styleText arguments with Node error codes', () => {
    const util = createUtilModule();
    expect(() => util.styleText('unknown', 'text')).toThrowError(
      expect.objectContaining({ code: 'ERR_INVALID_ARG_VALUE' })
    );
    expect(() =>
      Reflect.apply(util.styleText, undefined, ['red', 'text', { validateStream: 1 }])
    ).toThrowError(expect.objectContaining({ code: 'ERR_INVALID_ARG_TYPE' }));
    expect(() => Reflect.apply(util.styleText, undefined, ['red', null])).toThrowError(
      expect.objectContaining({ code: 'ERR_INVALID_ARG_TYPE' })
    );
  });

  it('uses Node stream identity for styleText validation and color selection', () => {
    const stream = createRuntimeStreamModule();
    const output = Object.assign(
      new stream.Writable({
        write(_chunk, _encoding, callback) {
          callback();
        },
      }),
      { isTTY: true }
    );
    const util = createUtilModule({
      stdoutIsTTY: false,
      isStream: value => value instanceof stream.Stream,
    });
    expect(util.styleText('red', 'stream', { stream: output })).toBe('\u001b[31mstream\u001b[39m');
    expect(() =>
      Reflect.apply(util.styleText, undefined, ['red', 'stream', { stream: { isTTY: true } }])
    ).toThrowError(expect.objectContaining({ code: 'ERR_INVALID_ARG_TYPE' }));
    const unvalidated = { stream: { isTTY: true }, validateStream: false };
    expect(Reflect.apply(util.styleText, undefined, ['red', 'stream', unvalidated])).toBe(
      Reflect.apply(nativeUtil.styleText, undefined, ['red', 'stream', unvalidated])
    );
  });

  it('honors promisify.custom and callbackify receiver and argument order', async () => {
    const util = createUtilModule();
    expect(util.promisify.custom).toBe(Symbol.for('nodejs.util.promisify.custom'));
    const original = Object.assign(
      function (
        this: { prefix: string },
        value: string,
        callback: (error: Error | null, result: string) => void
      ) {
        callback(null, `${this.prefix}${value}`);
      },
      {
        [util.promisify.custom]: function (this: { prefix: string }, value: string) {
          return Promise.resolve(`${this.prefix}custom:${value}`);
        },
      }
    );

    await expect(util.promisify(original).call({ prefix: 'result:' }, 'value')).resolves.toBe(
      'result:custom:value'
    );
    const customPromisified = util.promisify(original);
    expect(util.promisify(customPromisified)).toBe(customPromisified);
    const callbackFunction = (callback: (error: Error | null, value: string) => void) => {
      callback(null, 'value');
    };
    const promisified = util.promisify(callbackFunction);
    expect(util.promisify(promisified)).toBe(promisified);
    const nativePromisified = nativeUtil.promisify(callbackFunction);
    expect(Object.getOwnPropertyDescriptor(promisified, util.promisify.custom)).toEqual({
      ...Object.getOwnPropertyDescriptor(nativePromisified, nativeUtil.promisify.custom),
      value: promisified,
    });
    expect(Object.getOwnPropertyDescriptor(customPromisified, util.promisify.custom)).toEqual({
      ...Object.getOwnPropertyDescriptor(
        nativeUtil.promisify(original),
        nativeUtil.promisify.custom
      ),
      value: customPromisified,
    });
    const invalidCustom = Object.assign(() => {}, {
      [util.promisify.custom]: 1,
    });
    expect(() => util.promisify(invalidCustom)).toThrow(TypeError);

    const callbackified = util.callbackify(function (
      this: { prefix: string },
      first: string,
      second: string
    ) {
      return Promise.resolve(`${this.prefix}${first}:${second}`);
    });
    const result = await new Promise<string>((resolve, reject) => {
      callbackified.call(
        { prefix: 'callback:' },
        'first',
        'second',
        (error: Error | null, value: string) => {
          if (error) {
            reject(error);
            return;
          }
          resolve(value);
        }
      );
    });

    expect(result).toBe('callback:first:second');
  });
});
