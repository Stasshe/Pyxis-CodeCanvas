/**
 * [NEW ARCHITECTURE] util モジュールのエミュレーション
 */

export function createUtilModule() {
  return {
    inspect: (obj: any, options?: any): string => {
      try {
        return JSON.stringify(obj, null, 2)
      } catch {
        return String(obj)
      }
    },
    format: (f: string, ...args: any[]): string => {
      let i = 0
      return f.replace(/%[sdj%]/g, x => {
        if (x === '%%') return '%'
        if (i >= args.length) return x
        switch (x) {
          case '%s':
            return String(args[i++])
          case '%d':
            return String(Number(args[i++]))
          case '%j':
            try {
              return JSON.stringify(args[i++])
            } catch {
              return '[Circular]'
            }
          default:
            return x
        }
      })
    },
    promisify: (fn: Function): Function => {
      return (...args: any[]) => {
        return new Promise((resolve, reject) => {
          fn(...args, (err: Error | null, result: any) => {
            if (err) reject(err)
            else resolve(result)
          })
        })
      }
    },
    callbackify: (fn: Function): Function => {
      return (...args: any[]) => {
        const callback = args[args.length - 1]
        fn(...args.slice(0, -1))
          .then((result: any) => callback(null, result))
          .catch(callback)
      }
    },
    inherits: (ctor: Function, superCtor: Function) => {
      ctor.prototype = Object.create(superCtor.prototype)
      ctor.prototype.constructor = ctor
    },
    isDeepStrictEqual: (a: any, b: any): boolean => {
      return JSON.stringify(a) === JSON.stringify(b)
    },
    types: {
      isArray: Array.isArray,
      isObject: (obj: any) => obj !== null && typeof obj === 'object',
      isPromise: (obj: any) => !!obj && typeof obj.then === 'function',
      isRegExp: (obj: any) => Object.prototype.toString.call(obj) === '[object RegExp]',
      isDate: (obj: any) => Object.prototype.toString.call(obj) === '[object Date]',
      isError: (obj: any) => obj instanceof Error,
      isFunction: (obj: any) => typeof obj === 'function',
      isString: (obj: any) => typeof obj === 'string',
      isNumber: (obj: any) => typeof obj === 'number',
      isBoolean: (obj: any) => typeof obj === 'boolean',
      isNull: (obj: any) => obj === null,
      isUndefined: (obj: any) => obj === undefined,
      isSymbol: (obj: any) => typeof obj === 'symbol',
      isBuffer: (obj: any) =>
        obj &&
        obj.constructor &&
        typeof obj.constructor.isBuffer === 'function' &&
        obj.constructor.isBuffer(obj),
    },
    toPromise: (fn: Function, ...args: any[]): Promise<any> => {
      return new Promise((resolve, reject) => {
        fn(...args, (err: Error | null, result: any) => {
          if (err) reject(err)
          else resolve(result)
        })
      })
    },
    deprecate: (fn: Function, msg: string): Function => {
      let warned = false
      return function (this: any, ...args: any[]) {
        if (!warned) {
          console.warn(`DeprecationWarning: ${msg}`)
          warned = true
        }
        return fn.apply(this, args)
      }
    },
  }
}
