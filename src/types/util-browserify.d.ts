declare module 'util/' {
  import nodeUtil = require('node:util');

  type BrowserifyUtilExports = Pick<
    typeof nodeUtil,
    | '_extend'
    | 'callbackify'
    | 'debuglog'
    | 'deprecate'
    | 'format'
    | 'inherits'
    | 'inspect'
    | 'isArray'
    | 'isBoolean'
    | 'isBuffer'
    | 'isDate'
    | 'isError'
    | 'isFunction'
    | 'isNull'
    | 'isNullOrUndefined'
    | 'isNumber'
    | 'isObject'
    | 'isPrimitive'
    | 'isRegExp'
    | 'isString'
    | 'isSymbol'
    | 'isUndefined'
    | 'log'
    | 'promisify'
    | 'types'
  >;

  const util: BrowserifyUtilExports;
  export = util;
}
