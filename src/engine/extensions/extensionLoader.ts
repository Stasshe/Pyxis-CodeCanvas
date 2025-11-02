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
import { extensionInfo, extensionError } from './extensionsLogger';

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
      ? (process.env.NEXT_PUBLIC_BASE_PATH || '') + manifestUrl
      : `${EXTENSIONS_BASE_URL}/${manifestUrl}`;

    extensionInfo(`Fetching manifest from: ${url}`);
    const response = await fetch(url);
    if (!response.ok) {
      extensionError(`Failed to fetch manifest: ${url} (${response.status})`);
      return null;
    }

    const manifest = await response.json();
    extensionInfo(`Manifest loaded: ${manifest.id}`);
    return manifest as ExtensionManifest;
  } catch (error) {
    extensionError('Error fetching manifest:', error);
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

    extensionInfo(`Fetching extension file: ${url}`);
    const response = await fetch(url);
    if (!response.ok) {
      extensionError(`Failed to fetch file: ${url} (${response.status})`);
      return null;
    }

    return await response.text();
  } catch (error) {
    extensionError('Error fetching file:', error);
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
    extensionInfo(`Fetching extension code for: ${manifest.id}`);
    // エントリーポイントを取得
    const entryCode = await fetchExtensionFile(manifest, manifest.entry);
    if (!entryCode) {
      extensionError('Failed to load entry point');
      return null;
    }
    // 追加ファイルを取得
    const files: Record<string, string> = {};
    if (manifest.files && manifest.files.length > 0) {
      extensionInfo(`Loading ${manifest.files.length} additional files`);
      await Promise.all(
        manifest.files.map(async filePath => {
          const code = await fetchExtensionFile(manifest, filePath);
          if (code) {
            files[filePath] = code;
            extensionInfo(`Loaded additional file: ${filePath}`);
          }
        })
      );
    }

    return { entryCode, files };
  } catch (error) {
    extensionError('Error fetching extension code:', error);
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
    extensionInfo('Loading extension module');
    // import文を含むコードをdata URLとしてES Moduleで実行
    // Blob + URL.createObjectURL を使ってdynamic importで読み込む
    const blob = new Blob([entryCode], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);

    try {
      // Dynamic importでモジュールをロード
      const module = await import(/* webpackIgnore: true */ url);

      // activate関数の存在を確認
      if (typeof module.activate !== 'function') {
        extensionError('Extension must export an activate function');
        return null;
      }

      extensionInfo('Extension module loaded successfully');
      return module as ExtensionExports;
    } catch (importError) {
      throw importError;
    } finally {
      // URLをクリーンアップ（成功/失敗に関わらず実行）
      URL.revokeObjectURL(url);
    }
  } catch (error) {
    extensionError('Error loading extension module:', error);
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
    extensionInfo('Activating extension');
    const activation = await exports.activate(context);
    extensionInfo('Extension activated successfully');
    return activation;
  } catch (error) {
    extensionError('Error activating extension:', error);
    return null;
  }
}

/**
 * 拡張機能をデアクティベート
 */
export async function deactivateExtension(exports: ExtensionExports): Promise<void> {
  try {
    if (exports.deactivate) {
      extensionInfo('Deactivating extension');
      await exports.deactivate();
      extensionInfo('Extension deactivated successfully');
    }
  } catch (error) {
    extensionError('Error deactivating extension:', error);
  }
}
