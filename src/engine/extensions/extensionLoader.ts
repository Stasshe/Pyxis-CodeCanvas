/**
 * Extension Loader
 * 拡張機能のコードをfetchしてロード・実行する
 */

import { isBinaryExt, toDataUrlFromUint8, dataUrlToBlob } from './binaryUtils';
import { extensionInfo, extensionError } from './extensionsLogger';
import { transformImports } from './transformImports';
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

    // Determine if this file should be treated as binary (images, wasm, fonts, videos, audio, etc.)
    if (isBinaryExt(filePath)) {
      const arrayBuffer = await response.arrayBuffer();
      const uint8 = new Uint8Array(arrayBuffer);
      return toDataUrlFromUint8(uint8, filePath);
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
    const entryCode = await fetchExtensionFile(manifest, manifest.entry || 'index.js');
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
 *
 * @param entryCode エントリーポイントのコード
 * @param additionalFiles 追加ファイルのマップ (ファイル名 -> コードまたはBlob)
 * @param context 拡張機能のコンテキスト
 */
export async function loadExtensionModule(
  entryCode: string,
  additionalFiles: Record<string, string | Blob>,
  context: ExtensionContext
): Promise<ExtensionExports | null> {
  try {
    extensionInfo('Loading extension module');

    // Reactが利用可能か確認
    if (typeof window !== 'undefined' && !(window as any).__PYXIS_REACT__) {
      extensionError(
        'React is not available in global scope. Ensure ExtensionManager.initialize() has been called before loading extensions.'
      );
      return null;
    }

    // Blob URLのマップを作成（クリーンアップのため）
    const blobUrls: string[] = [];

    try {
      // Import Mapを作成
      const importMap: Record<string, string> = {};

      // 追加ファイルをBlobURLとして登録
      for (const [filePath, code] of Object.entries(additionalFiles)) {
        let url: string;

        // If the file is a data URL (binary stored as data:<mime>;base64,...) create a blob from it
        const isBlobLike =
          code && typeof code === 'object' && 'size' in (code as any) && 'type' in (code as any);
        if (isBlobLike) {
          url = URL.createObjectURL(code as Blob);
        } else if (typeof code === 'string' && code.startsWith('data:')) {
          try {
            const blob = dataUrlToBlob(code);
            url = URL.createObjectURL(blob);
          } catch (e) {
            // fallback to treating as text module
            const transformedCode = transformImports(code as string);
            const blob = new Blob([transformedCode], { type: 'application/javascript' });
            url = URL.createObjectURL(blob);
          }
        } else {
          const transformedCode = transformImports(code as string);
          const blob = new Blob([transformedCode], { type: 'application/javascript' });
          url = URL.createObjectURL(blob);
        }
        blobUrls.push(url);

        // 相対パスをimport mapに登録
        // 例: "helper.js" -> "./" + "helper.js" = "./helper.js"
        //     "utils/math.js" -> "./" + "utils/math.js" = "./utils/math.js"
        const normalizedPath = filePath.startsWith('./') ? filePath : `./${filePath}`;

        // 拡張子なしのパスもマッピング（TypeScriptの import './helper' に対応）
        const pathWithoutExt = normalizedPath.replace(/\.(js|ts|tsx)$/, '');

        importMap[normalizedPath] = url;
        importMap[pathWithoutExt] = url;

        extensionInfo(`Mapped module: ${normalizedPath} -> ${url.slice(0, 50)}...`);
      }

      // エントリーコードを変換し、相対importをBlobURLに書き換え
      let transformedEntryCode = transformImports(entryCode);

      // 相対importをBlobURLに書き換え
      // import { ... } from './module' 形式
      transformedEntryCode = transformedEntryCode.replace(
        /from\s+['"](\.[^'"]+)['"]/g,
        (match, importPath) => {
          // 拡張子を正規化
          let normalizedImportPath = importPath;

          // 拡張子がない場合は .js を試す
          if (!importPath.match(/\.(js|ts|tsx)$/)) {
            const withJs = `${importPath}.js`;
            if (importMap[withJs]) {
              normalizedImportPath = withJs;
            }
          }

          const resolvedUrl = importMap[normalizedImportPath];
          if (resolvedUrl) {
            extensionInfo(`Resolved import: ${importPath} -> ${resolvedUrl.slice(0, 50)}...`);
            return `from '${resolvedUrl}'`;
          }

          extensionError(`Failed to resolve import: ${importPath}`);
          return match; // 解決できない場合は元のまま
        }
      );

      // デバッグ: 変換後のコードの最初の部分をログ出力
      console.log(
        '[ExtensionLoader] Transformed code preview:',
        transformedEntryCode.slice(0, 500)
      );

      // エントリーポイントをBlobURLとして作成
      const entryBlob = new Blob([transformedEntryCode], { type: 'application/javascript' });
      const entryUrl = URL.createObjectURL(entryBlob);
      blobUrls.push(entryUrl);

      // Dynamic importでモジュールをロード
      const module = await import(/* webpackIgnore: true */ entryUrl);

      // activate関数の存在を確認
      if (typeof module.activate !== 'function') {
        extensionError('Extension must export an activate function');
        return null;
      }

      extensionInfo('Extension module loaded successfully');
      return module as ExtensionExports;
    } finally {
      // 全てのBlobURLをクリーンアップ
      blobUrls.forEach(url => URL.revokeObjectURL(url));
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
    // より詳細なエラー情報を出力
    if (error instanceof Error) {
      console.error('[ExtensionLoader] Activation error details:', {
        message: error.message,
        stack: error.stack,
        name: error.name,
      });
    }
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
