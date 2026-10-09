import assertPort from 'assert/';
import {
  format,
  formatWithOptions,
  inspect,
  stripVTControlCharacters,
} from 'node-inspect-extracted';
import utilPort from 'util/';

const promisifyCustomSymbol = Symbol.for('nodejs.util.promisify.custom');

function isDeepStrictEqual(actual: unknown, expected: unknown): boolean {
  try {
    assertPort.deepStrictEqual(actual, expected);
    return true;
  } catch (error) {
    if (error instanceof assertPort.AssertionError) return false;
    throw error;
  }
}

const promisify = Object.assign(
  (original: Parameters<typeof utilPort.promisify>[0]): ReturnType<typeof utilPort.promisify> => {
    if (typeof original !== 'function') {
      throw new TypeError('The "original" argument must be of type function.');
    }
    const customValue: unknown = Reflect.get(original, promisifyCustomSymbol);
    if (customValue) {
      if (typeof customValue !== 'function') {
        throw new TypeError(
          `The "util.promisify.custom" property must be of type function. Received type ${typeof customValue}.`
        );
      }
      Object.defineProperty(customValue, promisifyCustomSymbol, {
        value: customValue,
        enumerable: false,
        writable: false,
        configurable: true,
      });
      return customValue;
    }
    const promisified = utilPort.promisify(original);
    Object.defineProperty(promisified, promisifyCustomSymbol, {
      value: promisified,
      enumerable: false,
      writable: false,
      configurable: true,
    });
    return promisified;
  },
  { custom: promisifyCustomSymbol }
);

export function createUtilModule() {
  return Object.assign({}, utilPort, {
    inspect,
    format,
    formatWithOptions,
    isDeepStrictEqual,
    promisify,
    stripVTControlCharacters,
  });
}
