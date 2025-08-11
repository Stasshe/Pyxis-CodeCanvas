// ファイル変更監視システム
// WebPreviewTabでフォルダ以下のファイル変更を検知するためのイベントシステム

export interface FileChangeEvent {
  path: string;
  projectName: string;
  type: 'create' | 'update' | 'delete';
  content?: string;
  bufferContent?: ArrayBuffer;
  isBufferArray?: boolean;
  timestamp: number;
}

// カスタムイベント名
export const FILE_CHANGE_EVENT = 'pyxis-file-changed';

// ファイル変更を通知する関数
export const notifyFileChange = (event: FileChangeEvent) => {
  // console.log('[FileWatcher] File change notification:', event);
  
  // カスタムイベントを発火
  const customEvent = new CustomEvent(FILE_CHANGE_EVENT, {
    detail: event
  });
  
  window.dispatchEvent(customEvent);
};

// ファイル変更を監視するフック
export const useFileWatcher = (
  watchPath: string,
  projectName: string,
  onFileChange: (event: FileChangeEvent) => void
) => {
  const handleFileChange = (event: CustomEvent<FileChangeEvent>) => {
    const changeEvent = event.detail;
    
    // プロジェクトが一致しない場合は無視
    if (changeEvent.projectName !== projectName) {
      return;
    }
    
    // 監視対象パス以下のファイルかチェック
    if (!changeEvent.path.startsWith(watchPath)) {
      return;
    }
    
    console.log('[FileWatcher] Matched file change:', changeEvent);
    onFileChange(changeEvent);
  };
  
  // イベントリスナーを登録
  const addEventListener = () => {
    window.addEventListener(FILE_CHANGE_EVENT, handleFileChange as EventListener);
  };
  
  // イベントリスナーを削除
  const removeEventListener = () => {
    window.removeEventListener(FILE_CHANGE_EVENT, handleFileChange as EventListener);
  };
  
  return {
    addEventListener,
    removeEventListener
  };
};

// 特定のパス以下のファイル変更を監視するクラス
export class FolderWatcher {
  private watchPath: string;
  private projectName: string;
  private listeners: ((event: FileChangeEvent) => void)[] = [];
  private isActive = false;
  
  constructor(watchPath: string, projectName: string) {
    this.watchPath = watchPath;
    this.projectName = projectName;
  }
  
  // リスナーを追加
  addListener(callback: (event: FileChangeEvent) => void) {
    this.listeners.push(callback);
    
    // 初回リスナー追加時にイベント監視を開始
    if (!this.isActive) {
      this.startWatching();
    }
  }
  
  // リスナーを削除
  removeListener(callback: (event: FileChangeEvent) => void) {
    const index = this.listeners.indexOf(callback);
    if (index > -1) {
      this.listeners.splice(index, 1);
    }
    
    // リスナーが0になったら監視を停止
    if (this.listeners.length === 0) {
      this.stopWatching();
    }
  }
  
  // 監視を開始
  private startWatching() {
    this.isActive = true;
    window.addEventListener(FILE_CHANGE_EVENT, this.handleFileChange);
    console.log('[FolderWatcher] Started watching:', this.watchPath, 'in project:', this.projectName);
  }
  
  // 監視を停止
  private stopWatching() {
    this.isActive = false;
    window.removeEventListener(FILE_CHANGE_EVENT, this.handleFileChange);
    console.log('[FolderWatcher] Stopped watching:', this.watchPath);
  }
  
  // ファイル変更イベントハンドラ
  private handleFileChange = (event: Event) => {
    const customEvent = event as CustomEvent<FileChangeEvent>;
    const changeEvent = customEvent.detail;
    
    // プロジェクトが一致しない場合は無視
    if (changeEvent.projectName !== this.projectName) {
      return;
    }
    
    // 監視対象パス以下のファイルかチェック
    if (!changeEvent.path.startsWith(this.watchPath)) {
      return;
    }
    
    console.log('[FolderWatcher] File change detected:', changeEvent.path, changeEvent.type);
    
    // 全てのリスナーに通知
    this.listeners.forEach(listener => {
      try {
        listener(changeEvent);
      } catch (error) {
        console.error('[FolderWatcher] Error in listener:', error);
      }
    });
  };
  
  // リソースのクリーンアップ
  destroy() {
    this.listeners = [];
    this.stopWatching();
  }
}

// デバッグ用: 全てのファイル変更を監視
export const enableGlobalFileChangeLogging = () => {
  window.addEventListener(FILE_CHANGE_EVENT, (event: Event) => {
    const customEvent = event as CustomEvent<FileChangeEvent>;
    console.log('[Global FileWatcher]', customEvent.detail);
  });
};
