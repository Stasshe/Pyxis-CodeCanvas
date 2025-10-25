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
    url: 'https://pyxis-code.onrender.com',
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
      'Node.js ランタイムと Git サポートを完全内蔵したクライアントサイド IDE。iPad/モバイル/PC で動作。VS Code ライクな編集、Git バージョン管理、npm 実行、オフライン対応。',
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
    <html
      lang="en"
      className="h-full"
    >
      <head>
        <link
          rel="icon"
          href={`${basePath}/favicon.ico`}
          sizes="any"
        />
        <link
          rel="icon"
          type="image/svg+xml"
          href={`${basePath}/file.svg`}
        />
        <link
          rel="apple-touch-icon"
          href={`${basePath}/apple-touch-icon.png`}
          sizes="180x180"
        />
        <meta
          name="theme-color"
          content="#18181b"
        />
        {/* PWA manifest & service worker */}
        <link
          rel="manifest"
          href={manifestPath}
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
          content={basePath || '/'}
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
            // expose basePath to runtime
            try {
              window.__PYXIS_BASE_PATH = '${basePath}';
            } catch (e) {}

            // Monkey-patch fetch to prefix absolute-path requests with basePath.
            // This lets code that does 'fetch("/locales/...")' or similar keep working
            // without changing every call site.
            (function() {
              try {
                var bp = (window && window.__PYXIS_BASE_PATH) || '';
                if (!bp) return;
                var _origFetch = window.fetch.bind(window);
                window.fetch = function(input, init) {
                  try {
                    if (typeof input === 'string') {
                      if (input.startsWith('/') && !input.startsWith(bp + '/')) {
                        input = bp + input;
                      }
                    } else if (input && input.url) {
                      // Request object
                      var reqUrl = new URL(input.url, location.origin);
                      if (reqUrl.pathname.startsWith('/') && !reqUrl.pathname.startsWith(bp + '/')) {
                        var newUrl = bp + reqUrl.pathname + reqUrl.search;
                        input = new Request(newUrl, input);
                      }
                    }
                  } catch (e) {
                    // ignore and fallback to original input
                  }
                  return _origFetch(input, init);
                };
              } catch (e) {
                // noop
              }
            })();

            if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
              window.addEventListener('load', function() {
                navigator.serviceWorker
                  .register('${swPath}')
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
