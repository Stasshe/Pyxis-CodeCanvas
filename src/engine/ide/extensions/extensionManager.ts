/**
 * Extension Manager
 * 拡張機能のライフサイクルを統合管理
 */

import { fsClient } from '@/engine/core/fs/client';
import type { TranspilerDescriptor } from '@/engine/core/fs/types';
import { loadExtensionArchive } from './archiveLoader';
import { createExtensionContext, type ExtensionAPIs } from './extensionContext';
import {
  activateExtension,
  deactivateExtension,
  fetchExtensionCode,
  fetchExtensionManifest,
  loadExtensionModule,
} from './extensionLoader';
import { defaultOrNamespace } from './hostGlobals';
import {
  deleteInstalledExtension,
  loadAllInstalledExtensions,
  loadInstalledExtension,
  saveInstalledExtension,
} from './storage-adapter';
import {
  type ExtensionActivation,
  type ExtensionContext,
  type ExtensionExports,
  type ExtensionManifest,
  ExtensionStatus,
  type InstalledExtension,
} from './types';

/**
 * アクティブな拡張機能のキャッシュ
 */
interface ActiveExtension {
  manifest: ExtensionManifest;
  exports: ExtensionExports;
  activation: ExtensionActivation;
  context: ExtensionContext;
}

/**
 * 拡張機能の変更イベント
 */
export type ExtensionChangeEvent = {
  type: 'enabled' | 'disabled' | 'installed' | 'uninstalled';
  extensionId: string;
  manifest?: ExtensionManifest;
  replacementExtensionId?: string;
};

type ExtensionChangeListener = (event: ExtensionChangeEvent) => void;

/**
 * Extension Manager
 */
class ExtensionManager {
  /** アクティブな拡張機能 (extensionId -> ActiveExtension) */
  private activeExtensions: Map<string, ActiveExtension> = new Map();

  /** 初期化済みフラグ */
  private initialized = false;

  /** 変更イベントリスナー */
  private changeListeners: Set<ExtensionChangeListener> = new Set();
  private transpilerIdsByExtension = new Map<string, Set<string>>();
  private runtimeIdsByExtension = new Map<string, Set<string>>();
  private apisByContext = new WeakMap<ExtensionContext, ExtensionAPIs>();
  private lifecycleLocks = new Map<string, Promise<void>>();

  /**
   * 変更イベントリスナーを登録
   */
  addChangeListener(listener: ExtensionChangeListener): () => void {
    this.changeListeners.add(listener);
    // アンサブスクライブ関数を返す
    return () => this.changeListeners.delete(listener);
  }

  /**
   * 変更イベントを発火
   */
  private emitChange(event: ExtensionChangeEvent): void {
    this.changeListeners.forEach(listener => {
      try {
        listener(event);
      } catch (error) {
        console.error('[ExtensionManager] Error in change listener:', error);
      }
    });
  }

  private async configureRuntimeTranspilers(
    registry: typeof import('@/engine/system/runtime/core/RuntimeRegistry').runtimeRegistry
  ): Promise<void> {
    await fsClient.configureTranspilers(registry.getAllTranspilers());
  }

