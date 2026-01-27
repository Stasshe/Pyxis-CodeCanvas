/**
 * EditorMemoryManager - 統一的なエディターメモリ管理システム
 *
 * 責務:
 * 1. デバウンス保存の統一的な制御
 * 2. 外部変更（Git操作、AI適用）の検知と反映
 * 3. ファイルパスごとの保存状態管理
 * 4. DB（IndexedDB/fileRepository）への保存制御
 *
 * 設計方針（v2 - 再レンダリング最適化）:
 * - シングルトンパターンで全アプリケーションで1つのインスタンスを共有
 * - **コンテンツはcontentMapで保持** - tabStore.panesから分離して再レンダリングを防止
 * - metadataMap: パスごとのメタデータ（保存タイマー等）を保持
 * - tabStoreにはisDirtyのみ同期（contentは同期しない）
 * - fileRepositoryのイベントシステムを活用して変更を検知
 */

import type { FileChangeEvent } from '@/engine/core/fileRepository';
import { fileRepository, toAppPath } from '@/engine/core/fileRepository';
import { getCurrentProjectId } from '@/stores/projectStore';
import { useTabStore } from '@/stores/tabStore';

/**
 * メタデータエントリ - パスごとの保存状態を管理（コンテンツは保持しない）
 */
interface MetadataEntry {
  /** 最終更新時刻 */
  lastModified: number;
  /** 保存タイマーID */
  saveTimerId?: ReturnType<typeof setTimeout>;
}

/**
 * 変更リスナーの型
 */
type ContentChangeListener = (path: string, content: string, source: 'editor' | 'external') => void;

/**
 * 保存完了リスナーの型
 */
type SaveCompleteListener = (path: string, success: boolean, error?: Error) => void;

/**
 * EditorMemoryManagerのオプション
 */
interface EditorMemoryManagerOptions {
  /** デバウンス保存の待機時間（ミリ秒） */
  debounceMs: number;
}

const DEFAULT_OPTIONS: EditorMemoryManagerOptions = {
  debounceMs: 5000, // 5秒
};

/**
 * EditorMemoryManager - 統一的なエディターメモリ管理
 *
 * v2: コンテンツをcontentMapで保持し、tabStore.panesとは分離
 * これにより、キーストローク時にpanesが更新されず、page.tsxの再レンダリングを防止
 */
class EditorMemoryManager {
  private static instance: EditorMemoryManager | null = null;

  /** パスごとのコンテンツを保持（再レンダリング最適化のため分離） */
  private contentMap: Map<string, string> = new Map();

  /** パスごとのメタデータ（タイマー等） */
  private metadataMap: Map<string, MetadataEntry> = new Map();

  /** コンテンツ変更リスナー */
  private changeListeners: Set<ContentChangeListener> = new Set();

  /** 保存完了リスナー */
  private saveListeners: Set<SaveCompleteListener> = new Set();

  /** オプション設定 */
  private options: EditorMemoryManagerOptions;

  /** fileRepository変更リスナーの解除関数 */
  private unsubscribeFileRepository: (() => void) | null = null;

  /** 初期化済みフラグ */
  private initialized = false;

  /** 保存中のパスを追跡（自身の保存を無視するため） */
  private savingPaths: Set<string> = new Set();

