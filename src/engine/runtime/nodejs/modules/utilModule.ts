import assertPort from 'assert/';
import {
  format,
  formatWithOptions,
  inspect,
  stripVTControlCharacters,
} from 'node-inspect-extracted';
import utilPort from 'util/';

const promisifyCustomSymbol = Symbol.for('nodejs.util.promisify.custom');

type StyleTextOptions = { validateStream?: boolean; stream?: object | null };
type ANSIStyle = { open: string; close: string };

export interface UtilModuleOptions {
  getEnv?: () => Record<string, string>;
  isStream?: (value: object) => boolean;
  stdoutIsTTY?: boolean;
}

function argumentError(message: string, code: string): TypeError {
  return Object.assign(new TypeError(message), { code });
}

function getStyle(format: string): ANSIStyle | null | undefined {
  if (format === 'none') return null;
  if (/^#[\da-f]{3}(?:[\da-f]{3})?$/i.test(format)) {
    let digits = format.slice(1);
    if (digits.length === 3) digits = [...digits].map(digit => `${digit}${digit}`).join('');
    const red = Number.parseInt(digits.slice(0, 2), 16);
    const green = Number.parseInt(digits.slice(2, 4), 16);
    const blue = Number.parseInt(digits.slice(4, 6), 16);
    return { open: `38;2;${red};${green};${blue}`, close: '39' };
  }

  const aliases: Record<string, string> = {
    blackBright: 'gray',
    bgBlackBright: 'bgGray',
    bgGrey: 'bgGray',
    crossedOut: 'strikethrough',
    crossedout: 'strikethrough',
    doubleUnderline: 'doubleunderline',
    faint: 'dim',
    grey: 'gray',
    strikeThrough: 'strikethrough',
    swapColors: 'inverse',
    swapcolors: 'inverse',
    conceal: 'hidden',
  };
  const name = aliases[format] ?? format;
  const value = Reflect.get(inspect.colors, name);
  if (!Array.isArray(value) || typeof value[0] !== 'number' || typeof value[1] !== 'number') {
    return undefined;
  }
  return { open: String(value[0]), close: String(value[1]) };
}

function styleTextColorEnabled(
  validateStream: boolean,
  stdoutIsTTY: boolean,
  environment: Record<string, string>
): boolean {
  if (!validateStream) return true;

  const forceColor = environment.FORCE_COLOR;
  if (forceColor !== undefined) {
    if (forceColor === '' || forceColor === 'true') return true;
    return forceColor === '1' || forceColor === '2' || forceColor === '3';
  }
  if (environment.NO_COLOR || environment.NODE_DISABLE_COLORS !== undefined) return false;
  return stdoutIsTTY;
}

function createStyleText(options: UtilModuleOptions) {
  return function styleText(
    format: string | string[],
    text: string,
    styleOptions?: StyleTextOptions
  ): string {
    if (
      typeof styleOptions !== 'undefined' &&
      (typeof styleOptions !== 'object' || styleOptions === null)
    ) {
      throw argumentError('The "options" argument must be of type object.', 'ERR_INVALID_ARG_TYPE');
    }
    if (
      typeof styleOptions?.validateStream !== 'undefined' &&
      typeof styleOptions.validateStream !== 'boolean'
    ) {
      throw argumentError(
        'The "options.validateStream" property must be of type boolean.',
        'ERR_INVALID_ARG_TYPE'
      );
    }
    const validateStream = styleOptions?.validateStream ?? true;
    const selectedStream = styleOptions?.stream;
    if (
      validateStream &&
      selectedStream !== undefined &&
      selectedStream !== null &&
      !options.isStream?.(selectedStream)
    ) {
      throw argumentError(
        'The "stream" argument must be an instance of ReadableStream, WritableStream, or Stream.',
        'ERR_INVALID_ARG_TYPE'
      );
    }
    if (typeof text !== 'string') {
      throw argumentError('The "text" argument must be of type string.', 'ERR_INVALID_ARG_TYPE');
    }

    let formats: string[];
    if (typeof format === 'string') formats = [format];
    else if (Array.isArray(format)) formats = format;
    else {
      throw argumentError(
        "The argument 'format' must be a string or an array of strings.",
        'ERR_INVALID_ARG_VALUE'
      );
    }
    const styles: ANSIStyle[] = [];
    for (const item of formats) {
      if (typeof item !== 'string') {
        throw argumentError(
          "The argument 'format' must be an array of strings.",
          'ERR_INVALID_ARG_VALUE'
        );
      }
      const style = getStyle(item);
      if (style === undefined) {
        throw argumentError(
          `The argument 'format' is invalid. Received '${item}'`,
          'ERR_INVALID_ARG_VALUE'
        );
      }
      if (style) styles.push(style);
    }

    let stdoutIsTTY = options.stdoutIsTTY ?? false;
    if (
      selectedStream !== undefined &&
      selectedStream !== null &&
      options.isStream?.(selectedStream)
    ) {
      stdoutIsTTY = Reflect.get(selectedStream, 'isTTY') === true;
    }
    const colorEnabled = styleTextColorEnabled(
      validateStream,
      stdoutIsTTY,
      options.getEnv?.() ?? {}
    );
    if (!colorEnabled || styles.length === 0 || text.length === 0) return text;

    let styledText = text;
    for (const style of styles) {
      const close = `\u001b[${style.close}m`;
      const open = `\u001b[${style.open}m`;
      let replacement = `${close}${open}`;
      if (style.close === '39' || style.close === '49') replacement = open;
      styledText = styledText.split(close).join(replacement);
    }

    const opening = styles.map(style => `\u001b[${style.open}m`).join('');
    const closing = styles
      .slice()
      .reverse()
      .map(style => `\u001b[${style.close}m`)
      .join('');
    return `${opening}${styledText}${closing}`;
  };
}

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

export function createUtilModule(options: UtilModuleOptions = {}) {
  return Object.assign({}, utilPort, {
    inspect,
    format,
    formatWithOptions,
    isDeepStrictEqual,
    promisify,
    stripVTControlCharacters,
    styleText: createStyleText(options),
  });
}