  /**
   * 初期化
   */
  async init(): Promise<void> {
    if (this.initialized) return;

    console.log('[ExtensionManager] Initializing...');

    // Reactをグローバルに提供（拡張機能から使えるように）
    if (typeof window !== 'undefined') {
      const React = await import('react');
      const ReactDOM = await import('react-dom');
      const ReactDomClient = await import('react-dom/client');
      window.__PYXIS_REACT__ = React;
      window.__PYXIS_REACT_DOM__ = { ...ReactDOM, ...ReactDomClient };
      console.log('[ExtensionManager] React and ReactDOM provided globally for extensions');
      // Provide Markdown/math rendering libraries on the host so extensions
      // don't need to bundle heavy unified/rehype ecosystems into blob modules.
      try {
        const ReactMarkdownModule = await import('react-markdown');
        const remarkGfmModule = await import('remark-gfm');
        const remarkMathModule = await import('remark-math');
        const rehypeKatexModule = await import('rehype-katex');
        const rehypeRawModule = await import('rehype-raw');
        const katexModule = await import('katex');

        window.__PYXIS_MARKDOWN__ = {
          ReactMarkdown: defaultOrNamespace(ReactMarkdownModule),
          remarkGfm: defaultOrNamespace(remarkGfmModule),
          remarkMath: defaultOrNamespace(remarkMathModule),
          rehypeKatex: defaultOrNamespace(rehypeKatexModule),
          rehypeRaw: defaultOrNamespace(rehypeRawModule),
          katex: defaultOrNamespace(katexModule),
        };
        console.log('[ExtensionManager] Markdown/math libraries provided globally for extensions');
      } catch (err) {
        console.warn('[ExtensionManager] Failed to provide markdown/math libraries globally:', err);
      }
    }

    // インストール済み & 有効化済みの拡張機能を読み込み
    const installed = await loadAllInstalledExtensions();
    const enabled = installed.filter(ext => ext.enabled);

    for (const ext of enabled) {
      try {
        await this.enableExtension(ext.manifest.id);
      } catch (error) {
        console.error(`[ExtensionManager] Failed to enable extension: ${ext.manifest.id}`, error);
      }
    }

    this.initialized = true;
    console.log(`[ExtensionManager] Initialized with ${this.activeExtensions.size} extensions`);
  }

  /**
   * 拡張機能をインストール
   */
  async installExtension(manifestUrl: string): Promise<InstalledExtension | null> {
    try {
      console.log('[ExtensionManager] Installing extension:', manifestUrl);

      // マニフェストを取得
      const manifest = await fetchExtensionManifest(manifestUrl);
      if (!manifest) {
        throw new Error('Failed to fetch manifest');
      }

      // 既にインストール済みかチェック
      const existing = await loadInstalledExtension(manifest.id);
      if (existing) {
        console.log('[ExtensionManager] Extension already installed:', manifest.id);
        return existing;
      }

      // 依存関係をチェック & 自動インストール
      if (manifest.dependencies && manifest.dependencies.length > 0) {
        for (const depId of manifest.dependencies) {
          const dep = await loadInstalledExtension(depId);
          if (!dep) {
            console.warn(
              `[ExtensionManager] Dependency not found: ${depId}. Please install it first.`
            );
          }
        }
      }

      // コードを取得
      const code = await fetchExtensionCode(manifest);
      if (!code) {
        throw new Error('Failed to fetch extension code');
      }

      // インストール情報を作成
      const installed: InstalledExtension = {
        manifest,
        status: ExtensionStatus.INSTALLED,
        installedAt: Date.now(),
        updatedAt: Date.now(),
        enabled: false,
        cache: {
          entryCode: code.entryCode,
          files: code.files,
          cachedAt: Date.now(),
        },
      };

      // IndexedDBに保存
      await saveInstalledExtension(installed);
      // 自動有効化
      if (!(await this.enableExtension(manifest.id))) return null;

      return installed;
    } catch (error) {
      console.error('[ExtensionManager] Failed to install extension:', error);
      return null;
    }
  }

  /** Replace an installed extension only after its complete package has been fetched. */
  async updateExtension(
    extensionId: string,
    manifestUrl: string
  ): Promise<InstalledExtension | null> {
    try {
      const manifest = await fetchExtensionManifest(manifestUrl);
      if (!manifest || manifest.id !== extensionId) return null;

      const code = await fetchExtensionCode(manifest);
      if (!code) return null;
      return await this.installOrReplacePackage(
        manifest,
        { entryCode: code.entryCode, files: code.files, cachedAt: Date.now() },
        { createIfMissing: false, enableReplacement: false }
      );
    } catch (error) {
      console.error(`[ExtensionManager] Failed to update extension: ${extensionId}`, error);
      return null;
    }
  }

