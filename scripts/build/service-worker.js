const { build } = require('esbuild');

build({
  entryPoints: ['src/engine/system/runtime/bridge/serviceWorker.js'],
  outfile: 'public/sw.js',
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: 'es2020',
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
