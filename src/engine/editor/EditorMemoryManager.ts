/**
 * EditorMemoryManager - 統一的なエディターメモリ管理システム
 *
 * 責務:
 * 1. 全エディタータブ（editor, diff, ai-review）のコンテンツをメモリ上で一元管理
 * 2. ファイルパスごとのコンテンツ同期（同じファイルを開いている全タブに即時反映）
 * 3. デバウンス保存の統一的な制御
 * 4. 外部変更（Git操作、AI適用）の検知と反映
 * 5. DB（IndexedDB/fileRepository）への保存制御
 *
 * 設計方針:
 * - シングルトンパターンで全アプリケーションで1つのインスタンスを共有
 * - fileRepositoryのイベントシステムを活用して変更を検知
 * - tabStoreと連携してタブのコンテンツを同期
 * - 各エディタータブはこのマネージャーを通じてコンテンツを読み書き
 */

import type { FileChangeEvent } from '@/engine/core/fileRepository';
import { fileRepository, toAppPath } from '@/engine/core/fileRepository';
import { getCurrentProjectId } from '@/stores/projectStore';
import { useTabStore } from '@/stores/tabStore';

/**
 * コンテンツエントリ - パスごとのコンテンツ状態を管理
 */
interface ContentEntry {
  /** 現在のコンテンツ */
  content: string;
  /** 最後に保存されたコンテンツ */
  savedContent: string;
  /** 変更があるか（isDirty） */
  isDirty: boolean;
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
 */
class EditorMemoryManager {
  private static instance: EditorMemoryManager | null = null;

  /** パスごとのコンテンツエントリ */
  private contentMap: Map<string, ContentEntry> = new Map();

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
    for (const entry of this.contentMap.values()) {
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

    // コンテンツマップをクリア
    this.contentMap.clear();

    this.initialized = false;
    console.log('[EditorMemoryManager] Disposed');
  }

  // ==================== コンテンツ操作 ====================

  /**
   * パスに対応するコンテンツを取得
   * @param path ファイルパス（AppPath形式）
   * @returns コンテンツ文字列、またはエントリがない場合はundefined
   */
  getContent(path: string): string | undefined {
    const normalizedPath = toAppPath(path);
    return this.contentMap.get(normalizedPath)?.content;
  }

  /**
   * パスに対応するコンテンツをセット（エディター編集時に呼び出し）
   * - 即時にメモリを更新
   * - tabStoreの全同一パスタブを更新
   * - デバウンス保存をスケジュール
   *
   * @param path ファイルパス
   * @param content 新しいコンテンツ
   * @param skipDebounce trueの場合、デバウンス保存をスキップ（即時保存用）
   */
  setContent(path: string, content: string, skipDebounce = false): void {
    const normalizedPath = toAppPath(path);
    const existing = this.contentMap.get(normalizedPath);

    // 既存のタイマーをクリア
    if (existing?.saveTimerId) {
      clearTimeout(existing.saveTimerId);
    }

    // エントリを更新または作成
    const entry: ContentEntry = {
      content,
      savedContent: existing?.savedContent ?? content,
      isDirty: content !== (existing?.savedContent ?? content),
      lastModified: Date.now(),
    };

    this.contentMap.set(normalizedPath, entry);

    // tabStoreの全同一パスタブを更新（isDirty=true）
    this.syncToTabStore(normalizedPath, content, true);

    // 変更リスナーに通知
    this.notifyChangeListeners(normalizedPath, content, 'editor');

    // デバウンス保存をスケジュール（skipDebounceでなければ）
    if (!skipDebounce && entry.isDirty) {
      this.scheduleSave(normalizedPath, content);
    }

    console.log('[EditorMemoryManager] Content set:', { path: normalizedPath, isDirty: entry.isDirty });
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
    const entry = this.contentMap.get(normalizedPath);

    if (!entry) {
      console.warn('[EditorMemoryManager] No entry found for path:', normalizedPath);
      return false;
    }

    // 保留中のタイマーをキャンセル
    if (entry.saveTimerId) {
      clearTimeout(entry.saveTimerId);
      entry.saveTimerId = undefined;
    }

    // 変更がなければスキップ
    if (!entry.isDirty) {
      console.log('[EditorMemoryManager] No changes to save:', normalizedPath);
      return true;
    }

    return this.executeSave(normalizedPath, entry.content);
  }

  /**
   * 指定パスのコンテンツを外部から更新（Git操作、AI適用後など）
   * - メモリを更新
   * - tabStoreを更新
   * - isDirtyはfalse（外部からの更新は保存済みとみなす）
   *
   * @param path ファイルパス
   * @param content 新しいコンテンツ
   */
  updateFromExternal(path: string, content: string): void {
    const normalizedPath = toAppPath(path);
    const existing = this.contentMap.get(normalizedPath);

    // 既存のタイマーをクリア
    if (existing?.saveTimerId) {
      clearTimeout(existing.saveTimerId);
    }

    // エントリを更新（外部更新は保存済み状態）
    const entry: ContentEntry = {
      content,
      savedContent: content,
      isDirty: false,
      lastModified: Date.now(),
    };

    this.contentMap.set(normalizedPath, entry);

    // tabStoreの全同一パスタブを更新（isDirty=false）
    this.syncToTabStore(normalizedPath, content, false);

    // 変更リスナーに通知
    this.notifyChangeListeners(normalizedPath, content, 'external');

    console.log('[EditorMemoryManager] Content updated from external:', normalizedPath);
  }