  /**
   * ローカルのZIPファイルから拡張機能をインストール
   * - manifest.json が必須
   * - ZIP内のファイル構成はトップレベルフォルダを含む場合があるため、manifest.json の位置を基準に相対パスを正規化して保存する
   */
  async installExtensionFromZip(file: File | Blob): Promise<InstalledExtension | null> {
    try {
      console.log('[ExtensionManager] Installing extension from ZIP');
      const archive = await loadExtensionArchive(file);
      return await this.installOrReplacePackage(
        archive.manifest,
        { entryCode: archive.entryCode, files: archive.files, cachedAt: Date.now() },
        { createIfMissing: true, enableReplacement: true }
      );
    } catch (error) {
      console.error('[ExtensionManager] Failed to install extension from ZIP:', error);
      return null;
    }
  }

  private async installOrReplacePackage(
    manifest: ExtensionManifest,
    cache: InstalledExtension['cache'],
    options: { createIfMissing: boolean; enableReplacement: boolean }
  ): Promise<InstalledExtension | null> {
    return this.withLifecycleLock(
      manifest.id,
      async () => {
        const previous = await loadInstalledExtension(manifest.id);
        if (!previous) {
          if (!options.createIfMissing) return null;
          const installed: InstalledExtension = {
            manifest,
            status: ExtensionStatus.INSTALLED,
            installedAt: Date.now(),
            updatedAt: Date.now(),
            enabled: false,
            cache,
          };
          await saveInstalledExtension(installed);
          if (!(await this.enableExtensionUnlocked(manifest.id))) return null;
          return (await loadInstalledExtension(manifest.id)) ?? installed;
        }

        const wasActive = this.activeExtensions.has(manifest.id);
        const replacement: InstalledExtension = {
          ...previous,
          manifest,
          status: ExtensionStatus.INSTALLED,
          enabled: false,
          updatedAt: Date.now(),
          cache,
        };
        const shouldEnable = options.enableReplacement || previous.enabled || wasActive;

        try {
          if (
            wasActive &&
            !(await this.disableExtensionUnlocked(
              manifest.id,
              shouldEnable ? manifest.id : undefined
            ))
          ) {
            throw new Error('Failed to disable the existing extension');
          }
          await saveInstalledExtension(replacement);
          if (!shouldEnable) return replacement;
          if (await this.enableExtensionUnlocked(manifest.id)) {
            return (await loadInstalledExtension(manifest.id)) ?? replacement;
          }
        } catch (error) {
          console.error(`[ExtensionManager] Package replacement failed: ${manifest.id}`, error);
        }

        try {
          await saveInstalledExtension(previous);
          if (wasActive || previous.enabled) {
            const restored = await this.enableExtensionUnlocked(manifest.id);
            if (!restored) {
              previous.enabled = false;
              previous.status = ExtensionStatus.INSTALLED;
              previous.updatedAt = Date.now();
              await saveInstalledExtension(previous);
              console.error(
                `[ExtensionManager] Restored package remains disabled after activation failure: ${manifest.id}`
              );
            }
          }
        } catch (error) {
          console.error(`[ExtensionManager] Failed to restore extension: ${manifest.id}`, error);
        }
        return null;
      },
      manifest.onlyOne
    );
  }

  /**
   * 拡張機能を有効化
   */
  async enableExtension(extensionId: string): Promise<boolean> {
    try {
      return await this.withLifecycleLock(extensionId, () =>
        this.enableExtensionUnlocked(extensionId)
      );
    } catch (error) {
      console.error(
        '[ExtensionManager] Failed to inspect extension before enabling:',
        extensionId,
        error
      );
      return false;
    }
  }

  private async withLifecycleLock<T>(
    extensionId: string,
    operation: () => Promise<T>,
    additionalGroup?: string
  ): Promise<T> {
    const active = this.activeExtensions.get(extensionId);
    const installed = active ? null : await loadInstalledExtension(extensionId);
    const onlyOne = active?.manifest.onlyOne ?? installed?.manifest.onlyOne;
    const lockKeys = [onlyOne ? `onlyOne:${onlyOne}` : `extension:${extensionId}`];
    if (additionalGroup) lockKeys.push(`onlyOne:${additionalGroup}`);
    const uniqueLockKeys = [...new Set(lockKeys)].sort();
    let releaseLock = () => {};
    const currentLock = new Promise<void>(resolve => {
      releaseLock = resolve;
    });
    const previousLocks = uniqueLockKeys
      .map(lockKey => this.lifecycleLocks.get(lockKey))
      .filter((lock): lock is Promise<void> => lock !== undefined);
    for (const lockKey of uniqueLockKeys) this.lifecycleLocks.set(lockKey, currentLock);
    await Promise.all(previousLocks);

    try {
      return await operation();
    } finally {
      releaseLock();
      for (const lockKey of uniqueLockKeys) {
        if (this.lifecycleLocks.get(lockKey) === currentLock) this.lifecycleLocks.delete(lockKey);
      }
    }
  }

