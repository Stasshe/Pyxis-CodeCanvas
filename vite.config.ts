import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';

const packageJson = JSON.parse(readFileSync('./package.json', 'utf8')) as { version: string };

function normalizeBase(value: string | undefined): string {
  if (!value || value === '/') return '/';
  const withLeadingSlash = value.startsWith('/') ? value : `/${value}`;
  return withLeadingSlash.endsWith('/') ? withLeadingSlash : `${withLeadingSlash}/`;
}

const basePath = process.env.VITE_BASE_PATH;
const ignoredBuildLogCodes = new Set(['INEFFECTIVE_DYNAMIC_IMPORT']);
const browserNodeInjection: Record<string, string | [string, string]> = {
  process: 'process/browser',
  Buffer: ['buffer', 'Buffer'],
};

function serveBuiltExtensions(): Plugin {
  const extensionsDir = path.resolve(__dirname, 'public/extensions');
  const extensionsPrefix = `${extensionsDir}${path.sep}`;

  return {
    name: 'serve-built-extensions',
    configureServer(server) {
      const routePrefix = `${server.config.base.replace(/\/$/, '')}/extensions/`;
      server.middlewares.use((req, res, next) => {
        if (!req.url || (req.method !== 'GET' && req.method !== 'HEAD')) {
          return next();
        }

        let pathname: string;
        try {
          pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
        } catch {
          res.statusCode = 400;
          return res.end();
        }

        if (!pathname.startsWith(routePrefix)) {
          return next();
        }

        const filePath = path.resolve(extensionsDir, pathname.slice(routePrefix.length));
        if (!filePath.startsWith(extensionsPrefix) || !existsSync(filePath)) {
          res.statusCode = 404;
          return res.end();
        }

        const stat = statSync(filePath);
        if (!stat.isFile()) {
          res.statusCode = 404;
          return res.end();
        }

        let contentType = 'application/octet-stream';
        if (filePath.endsWith('.js')) {
          contentType = 'application/javascript';
        } else if (filePath.endsWith('.json')) {
          contentType = 'application/json';
        }

        res.statusCode = 200;
        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Length', stat.size);
        res.setHeader('Cache-Control', 'no-cache');
        if (req.method === 'HEAD') return res.end();
        return res.end(readFileSync(filePath));
      });
    },
  };
}

export default defineConfig({
  plugins: [serveBuiltExtensions()],
  base: normalizeBase(basePath),
  optimizeDeps: {
    rolldownOptions: {
      transform: {
        define: {
          define: 'undefined',
        },
        inject: browserNodeInjection,
      },
    },
  },
  worker: {
    rolldownOptions: {
      transform: {
        inject: browserNodeInjection,
      },
    },
  },
  assetsInclude: ['**/*.wasm'],
  resolve: {
    alias: [
      { find: /^util$/, replacement: 'util/' },
      { find: /^node:util$/, replacement: 'util/' },
      { find: /^assert$/, replacement: 'assert/' },
      { find: /^node:assert$/, replacement: 'assert/' },
      { find: /^url$/, replacement: 'url/' },
      { find: /^node:url$/, replacement: 'url/' },
      { find: /^node:string_decoder$/, replacement: 'string_decoder' },
      { find: /^node:buffer$/, replacement: 'buffer' },
      { find: '@', replacement: path.resolve(__dirname, 'src') },
      { find: 'events', replacement: 'events' },
      { find: 'node:events', replacement: 'events' },
      { find: /^node:stream$/, replacement: 'readable-stream/lib/stream.js' },
      { find: /^stream$/, replacement: 'readable-stream/lib/stream.js' },
      { find: 'path', replacement: 'path-browserify' },
      { find: 'crypto', replacement: 'crypto-browserify' },
      { find: 'vm', replacement: 'vm-browserify' },
      { find: 'os', replacement: 'os-browserify/browser' },
      { find: /^process$/, replacement: 'process/browser' },
    ],
  },
  define: {
    __PYXIS_VERSION__: JSON.stringify(packageJson.version),
    define: 'undefined',
    global: 'globalThis',
  },
  build: {
    outDir: 'dist',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 3500,
    rolldownOptions: {
      output: {
        codeSplitting: true,
      },
      transform: {
        inject: browserNodeInjection,
      },
      onLog(level, log, defaultHandler) {
        if (log.code && ignoredBuildLogCodes.has(log.code)) return;
        defaultHandler(level, log);
      },
    },
  },
});
