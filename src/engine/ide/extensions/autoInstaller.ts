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
import { loadAutoInstallProgress, saveAutoInstallProgress } from './storage-adapter';

/**
 * ブラウザの言語を検出
 */
function detectBrowserLocale(): string {
  if (typeof window === 'undefined') return 'en';

  const lang = navigator.language || 'en';

  // 'ja-JP' -> 'ja', 'en-US' -> 'en' のように変換
  return lang.split('-')[0].toLowerCase();
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
    const selected = registry.extensions.filter(entry => entry.defaultEnabled);
    const langPackEntry = registry.extensions.find(e =>
      e.manifestUrl.includes(`lang-packs/${detectedLocale}/`)
    );
    if (langPackEntry && !selected.some(entry => entry.id === langPackEntry.id)) {
      selected.push(langPackEntry);
    }

    const progress = (await loadAutoInstallProgress()) ?? {
      started: false,
      completed: false,
      completedExtensionIds: [],
    };
    progress.started = true;
    progress.completed = false;
    await saveAutoInstallProgress(progress);
    const completedIds = new Set(progress.completedExtensionIds);
    const installed = await extensionManager.getInstalledExtensions();
    const installedById = new Map(installed.map(extension => [extension.manifest.id, extension]));

    for (const extension of selected) {
      if (completedIds.has(extension.id)) continue;

      try {
        let installedExtension = installedById.get(extension.id);
        const wasInstalled = Boolean(installedExtension);
        if (!installedExtension) {
          console.log(`[ExtensionAutoInstaller] Installing extension: ${extension.manifestUrl}`);
          const result = await extensionManager.installExtension(extension.manifestUrl);
          if (!result) throw new Error('Extension installation failed');
          installedExtension = (await extensionManager.getInstalledExtensions()).find(
            item => item.manifest.id === extension.id
          );
        }
        if (!installedExtension) throw new Error('Extension was not saved after installation');
        if (wasInstalled && !installedExtension.enabled) {
          const enabled = await extensionManager.enableExtension(extension.id);
          if (!enabled) throw new Error('Extension activation failed');
          installedExtension = (await extensionManager.getInstalledExtensions()).find(
            item => item.manifest.id === extension.id
          );
        }
        if (!installedExtension?.enabled) throw new Error('Extension activation failed');
        completedIds.add(extension.id);
        progress.completedExtensionIds = Array.from(completedIds);
        await saveAutoInstallProgress(progress);
      } catch (error) {
        console.error(
          `[ExtensionAutoInstaller] Failed to install ${extension.manifestUrl}:`,
          error
        );
      }
    }

    progress.completed = selected.every(entry => completedIds.has(entry.id));
    progress.completedExtensionIds = Array.from(completedIds);
    await saveAutoInstallProgress(progress);
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
  const progress = await loadAutoInstallProgress();
  if (progress?.completed) return false;
  return installed.length === 0 || progress?.started === true;
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
