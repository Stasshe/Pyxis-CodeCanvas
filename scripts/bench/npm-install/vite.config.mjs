import { resolve } from 'node:path';
import config from '../../../vite.config.ts';

const cacheDir = process.env.PYXIS_BENCH_VITE_CACHE_DIR;

if (!cacheDir) {
  throw new Error('PYXIS_BENCH_VITE_CACHE_DIR must point to a dedicated npm benchmark cache.');
}

export default {
  ...config,
  cacheDir: resolve(cacheDir),
  server: {
    hmr: false,
    host: 'localhost',
    port: 5174,
    strictPort: true,
  },
};