  private async enableExtensionUnlocked(extensionId: string): Promise<boolean> {
    let context: ExtensionContext | undefined;
    let conflictingIds: string[] = [];
    let exports: ExtensionExports | undefined;
    let installed: InstalledExtension | null = null;
    try {
      console.log('[ExtensionManager] Enabling extension:', extensionId);

      // 既に有効化されているかチェック
      if (this.activeExtensions.has(extensionId)) {
        console.log('[ExtensionManager] Extension already enabled:', extensionId);
        return true;
      }

      // インストール済み拡張を取得
      installed = await loadInstalledExtension(extensionId);
      if (!installed) {
        throw new Error('Extension not installed');
      }

      // onlyOneグループのチェック: 同じグループの他の拡張機能を無効化
      if (installed.manifest.onlyOne) {
        const group = installed.manifest.onlyOne;
        console.log(
          `[ExtensionManager] onlyOne group detected: ${group}. Checking for conflicts...`
        );

        // 同じグループで有効化されている拡張機能を探す
        const allInstalled = await loadAllInstalledExtensions();
        const conflictingExtensions = allInstalled.filter(
          ext => ext.manifest?.onlyOne === group && ext.enabled && ext.manifest?.id !== extensionId
        );
        conflictingIds = conflictingExtensions.map(extension => extension.manifest.id);

        // 競合する拡張機能を無効化
        for (const conflict of conflictingExtensions) {
          console.log(
            `[ExtensionManager] Disabling conflicting extension: ${conflict.manifest.id}`
          );
          const disabled = await this.disableExtensionUnlocked(conflict.manifest.id, extensionId);
          if (!disabled) {
            throw new Error(`Failed to disable conflicting extension: ${conflict.manifest.id}`);
          }
        }
      }

      // コンテキストを作成
      context = await this.createExtensionContext(installed.manifest);

      // モジュールをロード（追加ファイルも渡す）
      const loadedExports = await loadExtensionModule(
        installed.cache.entryCode,
        installed.cache.files || {},
        context,
        installed.manifest.entry
      );
      if (!loadedExports) {
        throw new Error('Failed to load extension module');
      }
      exports = loadedExports;

      // アクティベート
      const activation = await activateExtension(loadedExports, context);
      if (!activation) {
        throw new Error('Failed to activate extension');
      }

      // 状態を更新
      installed.enabled = true;
      installed.status = ExtensionStatus.ENABLED;
      installed.updatedAt = Date.now();
      await saveInstalledExtension(installed);

      // アクティブリストに追加（contextも保存）
      this.activeExtensions.set(extensionId, {
        manifest: installed.manifest,
        exports: loadedExports,
        activation,
        context,
      });

      // 変更イベントを発火
      this.emitChange({
        type: 'enabled',
        extensionId,
        manifest: installed.manifest,
      });

      console.log('[ExtensionManager] Extension enabled:', extensionId);
      return true;
    } catch (error) {
      if (context) {
        try {
          await this.cleanupExtensionContext(extensionId, context);
        } catch (cleanupError) {
          console.error(
            `[ExtensionManager] Failed to clean up extension: ${extensionId}`,
            cleanupError
          );
        }
      }
      if (exports) await deactivateExtension(exports);
      if (installed) {
        installed.enabled = false;
        installed.status = ExtensionStatus.INSTALLED;
        installed.updatedAt = Date.now();
        try {
          await saveInstalledExtension(installed);
        } catch (saveError) {
          console.error(
            `[ExtensionManager] Failed to persist disabled state after activation failure: ${extensionId}`,
            saveError
          );
        }
      }
      for (const conflictId of conflictingIds) {
        const restored = await this.enableExtensionUnlocked(conflictId);
        if (!restored) {
          console.error(
            `[ExtensionManager] Failed to restore conflicting extension: ${conflictId}`
          );
        }
      }
      console.error('[ExtensionManager] Failed to enable extension:', extensionId, error);
      return false;
    }
  }

