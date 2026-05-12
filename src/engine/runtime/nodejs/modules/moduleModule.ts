/**
 * Module Module
 *
 * Node.js 'module' module implementation
 */

export const builtinModules = [
  'assert',
  'buffer',
  'child_process',
  'cluster',
  'console',
  'constants',
  'crypto',
  'dgram',
  'dns',
  'domain',
  'events',
  'fs',
  'fs/promises',
  'http',
  'https',
  'module',
  'net',
  'os',
  'path',
  'process',
  'punycode',
  'querystring',
  'readline',
  'repl',
  'stream',
  'string_decoder',
  'sys',
  'timers',
  'tls',
  'tty',
  'url',
  'util',
  'v8',
  'vm',
  'zlib',
];

export function createModuleModule(requireFactory?: (filename: string) => (id: string) => unknown) {
  return {
    builtinModules,
    createRequire: (filename: string | URL) => {
      const filenameStr = typeof filename === 'string' ? filename : filename.pathname;
      if (requireFactory) {
        return requireFactory(filenameStr);
      }
      return (_id: string) => {
        throw new Error(
          'require() created via module.createRequire is not fully supported in this environment yet.'
        );
      };
    },
  };
}
