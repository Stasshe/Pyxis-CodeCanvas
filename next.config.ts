/** @type {import('next').NextConfig} */


// 環境変数から本番ビルドモードかどうかを判断
const isProductionBuild = process.env.BUILD_MODE === 'production';
console.log(`isProductionBuild: ${isProductionBuild}`);

// GH Pages 等でリポジトリ名が basePath になるケースがあるため、
// 環境変数 NEXT_PUBLIC_BASE_PATH を参照して basePath/assetPrefix を設定できるようにする。
let basePathEnv = process.env.NEXT_PUBLIC_BASE_PATH || '';
if (basePathEnv && !basePathEnv.startsWith('/')) {
  basePathEnv = '/' + basePathEnv;
}
// 空文字の場合は undefined にして Next のデフォルト挙動に委ねる
const configuredBasePath = basePathEnv || undefined;
console.log(`Configured basePath: ${configuredBasePath}`);
// package.jsonからバージョン取得
const pkg = require('./package.json');

// 共通設定
const commonConfig = {
  reactStrictMode: false,
  staticPageGenerationTimeout: 300,
  images: {
    unoptimized: true, // 静的エクスポートでは必須
  },
  // Disable SWC minification optimizations that break isomorphic-git
  swcMinify: true,
  compiler: {
    removeConsole: false,
  },
  // Expose build-time values to client code and Turbopack via NEXT_PUBLIC_*
  env: {
    NEXT_PUBLIC_PYXIS_VERSION: pkg.version,
    NEXT_PUBLIC_IS_PRODUCTION_BUILD: String(isProductionBuild),
    NEXT_PUBLIC_BASE_PATH: basePathEnv || '',
  },
  webpack: (config: any, { isServer }: { isServer: boolean }) => {
  if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: require.resolve('path-browserify'),
        vm: require.resolve('vm-browserify'),
        buffer: require.resolve('buffer'),
        util: require.resolve('util'),
        stream: require.resolve('readable-stream'),
        crypto: require.resolve('crypto-browserify'),
        os: require.resolve('os-browserify'),
      };
      config.plugins = [
        ...config.plugins,
        new (require('webpack')).ProvidePlugin({
          Buffer: ['buffer', 'Buffer'],
          process: 'process/browser',
        }),
        // バージョンをDefinePluginで注入（webpack 用フォールバック）
        new (require('webpack')).DefinePlugin({
          'process.env.PYXIS_VERSION': JSON.stringify(pkg.version),
          // 保守的に string 化して注入（webpack のみ）
          'process.env.NEXT_PUBLIC_IS_PRODUCTION_BUILD': JSON.stringify(isProductionBuild),
        }),
        // base path を webpack 側でも定義しておく
        new (require('webpack')).DefinePlugin({
          'process.env.NEXT_PUBLIC_BASE_PATH': JSON.stringify(basePathEnv || ''),
        }),
      ];
      config.output.globalObject = 'globalThis';
      
      // Mark isomorphic-git and lightning-fs as having side effects
      // to prevent tree-shaking from removing necessary code
      config.module.rules.push({
        test: /node_modules[\\/](@isomorphic-git[\\/]lightning-fs|isomorphic-git)/,
        sideEffects: true,
      });
    }

    // WASMサポートを追加
    config.experiments = {
      ...config.experiments,
      asyncWebAssembly: true,
      layers: true,
    };

    // WASMファイルをassetとして扱う
    config.module.rules.push({
      test: /\.wasm$/,
      type: 'asset/resource',
    });

    return config;
  },
};

// 本番ビルド用設定
const productionConfig = isProductionBuild
  ? {
      output: 'export',
      trailingSlash: true,
      typescript: {
        ignoreBuildErrors: true,
      },
    }
  : {};



const nextConfig = {
  ...commonConfig,
  ...productionConfig,
  // Ensure isomorphic-git and lightning-fs are properly transpiled
  transpilePackages: ['isomorphic-git', '@isomorphic-git/lightning-fs'],
  // Turbopack configuration for polyfills
  experimental: {
    turbo: {
      resolveAlias: {
        buffer: 'buffer',
        process: 'process/browser',
        path: 'path-browserify',
        vm: 'vm-browserify',
        util: 'util',
        stream: 'readable-stream',
        crypto: 'crypto-browserify',
        os: 'os-browserify',
      },
    },
  },
  // NEXT_PUBLIC_BASE_PATH に基づき Next の basePath / assetPrefix を設定
  // 空文字の場合は undefined にすることで Next のデフォルト挙動に委ねる
  basePath: configuredBasePath,
  assetPrefix: configuredBasePath || undefined,
};

console.log(`Building in ${isProductionBuild ? 'PRODUCTION' : 'DEVELOPMENT'} mode`);

module.exports = nextConfig;