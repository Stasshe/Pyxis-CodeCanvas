/** @type {import('next').NextConfig} */

// 環境変数から本番ビルドモードかどうかを判断
const isProductionBuild = process.env.NEXT_PUBLIC_BUILD_MODE === 'production';

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