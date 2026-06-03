import { readFileSync } from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vite';

const packageJson = JSON.parse(readFileSync('./package.json', 'utf8')) as { version: string };

function normalizeBase(value: string | undefined): string {
  if (!value || value === '/') return '/';
  const withLeadingSlash = value.startsWith('/') ? value : `/${value}`;
  return withLeadingSlash.endsWith('/') ? withLeadingSlash : `${withLeadingSlash}/`;
}

const basePath = process.env.VITE_BASE_PATH;
const isProductionBuild = process.env.BUILD_MODE === 'production';

export default defineConfig({
  base: normalizeBase(basePath),
  assetsInclude: ['**/*.wasm'],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      events: 'events',
      'node:events': 'events',
      'node:stream': 'stream-browserify',
      stream: 'stream-browserify',
      path: 'path-browserify',
      crypto: 'crypto-browserify',
      vm: 'vm-browserify',
      os: 'os-browserify/browser',
      process: 'process/browser',
    },
  },
  define: {
    __PYXIS_VERSION__: JSON.stringify(packageJson.version),
    global: 'globalThis',
  },
  build: {
    outDir: 'dist',
    assetsInlineLimit: 0,
  },
});