  private constructor(options: Partial<EditorMemoryManagerOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * シングルトンインスタンスを取得
   */
  static getInstance(): EditorMemoryManager {
    if (!EditorMemoryManager.instance) {
      EditorMemoryManager.instance = new EditorMemoryManager();
    }
    return EditorMemoryManager.instance;
  }

  /**
   * 初期化 - fileRepositoryのイベントリスナーを登録
   */
  async init(): Promise<void> {
    if (this.initialized) return;

    await fileRepository.init();

    // fileRepositoryの変更イベントを購読
    this.unsubscribeFileRepository = fileRepository.addChangeListener(
      this.handleFileRepositoryChange.bind(this)
    );

    this.initialized = true;
    console.log('[EditorMemoryManager] Initialized');
  }

  /**
   * クリーンアップ
   */
  dispose(): void {
    // 全ての保存タイマーをクリア
    for (const entry of this.metadataMap.values()) {
      if (entry.saveTimerId) {
        clearTimeout(entry.saveTimerId);
      }
    }

    // fileRepositoryリスナーを解除
    if (this.unsubscribeFileRepository) {
      this.unsubscribeFileRepository();
      this.unsubscribeFileRepository = null;
    }

    // リスナーをクリア
    this.changeListeners.clear();
    this.saveListeners.clear();

    // コンテンツマップとメタデータマップをクリア
    this.contentMap.clear();
    this.metadataMap.clear();

    this.initialized = false;
    console.log('[EditorMemoryManager] Disposed');
  }

  // ==================== コンテンツ操作 ====================

  /**
   * パスに対応するコンテンツを取得（contentMapから取得）
   * @param path ファイルパス（AppPath形式）
   * @returns コンテンツ文字列、またはない場合はundefined
   */
  getContent(path: string): string | undefined {
    const normalizedPath = toAppPath(path);
    return this.contentMap.get(normalizedPath);
  }

  /**
   * パスに対応するコンテンツをセット（エディター編集時に呼び出し）
   * - tabStoreを直接更新（コンテンツの二重保持を避ける）
   * - デバウンス保存をスケジュール
   *
   * @param path ファイルパス
   * @param content 新しいコンテンツ
   * @param skipDebounce trueの場合、デバウンス保存をスキップ（即時保存用）
   */
  setContent(path: string, content: string, skipDebounce = false): void {
    const normalizedPath = toAppPath(path);

    // 既存のタイマーをクリア
    const existing = this.metadataMap.get(normalizedPath);
    if (existing?.saveTimerId) {
      clearTimeout(existing.saveTimerId);
    }

    // コンテンツをcontentMapに保存（tabStoreではなくここで保持）
    this.contentMap.set(normalizedPath, content);

    // メタデータを更新
    const entry: MetadataEntry = {
      lastModified: Date.now(),
    };
    this.metadataMap.set(normalizedPath, entry);

    // tabStoreのisDirtyのみを更新（contentは更新しない → panesの再レンダリング防止）
    this.syncDirtyFlagToTabStore(normalizedPath, true);

    // 変更リスナーに通知
    this.notifyChangeListeners(normalizedPath, content, 'editor');

    // デバウンス保存をスケジュール（skipDebounceでなければ）
    if (!skipDebounce) {
      this.scheduleSave(normalizedPath);
    }
  }

  /**
   * 即時保存を実行（Ctrl+S等で呼び出し）
   * - 保留中のデバウンスタイマーをキャンセル
   * - 即座にDBへ保存
   *
   * @param path ファイルパス
   * @returns 保存成功時はtrue
   */
  async saveImmediately(path: string): Promise<boolean> {
    const normalizedPath = toAppPath(path);
    const entry = this.metadataMap.get(normalizedPath);

    // 保留中のタイマーをキャンセル
    if (entry?.saveTimerId) {
      clearTimeout(entry.saveTimerId);
      entry.saveTimerId = undefined;
    }

    // contentMapから現在のコンテンツを取得
    const content = this.getContentFromStore(normalizedPath);
    if (content === undefined) {
      console.warn('[EditorMemoryManager] No tab found for path:', normalizedPath);
      return false;
    }

    return this.executeSave(normalizedPath, content);
  }

  /**
   * 指定パスのコンテンツを外部から更新（Git操作、AI適用後など）
   * - contentMapを更新
   * - isDirtyはfalse（外部からの更新は保存済みとみなす）
   *
   * @param path ファイルパス
   * @param content 新しいコンテンツ
   */
  updateFromExternal(path: string, content: string): void {
    const normalizedPath = toAppPath(path);

    // 既存のタイマーをクリア
    const existing = this.metadataMap.get(normalizedPath);
    if (existing?.saveTimerId) {
      clearTimeout(existing.saveTimerId);
    }

    // コンテンツをcontentMapに保存
    this.contentMap.set(normalizedPath, content);

    // メタデータを更新
    const entry: MetadataEntry = {
      lastModified: Date.now(),
    };
    this.metadataMap.set(normalizedPath, entry);

    // tabStoreのisDirtyをfalseに更新
    this.syncDirtyFlagToTabStore(normalizedPath, false);

    // 変更リスナーに通知
    this.notifyChangeListeners(normalizedPath, content, 'external');

    console.log('[EditorMemoryManager] Content updated from external:', normalizedPath);
  }

  /**
   * パスのエントリを削除（タブを閉じた時など）
   *
   * @param path ファイルパス
   */
  removeEntry(path: string): void {
    const normalizedPath = toAppPath(path);
    const entry = this.metadataMap.get(normalizedPath);

    if (entry?.saveTimerId) {
      clearTimeout(entry.saveTimerId);
    }

    this.metadataMap.delete(normalizedPath);
    console.log('[EditorMemoryManager] Entry removed:', normalizedPath);
  }

  /**
   * 指定パスが変更中（isDirty）かどうかを取得（tabStoreから）
   */
  isDirty(path: string): boolean {
    const normalizedPath = toAppPath(path);
    const tabInfo = useTabStore.getState().findTabByPath(normalizedPath, 'editor');
    return tabInfo ? ((tabInfo.tab as any).isDirty ?? false) : false;
  }

  /**
   * 全ての未保存変更を保存（アプリ終了前など）
   */
  async saveAllPending(): Promise<void> {
    const savePromises: Promise<boolean>[] = [];

    // tabStoreからisDirtyなタブを取得
    const allTabs = useTabStore.getState().getAllTabs();
    const dirtyTabs = allTabs.filter(
      t => (t.kind === 'editor' || t.kind === 'diff') && (t as any).isDirty
    );

    for (const tab of dirtyTabs) {
      const path = toAppPath(tab.path || '');
      if (!path) continue;

      // タイマーをキャンセル
      const entry = this.metadataMap.get(path);
      if (entry?.saveTimerId) {
        clearTimeout(entry.saveTimerId);
        entry.saveTimerId = undefined;
      }

      const content = this.getContentFromStore(path);
      if (content !== undefined) {
        savePromises.push(this.executeSave(path, content));
      }
    }

    await Promise.all(savePromises);
    console.log('[EditorMemoryManager] All pending changes saved');
  }

  /**
   * 初期コンテンツを登録（タブを開いた時に呼び出し）
   * contentMapとメタデータを登録
   *
   * @param path ファイルパス
   * @param content 初期コンテンツ
   */
  registerInitialContent(path: string, content: string): void {
    const normalizedPath = toAppPath(path);

    // 既にコンテンツがあれば何もしない
    if (this.contentMap.has(normalizedPath)) {
      return;
    }

    // コンテンツをcontentMapに保存
    this.contentMap.set(normalizedPath, content);

    const entry: MetadataEntry = {
      lastModified: Date.now(),
    };

    this.metadataMap.set(normalizedPath, entry);
    console.log('[EditorMemoryManager] Initial content registered:', normalizedPath);
  }

  // ==================== リスナー管理 ====================

  /**
   * コンテンツ変更リスナーを追加
   */
  addChangeListener(listener: ContentChangeListener): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  /**
   * 保存完了リスナーを追加
   */
  addSaveListener(listener: SaveCompleteListener): () => void {
    this.saveListeners.add(listener);
    return () => this.saveListeners.delete(listener);
  }

  // ==================== 内部メソッド ====================

  /**
   * コンテンツを取得（contentMapから優先、なければtabStoreから）
   */
  private getContentFromStore(path: string): string | undefined {
    // まずcontentMapから取得
    const content = this.contentMap.get(path);
    if (content !== undefined) {
      return content;
    }

    // フォールバック: tabStoreから取得
    const tabs = useTabStore.getState().getAllTabs();

    // editorタブを優先
    const editorTab = tabs.find(t => t.kind === 'editor' && toAppPath(t.path || '') === path);
    if (editorTab) {
      return (editorTab as any).content;
    }

    // diffタブ
    const diffTab = tabs.find(t => t.kind === 'diff' && toAppPath(t.path || '') === path);
    if (diffTab && (diffTab as any).diffs?.length > 0) {
      return (diffTab as any).diffs[0].latterContent;
    }

    return undefined;
  }

  /**
   * fileRepositoryの変更イベントを処理
   */
  private handleFileRepositoryChange(event: FileChangeEvent): void {
    if (event.type === 'delete') {
      // 削除イベントはtabStoreに委譲済み
      return;
    }

    if (event.type === 'create' || event.type === 'update') {
      const filePath = toAppPath((event.file as any).path || '');
      const newContent = (event.file as any).content || '';

      // 自身の保存による変更は無視（無限ループ防止）
      if (this.savingPaths.has(filePath)) {
        return;
      }

      // タブが開いているか確認（コンテンツ未ロードでも外部更新は拾う）
      const tabStore = useTabStore.getState();
      const tabInfo = tabStore.findTabByPath(filePath);
      if (!tabInfo) {
        // そもそもタブが開かれていない場合はスキップ
        return;
      }

      // tabStoreの現在のコンテンツと比較
      const currentContent = this.getContentFromStore(filePath);
      if (currentContent === newContent) {
        // 内容が同じならスキップ
        return;
      }

      // 外部からの変更として処理
      console.log('[EditorMemoryManager] External change detected:', filePath);
      this.updateFromExternal(filePath, newContent);
    }
  }

  /**
   * tabStoreの該当パスを持つ全タブのisDirtyフラグのみを更新
   * contentは更新しない（panesの再レンダリングを防止）
   */
  private syncDirtyFlagToTabStore(path: string, isDirty: boolean): void {
    const tabStore = useTabStore.getState();
    const tabs = tabStore.getAllTabs();

    // 同じパスを持つタブを検索
    const matchingTabs = tabs.filter(t => {
      const tabPath = toAppPath(t.path || '');
      return tabPath === path && (t.kind === 'editor' || t.kind === 'diff' || t.kind === 'ai');
    });

    if (matchingTabs.length === 0) return;

    // isDirtyのみを更新（contentは更新しない）
    const firstTab = matchingTabs[0];
    tabStore.updateTabDirtyFlag(firstTab.id, isDirty);
  }

  /**
   * デバウンス保存をスケジュール
   */
  private scheduleSave(path: string): void {
    const entry = this.metadataMap.get(path);
    if (!entry) return;

    // 既存のタイマーがあればクリア
    if (entry.saveTimerId) {
      clearTimeout(entry.saveTimerId);
    }

    // 新しいタイマーを設定
    entry.saveTimerId = setTimeout(async () => {
      // タイマー発火時にcontentMapから最新のコンテンツを取得
      const content = this.getContentFromStore(path);
      if (content !== undefined) {
        try {
          await this.executeSave(path, content);
        } catch (e) {
          console.error('[EditorMemoryManager] Scheduled save failed:', e);
        }
      }
    }, this.options.debounceMs);

    console.log('[EditorMemoryManager] Save scheduled:', {
      path,
      debounceMs: this.options.debounceMs,
    });
  }

  /**
   * 実際の保存処理を実行
   */
  private async executeSave(path: string, content: string): Promise<boolean> {
    const projectId = getCurrentProjectId();
    if (!projectId) {
      console.error('[EditorMemoryManager] No project ID for save');
      this.notifySaveListeners(path, false, new Error('No project ID'));
      return false;
    }

    try {
      console.log('[EditorMemoryManager] Executing save:', { path, projectId });

      // 自身の保存として記録（イベントループバック防止）
      this.savingPaths.add(path);

      // fileRepositoryに保存
      await fileRepository.saveFileByPath(projectId, path, content);

      // 保存完了後にフラグを解除
      this.savingPaths.delete(path);

      // メタデータを更新
      const entry = this.metadataMap.get(path);
      if (entry) {
        entry.saveTimerId = undefined;
      }

      // tabStoreのisDirtyをクリア
      this.syncDirtyFlagToTabStore(path, false);

      // 保存完了リスナーに通知
      this.notifySaveListeners(path, true);

      console.log('[EditorMemoryManager] Save completed:', path);
      return true;
    } catch (error) {
      // エラー時もフラグを解除
      this.savingPaths.delete(path);

      console.error('[EditorMemoryManager] Save failed:', { path, error });
      this.notifySaveListeners(path, false, error as Error);
      return false;
    }
  }

  /**
   * 変更リスナーに通知
   */
  private notifyChangeListeners(
    path: string,
    content: string,
    source: 'editor' | 'external'
  ): void {
    for (const listener of this.changeListeners) {
      try {
        listener(path, content, source);
      } catch (e) {
        console.error('[EditorMemoryManager] Change listener error:', e);
      }
    }
  }

  /**
   * 保存完了リスナーに通知
   */
  private notifySaveListeners(path: string, success: boolean, error?: Error): void {
    for (const listener of this.saveListeners) {
      try {
        listener(path, success, error);
      } catch (e) {
        console.error('[EditorMemoryManager] Save listener error:', e);
      }
    }
  }

  // ==================== デバッグ用 ====================

  /**
   * 現在の状態をダンプ（デバッグ用）
   */
  debug(): void {
    console.log('[EditorMemoryManager] Current state:', {
      entries: Array.from(this.metadataMap.entries()).map(([path, entry]) => ({
        path,
        hasPendingTimer: !!entry.saveTimerId,
        lastModified: entry.lastModified,
      })),
      listenerCount: {
        change: this.changeListeners.size,
        save: this.saveListeners.size,
      },
    });
  }
}

// シングルトンインスタンスをエクスポート
export const editorMemoryManager = EditorMemoryManager.getInstance();

// 型もエクスポート
export type { ContentChangeListener, SaveCompleteListener, EditorMemoryManagerOptions };
