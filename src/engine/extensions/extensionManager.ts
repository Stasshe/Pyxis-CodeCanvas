/**
 * Extension Manager
 * 拡張機能のライフサイクルを統合管理
 */

import {
  fetchExtensionManifest,
  fetchExtensionCode,
  loadExtensionModule,
  activateExtension,
  deactivateExtension,
} from './extensionLoader';
import {
  saveInstalledExtension,
  loadInstalledExtension,
  loadAllInstalledExtensions,
  deleteInstalledExtension,
} from './storage-adapter';
import type { SystemModuleName, SystemModuleMap } from './systemModuleTypes';
import {
  ExtensionStatus,
  type ExtensionManifest,
  type InstalledExtension,
  type ExtensionExports,
  type ExtensionContext,
  type ExtensionActivation,
} from './types';

/**
 * アクティブな拡張機能のキャッシュ
 */
interface ActiveExtension {
  manifest: ExtensionManifest;
  exports: ExtensionExports;
  activation: ExtensionActivation;
}

/**
 * 拡張機能の変更イベント
 */
export type ExtensionChangeEvent = {
  type: 'enabled' | 'disabled' | 'installed' | 'uninstalled';
  extensionId: string;
  manifest?: ExtensionManifest;
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
      (window as any).__PYXIS_REACT__ = React;
      (window as any).__PYXIS_REACT_DOM__ = ReactDOM;
      console.log('[ExtensionManager] React and ReactDOM provided globally for extensions');
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
      await this.enableExtension(manifest.id);

      return installed;
    } catch (error) {
      console.error('[ExtensionManager] Failed to install extension:', error);
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

      // 動的にJSZipをロード（ブラウザ向けに既に package.json に含まれている）
      const JSZipModule = await import('jszip');
      const JSZip = (JSZipModule as any).default || JSZipModule;

      const zip = await JSZip.loadAsync(file);

      // manifest.json を探す: まずルートの manifest.json を優先
      let manifestPath: string | null = null;
      if (zip.file('manifest.json')) {
        manifestPath = 'manifest.json';
      } else {
        // ルート以外を探す（最初に見つかった manifest.json を使う）
        zip.forEach((relativePath: string) => {
          if (!manifestPath && relativePath.toLowerCase().endsWith('manifest.json')) {
            manifestPath = relativePath;
          }
        });
      }

      if (!manifestPath) {
        throw new Error('manifest.json not found inside ZIP');
      }

      const manifestText = await zip.file(manifestPath)!.async('string');
      const manifest = JSON.parse(manifestText) as any;

      if (!manifest || !manifest.id) {
        throw new Error('Invalid manifest.json: missing id');
      }

      // manifest.entry が無ければデフォルトを使う
      if (!manifest.entry) manifest.entry = 'index.js';

      // manifestPath のディレクトリを求め、ファイルの相対パスを正規化する
      const lastSlash = manifestPath.lastIndexOf('/');
      const manifestDir = lastSlash === -1 ? '' : manifestPath.slice(0, lastSlash);

      // ヘルパー: 与えられた candidate パスから zip 内で実在するものを返す
      const resolveZipPath = (candidatePaths: string[]) => {
        for (const p of candidatePaths) {
          const normalized = p.replace(/^\.\//, '');
          // try with and without manifestDir prefix
          if (zip.file(normalized)) return normalized;
          if (manifestDir && zip.file(`${manifestDir}/${normalized}`))
            return `${manifestDir}/${normalized}`;
        }
        return null;
      };

      const entryCandidates = [
        manifest.entry,
        `./${manifest.entry}`,
        manifest.entry.replace(/^\//, ''),
      ];
      const resolvedEntryPath = resolveZipPath(entryCandidates);
      if (!resolvedEntryPath) {
        throw new Error(`Entry file not found in ZIP: ${manifest.entry}`);
      }

      // エントリのコードを読み込む
      const entryCode = await zip.file(resolvedEntryPath)!.async('string');

      // manifest.entry を extension root 相対（manifestDir を削った形）に更新
      let normalizedEntry = resolvedEntryPath;
      if (manifestDir && normalizedEntry.startsWith(`${manifestDir}/`)) {
        normalizedEntry = normalizedEntry.slice(manifestDir.length + 1);
      }
      manifest.entry = normalizedEntry;

      // 追加ファイルは manifest.files に基づいて読み込む（extensionLoader.fetchExtensionCode と同じ挙動）
      const filesMap: Record<string, string> = {};
      if (manifest.files && manifest.files.length > 0) {
        for (const filePath of manifest.files) {
          const candidates = [filePath, `./${filePath}`, filePath.replace(/^\//, '')];
          const resolved = resolveZipPath(candidates);
          if (!resolved) {
            // 個別ファイルが見つからない場合は警告して続行（fetchExtensionCode に合わせる）
            console.warn(
              `[ExtensionManager] File listed in manifest.files not found in ZIP (skipping): ${filePath}`
            );
            continue;
          }

          // decide whether to read as binary based on extension (use shared util)
          const { isBinaryExt, toDataUrlFromUint8 } = await import('./binaryUtils');
          if (isBinaryExt(filePath)) {
            const uint8 = await zip.file(resolved)!.async('uint8array');
            const dataUrl = toDataUrlFromUint8(uint8, filePath);
            const normalizedKey = filePath.replace(/^\.\//, '').replace(/^\//, '');
            filesMap[normalizedKey] = dataUrl;
          } else {
            const content = await zip.file(resolved)!.async('string');
            const normalizedKey = filePath.replace(/^\.\//, '').replace(/^\//, '');
            filesMap[normalizedKey] = content;
          }
        }

        // manifest.files が宣言されているのに一つもロードできなければエラー
        if (Object.keys(filesMap).length === 0) {
          throw new Error('manifest.files declared but no matching files found inside ZIP');
        }
      }

      // インストール情報を作成
      const installed: InstalledExtension = {
        manifest,
        status: ExtensionStatus.INSTALLED,
        installedAt: Date.now(),
        updatedAt: Date.now(),
        enabled: false,
        cache: {
          entryCode,
          files: Object.keys(filesMap).length > 0 ? filesMap : undefined,
          cachedAt: Date.now(),
        },
      };

      // IndexedDB に保存
      await saveInstalledExtension(installed);

      // 自動有効化を試みる
      try {
        await this.enableExtension(manifest.id);
      } catch (err) {
        console.warn('[ExtensionManager] Failed to auto-enable extension from ZIP:', err);
      }

      return installed;
    } catch (error) {
      console.error('[ExtensionManager] Failed to install extension from ZIP:', error);
      return null;
    }
  }

  /**
   * 拡張機能を有効化
   */
  async enableExtension(extensionId: string): Promise<boolean> {
    try {
      console.log('[ExtensionManager] Enabling extension:', extensionId);

      // 既に有効化されているかチェック
      if (this.activeExtensions.has(extensionId)) {
        console.log('[ExtensionManager] Extension already enabled:', extensionId);
        return true;
      }

      // インストール済み拡張を取得
      const installed = await loadInstalledExtension(extensionId);
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

        // 競合する拡張機能を無効化
        for (const conflict of conflictingExtensions) {
          console.log(
            `[ExtensionManager] Disabling conflicting extension: ${conflict.manifest.id}`
          );
          await this.disableExtension(conflict.manifest.id);
        }
      }

      // コンテキストを作成
      const context = await this.createExtensionContext(extensionId);

      // モジュールをロード（追加ファイルも渡す）
      const exports = await loadExtensionModule(
        installed.cache.entryCode,
        installed.cache.files || {},
        context
      );
      if (!exports) {
        throw new Error('Failed to load extension module');
      }

      // アクティベート
      const activation = await activateExtension(exports, context);
      if (!activation) {
        throw new Error('Failed to activate extension');
      }

      // アクティブリストに追加（contextも保存）
      this.activeExtensions.set(extensionId, {
        manifest: installed.manifest,
        exports,
        activation,
        _context: context,
      } as any);

      // 状態を更新
      installed.enabled = true;
      installed.status = ExtensionStatus.ENABLED;
      installed.updatedAt = Date.now();
      await saveInstalledExtension(installed);

      // 変更イベントを発火
      this.emitChange({
        type: 'enabled',
        extensionId,
        manifest: installed.manifest,
      });

      console.log('[ExtensionManager] Extension enabled:', extensionId);
      return true;
    } catch (error) {
      console.error('[ExtensionManager] Failed to enable extension:', extensionId, error);
      return false;
    }
  }

  /**
   * 拡張機能を無効化
   */
  async disableExtension(extensionId: string): Promise<boolean> {
    try {
      console.log('[ExtensionManager] Disabling extension:', extensionId);

      const active = this.activeExtensions.get(extensionId);
      if (!active) {
        console.log('[ExtensionManager] Extension not enabled:', extensionId);
        return false;
      }

      // TabAPIとSidebarAPIをクリーンアップ
      const context = (active as any)._context;
      if (context) {
        if ((context as any)._tabAPI) {
          (context as any)._tabAPI.dispose();
        }
        if ((context as any)._sidebarAPI) {
          (context as any)._sidebarAPI.dispose();
        }
      }

      // コマンドをクリーンアップ
      const { commandRegistry } = await import('./commandRegistry');
      commandRegistry.unregisterExtensionCommands(extensionId);

      // デアクティベート
      await deactivateExtension(active.exports);

      // アクティブリストから削除
      this.activeExtensions.delete(extensionId);

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
      console.log('[ExtensionManager] Uninstalling extension:', extensionId);

      // マニフェストを保存しておく（イベント発火用）
      const installed = await loadInstalledExtension(extensionId);
      const manifest = installed?.manifest;

      // 有効化されている場合は無効化
      if (this.activeExtensions.has(extensionId)) {
        await this.disableExtension(extensionId);
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
      if (active.activation.services && active.activation.services['language-pack']) {
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
  private async createExtensionContext(extensionId: string): Promise<ExtensionContext> {
    // TabAPIとSidebarAPIのインスタンスを作成
    const { TabAPI } = await import('./system-api/TabAPI');
    const { SidebarAPI } = await import('./system-api/SidebarAPI');

    const context: ExtensionContext = {
      extensionId,
      extensionPath: `/extensions/${extensionId.replace(/\./g, '/')}`,
      version: '1.0.0',
      logger: {
        info: (...args: unknown[]) => console.log(`[${extensionId}]`, ...args),
        warn: (...args: unknown[]) => console.warn(`[${extensionId}]`, ...args),
        error: (...args: unknown[]) => console.error(`[${extensionId}]`, ...args),
      },
      getSystemModule: async <T extends SystemModuleName>(
        moduleName: T
      ): Promise<SystemModuleMap[T]> => {
        // システムモジュールへのアクセスを提供（型安全）
        switch (moduleName) {
          case 'fileRepository': {
            const { fileRepository } = await import('@/engine/core/fileRepository');
            return fileRepository as SystemModuleMap[T];
          }
          case 'normalizeCjsEsm': {
            const module = await import('@/engine/runtime/normalizeCjsEsm');
            return module as SystemModuleMap[T];
          }
          case 'commandRegistry': {
            const { commandRegistry } = await import('./commandRegistry');
            return commandRegistry as SystemModuleMap[T];
          }
          default: {
            // TypeScriptの網羅性チェック用の変数
            // 実行時には到達しないが、型エラーメッセージを改善するために使用
            const exhaustiveCheck: never = moduleName;
            // 実際のエラーメッセージでは元のmoduleNameを文字列として出力
            throw new Error(`System module not found: ${String(moduleName)}`);
          }
        }
      },
    };

    // TabAPIとSidebarAPIを初期化して追加
    const tabAPI = new TabAPI(context);
    const sidebarAPI = new SidebarAPI(context);

    context.tabs = {
      registerTabType: (component: any) => tabAPI.registerTabType(component),
      createTab: (options: any) => tabAPI.createTab(options),
      updateTab: (tabId: string, options: any) => tabAPI.updateTab(tabId, options),
      closeTab: (tabId: string) => tabAPI.closeTab(tabId),
      onTabClose: (tabId: string, callback: any) => tabAPI.onTabClose(tabId, callback),
      getTabData: (tabId: string) => tabAPI.getTabData(tabId),
      openSystemTab: (file: any, options?: any) => tabAPI.openSystemTab(file, options),
    };

    context.sidebar = {
      createPanel: (definition: any) => sidebarAPI.createPanel(definition),
      updatePanel: (panelId: string, state: any) => sidebarAPI.updatePanel(panelId, state),
      removePanel: (panelId: string) => sidebarAPI.removePanel(panelId),
      onPanelActivate: (panelId: string, callback: any) =>
        sidebarAPI.onPanelActivate(panelId, callback),
    };

    // Commands APIを追加
    const { commandRegistry } = await import('./commandRegistry');
    context.commands = {
      registerCommand: (commandName: string, handler: any) => {
        // ハンドラーをラップして、ExtensionContextを含むCommandContextを作成
        const wrappedHandler = async (args: string[], cmdContext: any) => {
          // ExtensionContext全体をCommandContextとしてマージ
          const fullContext = {
            ...context, // ExtensionContext全体（getSystemModule, logger等を含む）
            ...cmdContext, // Terminal側から渡されるプロジェクト情報
          };
          return handler(args, fullContext);
        };
        return commandRegistry.registerCommand(extensionId, commandName, wrappedHandler);
      },
    };

    // APIインスタンスを保存（dispose用）
    (context as any)._tabAPI = tabAPI;
    (context as any)._sidebarAPI = sidebarAPI;

    return context;
  }
}

/**
 * グローバルインスタンス
 */
export const extensionManager = new ExtensionManager();
