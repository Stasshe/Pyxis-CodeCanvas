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
const EXTENSIONS_BASE_URL = (process.env.NEXT_PUBLIC_BASE_PATH || '') + '/extensions';

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
    // manifest.idから拡張機能のパスを生成
    // 例: "pyxis.typescript-runtime" -> "typescript-runtime"
    //     "pyxis.lang.ja" -> "lang-packs/ja"
    let manifestDir: string;
    if (manifest.id.startsWith('pyxis.lang.')) {
      const locale = manifest.id.replace('pyxis.lang.', '');
      manifestDir = `lang-packs/${locale}`;
    } else {
      const name = manifest.id.replace('pyxis.', '');
      manifestDir = name;
    }
    
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
    // import文を含むコードをdata URLとしてES Moduleで実行
    // Blob + URL.createObjectURL を使ってdynamic importで読み込む
    const blob = new Blob([entryCode], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);

    try {
      // Dynamic importでモジュールをロード
      const module = await import(/* webpackIgnore: true */ url);

      // activate関数の存在を確認
      if (typeof module.activate !== 'function') {
        console.error('[ExtensionLoader] Extension must export an activate function');
        return null;
      }

      return module as ExtensionExports;
    } catch (importError) {
      throw importError;
    } finally {
      // URLをクリーンアップ（成功/失敗に関わらず実行）
      URL.revokeObjectURL(url);
    }
  } catch (error) {
    console.error('[ExtensionLoader] Error loading extension module:', error);
    console.error('Error details:', error);
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
