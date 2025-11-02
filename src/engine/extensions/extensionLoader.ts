/**
 * Extension Loader
 * 拡張機能のコードをfetchしてロード・実行する
 */

import type {
  ExtensionManifest,
  ExtensionExports,
  ExtensionContext,
  ExtensionActivation,
} from './types';

/**
 * 拡張機能のベースURL（public/extensions/）
 */
const EXTENSIONS_BASE_URL = '/extensions';

/**
 * 拡張機能のマニフェストを取得
 */
export async function fetchExtensionManifest(
  manifestUrl: string
): Promise<ExtensionManifest | null> {
  try {
    const url = manifestUrl.startsWith('/')
      ? manifestUrl
      : `${EXTENSIONS_BASE_URL}/${manifestUrl}`;

    const response = await fetch(url);
    if (!response.ok) {
      console.error(`[ExtensionLoader] Failed to fetch manifest: ${url} (${response.status})`);
      return null;
    }

    const manifest = await response.json();
    return manifest as ExtensionManifest;
  } catch (error) {
    console.error('[ExtensionLoader] Error fetching manifest:', error);
    return null;
  }
}

/**
 * 拡張機能のファイルを取得
 */
export async function fetchExtensionFile(
  manifest: ExtensionManifest,
  filePath: string
): Promise<string | null> {
  try {
    // マニフェストのディレクトリを取得
    const manifestDir = manifest.id.replace(/\./g, '/');
    const url = `${EXTENSIONS_BASE_URL}/${manifestDir}/${filePath}`;

    const response = await fetch(url);
    if (!response.ok) {
      console.error(`[ExtensionLoader] Failed to fetch file: ${url} (${response.status})`);
      return null;
    }

    return await response.text();
  } catch (error) {
    console.error('[ExtensionLoader] Error fetching file:', error);
    return null;
  }
}

/**
 * 拡張機能のエントリーポイントと追加ファイルを全て取得
 */
export async function fetchExtensionCode(manifest: ExtensionManifest): Promise<{
  entryCode: string;
  files: Record<string, string>;
} | null> {
  try {
    // エントリーポイントを取得
    const entryCode = await fetchExtensionFile(manifest, manifest.entry);
    if (!entryCode) {
      console.error('[ExtensionLoader] Failed to load entry point');
      return null;
    }

    // 追加ファイルを取得
    const files: Record<string, string> = {};
    if (manifest.files && manifest.files.length > 0) {
      await Promise.all(
        manifest.files.map(async filePath => {
          const code = await fetchExtensionFile(manifest, filePath);
          if (code) {
            files[filePath] = code;
          }
        })
      );
    }

    return { entryCode, files };
  } catch (error) {
    console.error('[ExtensionLoader] Error fetching extension code:', error);
    return null;
  }
}

/**
 * 拡張機能のコードを実行してモジュールをロード
 */
export async function loadExtensionModule(
  entryCode: string,
  context: ExtensionContext
): Promise<ExtensionExports | null> {
  try {
    // モジュール環境を構築
    const moduleWrapper = `
      return (async function(context) {
        const exports = {};
        const module = { exports };
        
        ${entryCode}
        
        // CommonJS形式をサポート
        return module.exports.default || module.exports;
      })
    `;

    // コードを実行
    const moduleFunc = new Function(moduleWrapper)();
    const extensionExports = await moduleFunc(context);

    // activate関数の存在を確認
    if (typeof extensionExports.activate !== 'function') {
      console.error('[ExtensionLoader] Extension must export an activate function');
      return null;
    }

    return extensionExports as ExtensionExports;
  } catch (error) {
    console.error('[ExtensionLoader] Error loading extension module:', error);
    return null;
  }
}

/**
 * 拡張機能をアクティベート
 */
export async function activateExtension(
  exports: ExtensionExports,
  context: ExtensionContext
): Promise<ExtensionActivation | null> {
  try {
    const activation = await exports.activate(context);
    return activation;
  } catch (error) {
    console.error('[ExtensionLoader] Error activating extension:', error);
    return null;
  }
}

/**
 * 拡張機能をデアクティベート
 */
export async function deactivateExtension(exports: ExtensionExports): Promise<void> {
  try {
    if (exports.deactivate) {
      await exports.deactivate();
    }
  } catch (error) {
    console.error('[ExtensionLoader] Error deactivating extension:', error);
  }
}
