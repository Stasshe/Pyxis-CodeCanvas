/**
 * Extension Loader
 * 拡張機能のコードをfetchしてロード・実行する
 */

import { parser } from '@lezer/javascript';

import { detectFileContent } from '@/engine/core/fileBytes';
import { assetPath } from '@/env';
import { dataUrlToBlob, toDataUrlFromUint8 } from './binaryData';
import { extensionError, extensionInfo } from './extensionsLogger';
import type {
  ExtensionActivation,
  ExtensionContext,
  ExtensionExports,
  ExtensionManifest,
} from './types';
import { ExtensionType } from './types';

/**
 * 拡張機能のベースURL（public/extensions/）
 */
const EXTENSIONS_BASE_URL = assetPath('/extensions');

/**
 * 拡張機能のマニフェストを取得
 */
export async function fetchExtensionManifest(
  manifestUrl: string
): Promise<ExtensionManifest | null> {
  try {
    const url = manifestUrl.startsWith('/')
      ? assetPath(manifestUrl)
      : `${EXTENSIONS_BASE_URL}/${manifestUrl}`;

    extensionInfo(`Fetching manifest from: ${url}`);
    const response = await fetch(url);
    if (!response.ok) {
      extensionError(`Failed to fetch manifest: ${url} (${response.status})`);
      return null;
    }

    const manifest: unknown = await response.json();
    if (!isExtensionManifest(manifest)) {
      extensionError(`Invalid extension manifest: ${url}`);
      return null;
    }
    extensionInfo(`Manifest loaded: ${manifest.id}`);
    return manifest;
  } catch (error) {
    extensionError('Error fetching manifest:', error);
    return null;
  }
}

export function isExtensionManifest(value: unknown): value is ExtensionManifest {
  if (value === null || typeof value !== 'object') return false;
  const manifest = value as Record<string, unknown>;
  return (
    typeof manifest.id === 'string' &&
    manifest.id.trim().length > 0 &&
    typeof manifest.name === 'string' &&
    manifest.name.trim().length > 0 &&
    typeof manifest.version === 'string' &&
    manifest.version.trim().length > 0 &&
    Object.values(ExtensionType).includes(manifest.type as ExtensionType) &&
    typeof manifest.description === 'string' &&
    typeof manifest.author === 'string' &&
    typeof manifest.entry === 'string' &&
    manifest.entry.trim().length > 0 &&
    (manifest.defaultEnabled === undefined || typeof manifest.defaultEnabled === 'boolean') &&
    isOptionalString(manifest.icon) &&
    isOptionalString(manifest.homepage) &&
    isOptionalString(manifest.onlyOne) &&
    isOptionalString(manifest.readme) &&
    (manifest.dependencies === undefined ||
      (Array.isArray(manifest.dependencies) &&
        manifest.dependencies.every(dependency => typeof dependency === 'string'))) &&
    (manifest.files === undefined ||
      (Array.isArray(manifest.files) &&
        manifest.files.every(file => typeof file === 'string' && file.trim().length > 0))) &&
    (manifest.packGroup === undefined ||
      (manifest.packGroup !== null &&
        typeof manifest.packGroup === 'object' &&
        !Array.isArray(manifest.packGroup) &&
        typeof (manifest.packGroup as Record<string, unknown>).id === 'string' &&
        typeof (manifest.packGroup as Record<string, unknown>).name === 'string')) &&
    isValidMetadata(manifest.metadata)
  );
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string';
}

function isValidMetadata(value: unknown): boolean {
  if (value === undefined) return true;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const metadata = value as Record<string, unknown>;
  return (
    typeof metadata.publishedAt === 'string' &&
    (metadata.updatedAt === undefined || typeof metadata.updatedAt === 'string') &&
    (metadata.downloads === undefined || typeof metadata.downloads === 'number') &&
    (metadata.tags === undefined ||
      (Array.isArray(metadata.tags) && metadata.tags.every(tag => typeof tag === 'string')))
  );
}