  /**
   * パスのエントリを削除（タブを閉じた時など）
   * 他にそのパスを参照しているタブがなければ削除
   *
   * @param path ファイルパス
   */
  removeEntry(path: string): void {
    const normalizedPath = toAppPath(path);
    const entry = this.contentMap.get(normalizedPath);

    if (entry?.saveTimerId) {
      clearTimeout(entry.saveTimerId);
    }

    // 他にこのパスを参照しているタブがあるかチェック
    const tabs = useTabStore.getState().getAllTabs();
    const hasOtherTabs = tabs.some(
      t =>
        toAppPath(t.path || '') === normalizedPath &&
        (t.kind === 'editor' || t.kind === 'diff' || t.kind === 'ai')
    );

    if (!hasOtherTabs) {
      this.contentMap.delete(normalizedPath);
      console.log('[EditorMemoryManager] Entry removed:', normalizedPath);
    }
  }

  /**
   * 指定パスが変更中（isDirty）かどうかを取得
   */
  isDirty(path: string): boolean {
    const normalizedPath = toAppPath(path);
    return this.contentMap.get(normalizedPath)?.isDirty ?? false;
  }

  /**
   * 全ての未保存変更を保存（アプリ終了前など）
   */
  async saveAllPending(): Promise<void> {
    const savePromises: Promise<boolean>[] = [];

    for (const [path, entry] of this.contentMap.entries()) {
      if (entry.isDirty) {
        // タイマーをキャンセルして即時保存
        if (entry.saveTimerId) {
          clearTimeout(entry.saveTimerId);
          entry.saveTimerId = undefined;
        }
        savePromises.push(this.executeSave(path, entry.content));
      }
    }

    await Promise.all(savePromises);
    console.log('[EditorMemoryManager] All pending changes saved');
  }

  /**
   * 初期コンテンツを登録（タブを開いた時に呼び出し）
   * 既にエントリがある場合は何もしない
   *
   * @param path ファイルパス
   * @param content 初期コンテンツ
   */
  registerInitialContent(path: string, content: string): void {
    const normalizedPath = toAppPath(path);

    // 既にエントリがあれば何もしない
    if (this.contentMap.has(normalizedPath)) {
      return;
    }

    const entry: ContentEntry = {
      content,
      savedContent: content,
      isDirty: false,
      lastModified: Date.now(),
    };

    this.contentMap.set(normalizedPath, entry);
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

      // メモリ上のコンテンツと比較して、外部変更かどうかを判定
      const entry = this.contentMap.get(filePath);
      if (entry && entry.content === newContent) {
        // 内容が同じならスキップ
        return;
      }

      // 外部からの変更として処理
      console.log('[EditorMemoryManager] External change detected:', filePath);
      this.updateFromExternal(filePath, newContent);
    }
  }

  /**
   * tabStoreの該当パスを持つ全タブを更新
   */
  private syncToTabStore(path: string, content: string, isDirty: boolean): void {
    const tabStore = useTabStore.getState();
    const tabs = tabStore.getAllTabs();

    // 同じパスを持つタブを検索
    const matchingTabs = tabs.filter(t => {
      const tabPath = toAppPath(t.path || '');
      return tabPath === path && (t.kind === 'editor' || t.kind === 'diff' || t.kind === 'ai');
    });

    if (matchingTabs.length === 0) return;

    // updateTabContentを使用して全タブを更新
    // 最初に見つかったタブのIDを使う（updateTabContentは同一pathの全タブを更新する）
    const firstTab = matchingTabs[0];
    tabStore.updateTabContent(firstTab.id, content, isDirty);

    console.log('[EditorMemoryManager] Synced to tabStore:', {
      path,
      tabCount: matchingTabs.length,
      isDirty,
    });
  }

  /**
   * デバウンス保存をスケジュール
   */
  private scheduleSave(path: string, content: string): void {
    const entry = this.contentMap.get(path);
    if (!entry) return;

    // 既存のタイマーがあればクリア（setContentで既にクリアされているはずだが念のため）
    if (entry.saveTimerId) {
      clearTimeout(entry.saveTimerId);
    }

    // 新しいタイマーを設定
    entry.saveTimerId = setTimeout(async () => {
      // タイマー発火時に再度エントリを取得（最新の状態を使用）
      const currentEntry = this.contentMap.get(path);
      if (currentEntry && currentEntry.isDirty) {
        try {
          await this.executeSave(path, currentEntry.content);
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

      // エントリを更新（保存完了）
      const entry = this.contentMap.get(path);
      if (entry) {
        entry.savedContent = content;
        entry.isDirty = entry.content !== content; // 保存中に変更があったかチェック
        entry.saveTimerId = undefined;
      }

      // tabStoreのisDirtyをクリア
      this.syncToTabStore(path, content, false);

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
      entries: Array.from(this.contentMap.entries()).map(([path, entry]) => ({
        path,
        isDirty: entry.isDirty,
        contentLength: entry.content.length,
        hasPendingTimer: !!entry.saveTimerId,
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
