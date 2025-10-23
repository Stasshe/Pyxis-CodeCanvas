/** @type {import('next').NextConfig} */


// 環境変数から本番ビルドモードかどうかを判断
const isProductionBuild = process.env.BUILD_MODE === 'production';
console.log(`isProductionBuild: ${isProductionBuild}`);

// package.jsonからバージョン取得
const pkg = require('./package.json');

// 共通設定
const commonConfig = {
  reactStrictMode: false,
  staticPageGenerationTimeout: 300,
  images: {
    unoptimized: true, // 静的エクスポートでは必須
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
        // バージョンをDefinePluginで注入
        new (require('webpack')).DefinePlugin({
          'process.env.PYXIS_VERSION': JSON.stringify(pkg.version),
          'process.env.IS_DEV': isProductionBuild,
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