  /**
   * 拡張機能を無効化
   */
  async disableExtension(extensionId: string): Promise<boolean> {
    try {
      return await this.withLifecycleLock(extensionId, () =>
        this.disableExtensionUnlocked(extensionId)
      );
    } catch (error) {
      console.error('[ExtensionManager] Failed to disable extension:', extensionId, error);
      return false;
    }
  }

  private async disableExtensionUnlocked(
    extensionId: string,
    replacementExtensionId?: string
  ): Promise<boolean> {
    try {
      console.log('[ExtensionManager] Disabling extension:', extensionId);

      const active = this.activeExtensions.get(extensionId);
      if (!active) {
        console.log('[ExtensionManager] Extension not enabled:', extensionId);
        return false;
      }

      await this.cleanupExtensionContext(extensionId, active.context);

      // デアクティベート
      try {
        await deactivateExtension(active.exports);
      } catch (error) {
        console.error(`[ExtensionManager] Deactivation failed: ${extensionId}`, error);
      } finally {
        this.activeExtensions.delete(extensionId);
      }

      // 状態を更新
      const installed = await loadInstalledExtension(extensionId);
      if (installed) {
        installed.enabled = false;
        installed.status = ExtensionStatus.INSTALLED;
        installed.updatedAt = Date.now();
        await saveInstalledExtension(installed);

        // 変更イベントを発火
        this.emitChange({
          type: 'disabled',
          extensionId,
          manifest: installed.manifest,
          replacementExtensionId,
        });
      }

      console.log('[ExtensionManager] Extension disabled:', extensionId);
      return true;
    } catch (error) {
      console.error('[ExtensionManager] Failed to disable extension:', extensionId, error);
      return false;
    }
  }

  /**
   * 拡張機能をアンインストール
   */
  async uninstallExtension(extensionId: string): Promise<boolean> {
    try {
      return await this.withLifecycleLock(extensionId, () =>
        this.uninstallExtensionUnlocked(extensionId)
      );
    } catch (error) {
      console.error('[ExtensionManager] Failed to uninstall extension:', extensionId, error);
      return false;
    }
  }

  private async uninstallExtensionUnlocked(extensionId: string): Promise<boolean> {
    try {
      console.log('[ExtensionManager] Uninstalling extension:', extensionId);

      // マニフェストを保存しておく（イベント発火用）
      const installed = await loadInstalledExtension(extensionId);
      const manifest = installed?.manifest;

      // 有効化されている場合は無効化
      if (this.activeExtensions.has(extensionId)) {
        const disabled = await this.disableExtensionUnlocked(extensionId);
        if (!disabled && this.activeExtensions.has(extensionId)) return false;
      }

      // IndexedDBから削除
      await deleteInstalledExtension(extensionId);

      // 変更イベントを発火
      if (manifest) {
        this.emitChange({
          type: 'uninstalled',
          extensionId,
          manifest,
        });
      }

      console.log('[ExtensionManager] Extension uninstalled:', extensionId);
      return true;
    } catch (error) {
      console.error('[ExtensionManager] Failed to uninstall extension:', extensionId, error);
      return false;
    }
  }

  /**
   * インストール済み拡張機能のリストを取得
   */
  async getInstalledExtensions(): Promise<InstalledExtension[]> {
    return await loadAllInstalledExtensions();
  }

  /**
   * 有効化済み拡張機能のリストを取得
   */
  getActiveExtensions(): ActiveExtension[] {
    return Array.from(this.activeExtensions.values());
  }

  /**
   * 有効化されている全ての言語パックを取得
   */
  getEnabledLanguagePacks(): Array<{ locale: string; name: string; nativeName: string }> {
    const langPacks: Array<{ locale: string; name: string; nativeName: string }> = [];
    for (const active of this.activeExtensions.values()) {
      if (active.activation.services?.['language-pack']) {
        langPacks.push(
          active.activation.services['language-pack'] as {
            locale: string;
            name: string;
            nativeName: string;
          }
        );
      }
    }
    return langPacks;
  }

