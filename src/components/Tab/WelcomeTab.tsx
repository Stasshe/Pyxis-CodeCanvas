import React, { useEffect, useState } from 'react';
import { useTranslation } from '@/context/I18nContext';

export default function WelcomeTab() {
  const { t } = useTranslation();
  const [isDevServer, setIsDevServer] = useState(false);
  const [lang, setLang] = useState<'en' | 'ja'>('en');
  return (
    <div
      className="h-full flex flex-col items-center text-muted-foreground overflow-hidden"
      style={{
        userSelect: 'none',
        WebkitUserSelect: 'none',
        WebkitTouchCallout: 'none',
        MozUserSelect: 'none',
        msUserSelect: 'none',
        touchAction: 'manipulation',
      }}
    >
      <div className="max-w-2xl w-full h-full overflow-auto px-8 py-6">
        <div className="pb-24">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold mb-3">{t('welcome.title')}</h1>
          </div>

          {/* 🟡 onrender.com向け注意表示 */}
          {process.env.NEXT_PUBLIC_IS_DEV_SERVER && (
            <div className="bg-yellow-100 text-yellow-800 p-4 rounded-lg shadow mb-8 border border-yellow-300">
              {lang === 'ja' ? (
                <>
                  <p className="font-semibold mb-1">
                    ⚠️ 現在、開発用サーバー（Render）で動作しています。
                  </p>
                  <p>
                    安定版は{' '}
                    <a
                      href="https://stasshe.github.io/Pyxis-CodeCanvas"
                      className="underline text-blue-600"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      公式サイト（GitHub Pages）
                    </a>{' '}
                    をご利用ください。
                  </p>
                </>
              ) : (
                <>
                  <p className="font-semibold mb-1">
                    ⚠️ You are viewing the development server (Render).
                  </p>
                  <p>
                    For a stable experience, please visit{' '}
                    <a
                      href="https://stasshe.github.io/Pyxis-CodeCanvas"
                      className="underline text-blue-600"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      the official site (GitHub Pages)
                    </a>
                    .
                  </p>
                </>
              )}
            </div>
          )}

          <div className="bg-card p-6 rounded-lg shadow-lg text-sm mb-8">
            <p className="mb-2 text-base">{t('welcome.indexeddbInfo')}</p>
          </div>
          <div className="bg-card p-6 rounded-lg shadow-lg text-sm mb-8">
            <p className="mb-2 text-base">{t('welcome.clientSideNote')}</p>
          </div>
          <div className="bg-card p-6 rounded-lg shadow-lg text-sm mb-8">
            <p className="mb-2 text-base">{t('welcome.hmrHint')}</p>
          </div>
          <div className="bg-card p-6 rounded-lg shadow-lg text-sm mb-8">
            <p className="mb-2 text-base">{t('welcome.githubNote')}</p>
          </div>

          <section className="mb-8">
            <h3 className="text-xl font-semibold mb-4 pb-2 border-b">
              {t('welcome.features.title')}
            </h3>
            <ul className="space-y-2 text-base">
              <li className="flex items-center gap-2">
                <span className="w-2 h-2 bg-primary rounded-full flex-shrink-0"></span>
                {t('welcome.features.clientIDE')}
              </li>
              <li className="flex items-center gap-2">
                <span className="w-2 h-2 bg-primary rounded-full flex-shrink-0"></span>
                {t('welcome.features.nodeRuntime')}
              </li>
              <li className="flex items-center gap-2">
                <span className="w-2 h-2 bg-primary rounded-full flex-shrink-0"></span>
                {t('welcome.features.monaco')}
              </li>
              <li className="flex items-center gap-2">
                <span className="w-2 h-2 bg-primary rounded-full flex-shrink-0"></span>
                {t('welcome.features.gitHistory')}
              </li>
              <li className="flex items-center gap-2">
                <span className="w-2 h-2 bg-primary rounded-full flex-shrink-0"></span>
                {t('welcome.features.responsive')}
              </li>
              <li className="flex items-center gap-2">
                <span className="w-2 h-2 bg-primary rounded-full flex-shrink-0"></span>
                {t('welcome.features.languages')}
              </li>
              <li className="flex items-center gap-2">
                <span className="w-2 h-2 bg-primary rounded-full flex-shrink-0"></span>
                {t('welcome.features.mermaid')}
              </li>
            </ul>
          </section>

          <section>
            <h3 className="text-xl font-semibold mb-4 pb-2 border-b">
              {t('welcome.mainFeatures.title')}
            </h3>
            <ul className="space-y-2 text-base">
              <li className="flex items-center gap-2">
                <span className="w-2 h-2 bg-primary rounded-full flex-shrink-0"></span>
                {t('welcome.mainFeatures.latex')}
              </li>
              <li className="flex items-center gap-2">
                <span className="w-2 h-2 bg-primary rounded-full flex-shrink-0"></span>
                {t('welcome.mainFeatures.importExport')}
              </li>
              <li className="flex items-center gap-2">
                <span className="w-2 h-2 bg-primary rounded-full flex-shrink-0"></span>
                {t('welcome.mainFeatures.theme')}
              </li>
              <li className="flex items-center gap-2">
                <span className="w-2 h-2 bg-primary rounded-full flex-shrink-0"></span>
                {t('welcome.mainFeatures.download')}
              </li>
            </ul>
          </section>

          <section className="mt-12">
            <h3 className="text-xl font-semibold mb-4 pb-2 border-b">
              {t('welcome.specialThanks.title')}
            </h3>
            <ul className="space-y-2 text-base">
              <li>{t('welcome.specialThanks.contributors')}</li>
              <li>{t('welcome.specialThanks.thanksVisit')}</li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
