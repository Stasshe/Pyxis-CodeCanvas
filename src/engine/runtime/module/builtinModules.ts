export const NODE_BUILTIN_MODULES = [
  'assert',
  'buffer',
  'child_process',
  'console',
  'crypto',
  'events',
  'fs',
  'fs/promises',
  'http',
  'https',
  'module',
  'os',
  'path',
  'perf_hooks',
  'process',
  'readline',
  'stream',
  'stream/consumers',
  'timers',
  'timers/promises',
  'tty',
  'url',
  'util',
  'v8',
];

export function isBuiltInModule(moduleName: string): boolean {
  const normalized = moduleName.startsWith('node:') ? moduleName.slice(5) : moduleName;
  return NODE_BUILTIN_MODULES.includes(normalized);
}