  /**
   * 全ての有効化済みビルトインモジュールを取得
   */
  getAllBuiltInModules(): Record<string, unknown> {
    const modules: Record<string, unknown> = {};

    for (const active of this.activeExtensions.values()) {
      if (active.activation.builtInModules) {
        Object.assign(modules, active.activation.builtInModules);
      }
    }

    return modules;
  }

  /**
   * ExtensionContextを作成
   */
  private async createExtensionContext(manifest: ExtensionManifest): Promise<ExtensionContext> {
    const { context, apis } = await createExtensionContext(manifest, {
      registerTranspiler: config => this.registerExtensionTranspiler(manifest.id, config),
      registerRuntime: config => this.registerExtensionRuntime(manifest.id, config),
    });
    this.apisByContext.set(context, apis);
    return context;
  }

  private async registerExtensionTranspiler(
    extensionId: string,
    config: TranspilerDescriptor
  ): Promise<void> {
    const { runtimeRegistry } = await import('@/engine/system/runtime/core/RuntimeRegistry');
    if (runtimeRegistry.getTranspiler(config.id)) {
      throw new Error(`Transpiler is already registered: ${config.id}`);
    }
    runtimeRegistry.registerTranspiler(config);
    let ids = this.transpilerIdsByExtension.get(extensionId);
    if (!ids) {
      ids = new Set();
      this.transpilerIdsByExtension.set(extensionId, ids);
    }
    ids.add(config.id);
    await this.configureRuntimeTranspilers(runtimeRegistry);
  }

  private async registerExtensionRuntime(
    extensionId: string,
    config: Parameters<NonNullable<ExtensionContext['registerRuntime']>>[0]
  ): Promise<void> {
    const { runtimeRegistry } = await import('@/engine/system/runtime/core/RuntimeRegistry');
    if (runtimeRegistry.getRuntime(config.id)) {
      throw new Error(`Runtime is already registered: ${config.id}`);
    }
    runtimeRegistry.registerRuntime({ ...config });
    let ids = this.runtimeIdsByExtension.get(extensionId);
    if (!ids) {
      ids = new Set();
      this.runtimeIdsByExtension.set(extensionId, ids);
    }
    ids.add(config.id);
  }

  private async cleanupExtensionContext(
    extensionId: string,
    context: ExtensionContext
  ): Promise<void> {
    const apis = this.apisByContext.get(context);
    apis?.disposeSubscriptions();
    await apis?.tabs.dispose();
    apis?.sidebar.dispose();
    apis?.explorerMenu.dispose();
    this.apisByContext.delete(context);

    const { commandRegistry } = await import('./commandRegistry');
    commandRegistry.unregisterExtensionCommands(extensionId);

    const transpilerIds = this.transpilerIdsByExtension.get(extensionId);
    if (transpilerIds) {
      const { runtimeRegistry } = await import('@/engine/system/runtime/core/RuntimeRegistry');
      for (const id of transpilerIds) runtimeRegistry.unregisterTranspiler(id);
      this.transpilerIdsByExtension.delete(extensionId);
      try {
        await this.configureRuntimeTranspilers(runtimeRegistry);
      } catch (error) {
        console.error(
          `[ExtensionManager] Failed to configure transpilers after cleanup: ${extensionId}`,
          error
        );
      }
    }

    const runtimeIds = this.runtimeIdsByExtension.get(extensionId);
    if (runtimeIds) {
      const { runtimeRegistry } = await import('@/engine/system/runtime/core/RuntimeRegistry');
      for (const id of runtimeIds) {
        const runtime = runtimeRegistry.getRuntime(id);
        try {
          await runtime?.dispose?.();
        } catch (error) {
          console.error(`[ExtensionManager] Failed to dispose runtime ${id}:`, error);
        }
        runtimeRegistry.unregisterRuntime(id);
      }
      this.runtimeIdsByExtension.delete(extensionId);
    }
  }
}

/**
 * グローバルインスタンス
 */
export const extensionManager = new ExtensionManager();
