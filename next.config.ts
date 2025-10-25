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

// package.jsonからバージョン取得
const pkg = require('./package.json');

// 共通設定
const commonConfig = {
  reactStrictMode: false,
  staticPageGenerationTimeout: 300,
  images: {
    unoptimized: true, // 静的エクスポートでは必須
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
        stream: require.resolve('stream-browserify'),
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
  turbopack: {}, // Next.js 16 以降のTurbopack対応
};

console.log(`Building in ${isProductionBuild ? 'PRODUCTION' : 'DEVELOPMENT'} mode`);

module.exports = nextConfig;