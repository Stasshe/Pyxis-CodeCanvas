/**
 * Extension Auto-installer
 * 
 * アプリケーション起動時に実行され、以下を行う:
 * 1. ブラウザ言語を検出
 * 2. 対応する言語パックを自動インストール
 * 3. デフォルト有効化された拡張機能をインストール
 */

import { extensionManager } from './extensionManager';
import { fetchRegistry } from './extensionRegistry';

/**
 * ブラウザの言語を検出
 */
function detectBrowserLocale(): string {
  if (typeof window === 'undefined') return 'en';
  
  const lang = navigator.language || (navigator as any).userLanguage || 'en';
  
  // 'ja-JP' -> 'ja', 'en-US' -> 'en' のように変換
  return lang.split('-')[0].toLowerCase();
}

/**
 * 言語コードをロケールIDに変換
 */
function localeToExtensionId(locale: string): string {
  return `pyxis.lang.${locale}`;
}

/**
 * 初回起動時の自動インストール
 */
export async function autoInstallExtensions(): Promise<void> {
  console.log('[ExtensionAutoInstaller] Starting auto-installation...');
  
  try {
    // レジストリを取得
    const registry = await fetchRegistry();
    if (!registry) {
      console.error('[ExtensionAutoInstaller] Failed to fetch registry');
      return;
    }

    // ブラウザ言語を検出
    const detectedLocale = detectBrowserLocale();
    console.log(`[ExtensionAutoInstaller] Detected locale: ${detectedLocale}`);

    // デフォルト有効化された拡張機能をインストール
    const defaultExtensions = registry.extensions.filter(e => e.defaultEnabled);
    for (const ext of defaultExtensions) {
      try {
        console.log(`[ExtensionAutoInstaller] Installing default extension: ${ext.manifestUrl}`);
        await extensionManager.installExtension(ext.manifestUrl);
        // manifestUrlから拡張機能IDを取得 (extension idで有効化)
        await extensionManager.enableExtension(ext.id);
      } catch (error) {
        console.error(`[ExtensionAutoInstaller] Failed to install ${ext.manifestUrl}:`, error);
      }
    }

    // 検出された言語に対応する言語パックをインストール
    const langPackId = localeToExtensionId(detectedLocale);
    const langPackEntry = registry.extensions.find(e => 
      e.manifestUrl.includes(`lang-packs/${detectedLocale}/`)
    );

    if (langPackEntry) {
      try {
        console.log(`[ExtensionAutoInstaller] Installing language pack for: ${detectedLocale}`);
        await extensionManager.installExtension(langPackEntry.manifestUrl);
        await extensionManager.enableExtension(langPackId);
      } catch (error) {
        console.error(`[ExtensionAutoInstaller] Failed to install language pack:`, error);
      }
    } else {
      console.log(`[ExtensionAutoInstaller] No language pack found for: ${detectedLocale}`);
    }

    console.log('[ExtensionAutoInstaller] Auto-installation completed');
  } catch (error) {
    console.error('[ExtensionAutoInstaller] Auto-installation failed:', error);
  }
}

/**
 * 既にインストール済みかチェック
 */
export async function isFirstRun(): Promise<boolean> {
  const installed = await extensionManager.getInstalledExtensions();
  return installed.length === 0;
}

/**
 * 初期化 (アプリケーション起動時に呼び出し)
 */
export async function initializeExtensions(): Promise<void> {
  // ExtensionManagerを初期化
  await extensionManager.init();

  // 初回起動時のみ自動インストール
  const firstRun = await isFirstRun();
  if (firstRun) {
    console.log('[ExtensionAutoInstaller] First run detected, auto-installing extensions...');
    await autoInstallExtensions();
  } else {
    console.log('[ExtensionAutoInstaller] Extensions already installed');
  }
}
