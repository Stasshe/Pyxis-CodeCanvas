import type { Metadata } from 'next';

import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import { ThemeProvider } from '@/context/ThemeContext';
import { GitHubUserProvider } from '@/context/GitHubUserContext';
import { I18nProvider } from '@/context/I18nContext';
import { ToastContainer } from '@/components/Toast';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

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
    icon: '/favicon.ico',
    shortcut: '/favicon.ico',
    apple: '/apple-touch-icon.png',
  },
  openGraph: {
    title: 'Pyxis - クライアントサイド IDE & ターミナル',
    description:
      'Node.js ランタイムと Git サポートを完全内蔵したクライアントサイド IDE。iPad/モバイル/PC で動作。VS Code ライクな編集、Git バージョン管理、npm 実行、オフライン対応。',
    url: 'https://pyxis-code.onrender.com',
    siteName: 'Pyxis',
    images: [
      {
        url: '/apple-touch-icon.png',
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
      'Node.js ランタイムと Git サポートを完全内蔵したクライアントサイド IDE。iPad/モバイル/PC で動作。VS Code ライクな編集、Git バージョン管理、npm 実行、オフライン対応。',
    images: [
      {
        url: '/apple-touch-icon.png',
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
  return (
    <html
      lang="en"
      className="h-full"
    >
      <head>
        <link
          rel="icon"
          href="/favicon.ico"
          sizes="any"
        />
        <link
          rel="icon"
          type="image/svg+xml"
          href="/file.svg"
        />
        <link
          rel="apple-touch-icon"
          href="/apple-touch-icon.png"
          sizes="180x180"
        />
        <meta
          name="theme-color"
          content="#18181b"
        />
        {/* PWA manifest & service worker */}
        <link
          rel="manifest"
          href="/manifest.json"
        />
        <meta
          name="apple-mobile-web-app-capable"
          content="yes"
        />
        <meta
          name="apple-mobile-web-app-status-bar-style"
          content="default"
        />
        <meta
          name="mobile-web-app-capable"
          content="yes"
        />
        <meta
          name="application-name"
          content="Pyxis"
        />
        <meta
          name="apple-mobile-web-app-title"
          content="Pyxis"
        />
        <meta
          name="msapplication-starturl"
          content="/"
        />
        <meta
          name="msapplication-TileColor"
          content="#18181b"
        />
        <meta
          name="msapplication-tap-highlight"
          content="no"
        />
        {/* Load eruda only in development (controlled via NEXT_PUBLIC_IS_DEV or NODE_ENV) */}
        {process.env.NEXT_PUBLIC_IS_PRODUCTION_BUILD !== 'true' && (
          <>
            <script src="https://cdn.jsdelivr.net/npm/eruda"></script>
            <script dangerouslySetInnerHTML={{ __html: 'eruda.init();' }} />
          </>
        )}
        {/* Pyodide (Python in browser) */}
        <script src="https://cdn.jsdelivr.net/pyodide/v0.25.1/full/pyodide.js"></script>
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased h-full`}>
        <I18nProvider>
          <ThemeProvider>
            <GitHubUserProvider>
              {children}
              <ToastContainer />
            </GitHubUserProvider>
          </ThemeProvider>
        </I18nProvider>
        {/* Register service worker to enable icon caching (only on client/runtime) */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
            if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
              window.addEventListener('load', function() {
                navigator.serviceWorker
                  .register('/sw.js')
                  .then(function(reg) {
                    // registration successful
                    // console.log('ServiceWorker registration successful with scope: ', reg.scope);
                  })
                  .catch(function(err) {
                    console.error('ServiceWorker registration failed: ', err);
                  });
              });
            }
          `,
          }}
        />
      </body>
    </html>
  );
}
