import { ReactScan } from '@/lib/ReactScan';
import type { Metadata, Viewport } from 'next';

import './globals.css';
import AppInitializer from '@/components/AppInitializer';
import { TabSessionManager } from '@/components/Tab/TabSessionManager';
import { FileSelectorProvider } from '@/context/FileSelectorContext';
import { GitHubUserProvider } from '@/context/GitHubUserContext';
import { I18nProvider } from '@/context/I18nContext';
import { ThemeProvider } from '@/context/ThemeContext';

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 0.9,
};

export const metadata: Metadata = {
  title: 'Pyxis - clientIDE Terminal',
  description:
    '完全クライアントサイド IDE。Node.js ランタイムと Git サポートを完全内蔵。サーバー不要で、iPad/モバイル/PC で動作。VS Code ライクな編集、Git バージョン管理、npm 実行、オフライン対応。',
  applicationName: 'Pyxis',
  keywords: [
    'クライアントサイド',
    'IDE',
    'Node.js',
    'Git',
    'VS Code',
    'iPad',
    'モバイル',
    'Web IDE',
    'オフライン',
    'npm',
  ],
  authors: [{ name: 'Pyxis Project' }],
  creator: 'Pyxis Project',
  icons: {
    // basePath を考慮して動的にパスを生成（build-time に置換される NEXT_PUBLIC_* を利用）
    // NEXT_PUBLIC_BASE_PATH は next.config.js で env に注入済み
    icon: `${process.env.NEXT_PUBLIC_BASE_PATH || ''}/favicon.ico`,
    shortcut: `${process.env.NEXT_PUBLIC_BASE_PATH || ''}/favicon.ico`,
    apple: `${process.env.NEXT_PUBLIC_BASE_PATH || ''}/apple-touch-icon.png`,
  },
  openGraph: {
    title: 'Pyxis - クライアントサイド IDE & ターミナル',
    description:
      'Node.js ランタイムと Git サポートを完全内蔵したクライアントサイド IDE。iPad/モバイル/PC で動作。VS Code ライクな編集、Git バージョン管理、npm 実行、オフライン対応。',
    url: 'https://Stasshe.github.io/Pyxis-CodeCanvas',
    siteName: 'Pyxis',
    images: [
      {
        url: `${process.env.NEXT_PUBLIC_BASE_PATH || ''}/apple-touch-icon.png`,
        width: 512,
        height: 512,
        alt: 'Pyxis Logo',
      },
    ],
    locale: 'ja_JP',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Pyxis - クライアントサイド IDE & ターミナル',
    description:
      'Node.js ランタイムと Git サポートを内蔵したクライアントサイドIDE。iPad/モバイル/PC で動作。VS Code ライクな編集、Git バージョン管理、npm 実行、オフライン対応。',
    images: [
      {
        url: `${process.env.NEXT_PUBLIC_BASE_PATH || ''}/apple-touch-icon.png`,
        alt: 'Pyxis Logo',
      },
    ],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // basePath を runtime で組み立て。NEXT_PUBLIC_BASE_PATH は next.config の env で注入済み
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';
  const swPath = `${basePath}/sw.js`;
  const manifestPath = `${basePath}/manifest.json`;
  return (
    <html lang="en" className="h-full" translate="no">
      <ReactScan />
      <head>
        <meta name="google" content="notranslate" />
        <link rel="icon" href={`${basePath}/favicon.ico`} sizes="any" />
        <link rel="icon" type="image/svg+xml" href={`${basePath}/file.svg`} />
        <link rel="apple-touch-icon" href={`${basePath}/apple-touch-icon.png`} sizes="180x180" />
        <meta name="theme-color" content="#18181b" />
        {/* Google Analytics */}
        <script async src="https://www.googletagmanager.com/gtag/js?id=G-7K55SSBCPF" />
        <script src={`${basePath}/ga-init.js`} />
        {/* PWA manifest & service worker */}
        <link rel="manifest" href={manifestPath} />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="application-name" content="Pyxis" />
        <meta name="apple-mobile-web-app-title" content="Pyxis" />
        <meta name="msapplication-starturl" content={basePath || '/'} />
        <meta name="msapplication-TileColor" content="#18181b" />
        <meta name="msapplication-tap-highlight" content="no" />
        {/* Load eruda only in development (controlled via NEXT_PUBLIC_IS_DEV or NODE_ENV) */}
        {(process.env.NEXT_PUBLIC_IS_PRODUCTION_BUILD !== 'true' ||
          process.env.NEXT_PUBLIC_IS_DEV_SERVER) && (
          <>
            <script src="https://cdn.jsdelivr.net/npm/eruda" />
            <script src={`${basePath}/eruda-init.js`} />
          </>
        )}
        {/* Pyodide (Python in browser) */}
        <script src="https://cdn.jsdelivr.net/pyodide/v0.25.1/full/pyodide.js" />
      </head>
      <body className="antialiased h-full font-sans">
        {/* Set base path for runtime access (exposed via meta + external initializer) */}
        <meta name="pyxis-base-path" content={basePath} />
        <script src={`${basePath}/base-path-init.js`} />
        <I18nProvider>
          <ThemeProvider>
            <GitHubUserProvider>
              <TabSessionManager>
                <FileSelectorProvider>
                  {children}
                  <AppInitializer />
                </FileSelectorProvider>
              </TabSessionManager>
            </GitHubUserProvider>
          </ThemeProvider>
        </I18nProvider>
        {/* Register service worker to enable icon caching (only on client/runtime) */}
        <script src={`${basePath}/sw-register.js`} />
      </body>
    </html>
  );
}
