export const NODE_BUILTIN_MODULES = [
  'assert',
  'assert/strict',
  'buffer',
  'child_process',
  'console',
  'constants',
  'crypto',
  'diagnostics_channel',
  'events',
  'fs',
  'fs/promises',
  'http',
  'https',
  'module',
  'net',
  'os',
  'path',
  'path/posix',
  'path/win32',
  'perf_hooks',
  'process',
  'querystring',
  'readline',
  'readline/promises',
  'stream',
  'stream/consumers',
  'stream/promises',
  'stream/web',
  'string_decoder',
  'timers',
  'timers/promises',
  'tty',
  'url',
  'util',
  'util/types',
  'v8',
  'zlib',
];

const UNSUPPORTED_BUILTIN_MODULES = [
  '_http_agent',
  '_http_client',
  '_http_common',
  '_http_incoming',
  '_http_outgoing',
  '_http_server',
  '_stream_duplex',
  '_stream_passthrough',
  '_stream_readable',
  '_stream_transform',
  '_stream_wrap',
  '_stream_writable',
  '_tls_common',
  '_tls_wrap',
  'async_hooks',
  'cluster',
  'dgram',
  'dns',
  'dns/promises',
  'domain',
  'http2',
  'inspector',
  'inspector/promises',
  'punycode',
  'repl',
  'sys',
  'tls',
  'trace_events',
  'vm',
  'wasi',
  'worker_threads',
];

const PREFIX_ONLY_BUILTIN_MODULES = ['node:sea', 'node:sqlite', 'node:test', 'node:test/reporters'];

export function isBuiltInModule(moduleName: string): boolean {
  if (PREFIX_ONLY_BUILTIN_MODULES.includes(moduleName)) return true;
  let normalized = moduleName;
  if (moduleName.startsWith('node:')) normalized = moduleName.slice(5);
  return (
    NODE_BUILTIN_MODULES.includes(normalized) || UNSUPPORTED_BUILTIN_MODULES.includes(normalized)
  );
}
