/**
 * os モジュールのエミュレーション
 */

export function createOSModule() {
  return {
    platform: () => 'browser',
    type: () => 'Browser',
    arch: () => 'x64',
    hostname: () => 'localhost',
    tmpdir: () => '/tmp',
    homedir: () => '/home/user',
    EOL: '\n',
    cpus: () => [],
    networkInterfaces: () => ({}),
    totalmem: () => 0,
    freemem: () => 0,
    uptime: () => 0,
    release: () => '0.0.0',
    version: () => '0.0.0',
  };
}
