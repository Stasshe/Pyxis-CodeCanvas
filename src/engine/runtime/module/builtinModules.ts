export const NODE_BUILTIN_MODULES = [
  'assert',
  'buffer',
  'child_process',
  'console',
  'constants',
  'crypto',
  'events',
  'fs',
  'fs/promises',
  'http',
  'https',
  'module',
  'net',
  'os',
  'path',
  'perf_hooks',
  'process',
  'querystring',
  'readline',
  'stream',
  'stream/consumers',
  'string_decoder',
  'timers',
  'timers/promises',
  'tty',
  'url',
  'util',
  'v8',
  'zlib',
];

export function isBuiltInModule(moduleName: string): boolean {
  const normalized = moduleName.startsWith('node:') ? moduleName.slice(5) : moduleName;
  return NODE_BUILTIN_MODULES.includes(normalized);
}
