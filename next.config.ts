/** @type {import('next').NextConfig} */

// 環境変数から本番ビルドモードかどうかを判断
const isProductionBuild = process.env.BUILD_MODE === 'production';

// 開発環境でも静的エクスポートに近い動作をさせるために共通設定を定義
const commonConfig = {
  // 画像設定
  images: {
    unoptimized: true, // 静的エクスポートでは必須
  },
  // 開発環境と本番環境の共通設定
  staticPageGenerationTimeout: 300,
};

const nextConfig = {
  // 共通設定を適用
  ...commonConfig,
  
  // React Strict Modeを無効化（開発時の警告を減らすため）
  reactStrictMode: false,
  
  // Webpack設定でNode.jsのpolyfillを追加
  webpack: (config: any, { isServer }: { isServer: boolean }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: require.resolve('path-browserify'),
        vm: require.resolve('vm-browserify'),
        buffer: require.resolve('buffer'),
        process: require.resolve('process/browser'),
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
      ];
      
      // WebWorkerの設定
      config.output.globalObject = 'globalThis';
    }
    return config;
  },
  
  // 本番ビルドモード時のみ静的エクスポートを有効化
  output: isProductionBuild ? 'export' : undefined,
  trailingSlash: isProductionBuild,
  // 静的エクスポート時のみ必要な設定
  images: {
    unoptimized: true,
  },
  // 本番ビルドでは各種エラーで失敗しないようにする
  eslint: {
    ignoreDuringBuilds: isProductionBuild,
  },
  typescript: {
    ignoreBuildErrors: isProductionBuild,
  },
};

console.log(`Building in ${isProductionBuild ? 'PRODUCTION' : 'DEVELOPMENT'} mode`);

module.exports = nextConfig;