/**
 * 拡張機能のファイルを取得
 */
export async function fetchExtensionFile(
  manifest: ExtensionManifest,
  filePath: string,
  textOnly = false
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

    const bytes = new Uint8Array(await response.arrayBuffer());
    if (textOnly) return new TextDecoder('utf-8', { fatal: true }).decode(bytes);

    const content = await detectFileContent(filePath, bytes);
    if (content.kind === 'binary') {
      return toDataUrlFromUint8(bytes, filePath, content.mimeType);
    }
    return content.content;
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
    if (!isExtensionManifest(manifest)) {
      extensionError('Invalid extension manifest');
      return null;
    }
    extensionInfo(`Fetching extension code for: ${manifest.id}`);
    // エントリーポイントを取得
    const entryCode = await fetchExtensionFile(manifest, manifest.entry, true);
    if (entryCode === null) {
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
          if (code === null) {
            throw new Error(`Failed to load declared extension file: ${filePath}`);
          }
          files[filePath] = code;
          extensionInfo(`Loaded additional file: ${filePath}`);
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
  context: ExtensionContext,
  entryPath = 'index.js'
): Promise<ExtensionExports | null> {
  try {
    extensionInfo('Loading extension module');

    // Reactが利用可能か確認
    if (typeof window !== 'undefined' && !window.__PYXIS_REACT__) {
      extensionError(
        'React is not available in global scope. Ensure ExtensionManager.initialize() has been called before loading extensions.'
      );
      return null;
    }

    // Blob URLs stay alive while the extension is active because dynamic imports
    // may be evaluated after the entry module has loaded.
    const blobUrls: string[] = [];
    let loaded = false;

    try {
      const graph = buildExtensionModuleGraph(entryCode, additionalFiles, entryPath);
      blobUrls.push(...graph.blobUrls);
      const { entryUrl } = graph;

      // Dynamic importでモジュールをロード
      let module: ExtensionExports;
      try {
        module = await import(/* @vite-ignore */ entryUrl);
      } catch (err) {
        console.error('[ExtensionLoader] Failed to import entryUrl', entryUrl, err);
        throw err;
      }

      // activate関数の存在を確認
      if (typeof module.activate !== 'function') {
        extensionError('Extension must export an activate function');
        console.error('[ExtensionLoader] Module keys:', Object.keys(module));
        return null;
      }

      extensionInfo('Extension module loaded successfully');
      loaded = true;
      let disposed = false;
      const revokeModuleUrls = () => {
        if (disposed) return;
        disposed = true;
        blobUrls.forEach(url => {
          URL.revokeObjectURL(url);
        });
      };
      return {
        ...module,
        deactivate: async () => {
          try {
            await module.deactivate?.();
          } finally {
            revokeModuleUrls();
          }
        },
      } as ExtensionExports;
    } finally {
      if (!loaded) {
        blobUrls.forEach(url => {
          URL.revokeObjectURL(url);
        });
      }
    }
  } catch (error) {
    extensionError('Error loading extension module:', error);
    return null;
  }
}

function normalizeModulePath(path: string): string {
  const parts: string[] = [];
  for (const part of path.replaceAll('\\', '/').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return parts.join('/');
}

export function buildExtensionModuleGraph(
  entryCode: string,
  additionalFiles: Record<string, string | Blob>,
  entryPath: string,
  createUrl: (blob: Blob) => string = blob => URL.createObjectURL(blob),
  revokeUrl: (url: string) => void = url => URL.revokeObjectURL(url)
): { entryUrl: string; blobUrls: string[] } {
  const sourceFiles = new Map<string, string>();
  for (const [path, source] of Object.entries(additionalFiles)) {
    if (typeof source === 'string' && !source.startsWith('data:')) {
      sourceFiles.set(normalizeModulePath(path), source);
    }
  }
  const entryModulePath = normalizeModulePath(entryPath);
  sourceFiles.set(entryModulePath, entryCode);
  const moduleUrls = new Map<string, string>();
  const blobUrls: string[] = [];
  const building = new Set<string>();
  const resolveModule = (from: string, specifier: string): string => {
    const base = normalizeModulePath(`${from.slice(0, from.lastIndexOf('/') + 1)}${specifier}`);
    const candidates = [
      base,
      ...['.js', '.mjs', '.ts', '.tsx'].map(ext => `${base}${ext}`),
      ...['index.js', 'index.mjs', 'index.ts', 'index.tsx'].map(name => `${base}/${name}`),
    ];
    const resolved = candidates.find(candidate => sourceFiles.has(candidate));
    if (!resolved) throw new Error(`Extension import is missing from manifest.files: ${specifier}`);
    return resolved;
  };
  const buildModule = (path: string): string => {
    const cachedUrl = moduleUrls.get(path);
    if (cachedUrl) return cachedUrl;
    if (building.has(path)) throw new Error(`Circular extension module dependency: ${path}`);
    building.add(path);
    const source = sourceFiles.get(path);
    if (source === undefined) throw new Error(`Extension module not found: ${path}`);
    const processed = rewriteExtensionModuleImports(source, specifier => {
      if (!specifier.startsWith('.')) return specifier;
      return buildModule(resolveModule(path, specifier));
    });
    const url = createUrl(new Blob([processed], { type: 'application/javascript' }));
    blobUrls.push(url);
    moduleUrls.set(path, url);
    building.delete(path);
    return url;
  };
  try {
    return { entryUrl: buildModule(entryModulePath), blobUrls };
  } catch (error) {
    blobUrls.forEach(revokeUrl);
    throw error;
  }
}

export function rewriteExtensionModuleImports(
  source: string,
  resolve: (specifier: string) => string
): string {
  const replacements: Array<{ from: number; to: number; text: string }> = [];
  parser
    .parse(source)
    .topNode.cursor()
    .iterate(node => {
      if (
        node.name !== 'ImportDeclaration' &&
        node.name !== 'ExportDeclaration' &&
        node.name !== 'DynamicImport'
      )
        return;
      const literal = node.node.getChild('String') ?? node.node.getChild('TemplateString');
      if (!literal || (literal.name === 'TemplateString' && literal.getChild('Interpolation')))
        return;
      const raw = source.slice(literal.from, literal.to);
      const specifier = decodeModuleSpecifier(raw);
      if (!specifier.startsWith('.')) return;
      const quote = raw[0] === '`' ? '"' : raw[0];
      replacements.push({
        from: literal.from,
        to: literal.to,
        text: `${quote}${resolve(specifier)}${quote}`,
      });
    });
  replacements.sort((left, right) => right.from - left.from);
  let rewritten = source;
  for (const replacement of replacements) {
    rewritten =
      rewritten.slice(0, replacement.from) + replacement.text + rewritten.slice(replacement.to);
  }
  return rewritten;
}

function decodeModuleSpecifier(literal: string): string {
  if (literal.includes('\\')) {
    throw new Error(`Escaped extension import specifiers are unsupported: ${literal}`);
  }
  return literal.slice(1, -1);
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
    } else {
      console.error('[ExtensionLoader] Activation error (non-Error object):', error);
    }
    // contextやexportsの情報も出力
    try {
      console.error('[ExtensionLoader] context:', context);
      console.error('[ExtensionLoader] exports keys:', Object.keys(exports));
    } catch {}
    return null;
  }
}

/**
 * 拡張機能をデアクティベート
 */
export async function deactivateExtension(exports: ExtensionExports): Promise<boolean> {
  try {
    if (exports.deactivate) {
      extensionInfo('Deactivating extension');
      await exports.deactivate();
      extensionInfo('Extension deactivated successfully');
    }
    return true;
  } catch (error) {
    extensionError('Error deactivating extension:', error);
    return false;
  }
}
