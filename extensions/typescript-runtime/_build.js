const path = require('node:path');
const esbuild = require('esbuild');

async function main() {
  const distDir = process.argv[2];
  if (!distDir) {
    throw new Error('Missing distDir argument');
  }

  await esbuild.build({
    entryPoints: [path.join(__dirname, 'transpile.worker.ts')],
    outfile: path.join(distDir, 'transpile.worker.js'),
    bundle: true,
    platform: 'browser',
    format: 'iife',
    target: 'es2020',
    logLevel: 'warning',
  });

  console.log(`📦 Bundled TypeScript runtime worker to ${distDir}`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
