import { Tab, FileItem, Project } from '../types';
/**
 * タブの重複検出・アクティブ化・新規追加を一元化する関数。
 * @param file 開くファイル情報
 * @param tabs 現在のタブ配列
 * @param setTabs タブ配列のsetter
 * @param setActiveTabId アクティブタブIDのsetter
 * @param options オプション: preview/webPreview/jumpToLine/jumpToColumn等
 */
export const openOrActivateTab = (
  file: FileItem,
  tabs: Tab[],
  setTabs: (tabs: Tab[] | ((tabs: Tab[]) => Tab[])) => void,
  setActiveTabId: (id: string) => void,
  options?: {
    preview?: boolean;
    webPreview?: boolean;
    jumpToLine?: number;
    jumpToColumn?: number;
    aiReviewProps?: {
      originalContent: string;
      suggestedContent: string;
      filePath: string;
    };
  }
) => {
  // タブID生成ロジック（preview/webPreview対応）
  let tabId = file.id ? String(file.id) : file.path;
  if (options?.preview) tabId = `preview-${file.path}`;
  if (options?.webPreview) tabId = `web-preview-${file.path}`;

  // 既存タブ検索
  const existing = tabs.find(tab => tab.id === tabId);
  if (existing) {
    // 優先順位: options に指定があればそれを使い、なければ file に付与された jumpToLine/jumpToColumn を使う
    const jumpToLine =
      options?.jumpToLine !== undefined ? options.jumpToLine : (file as any).jumpToLine;
    const jumpToColumn =
      options?.jumpToColumn !== undefined ? options.jumpToColumn : (file as any).jumpToColumn;

    if (jumpToLine !== undefined || jumpToColumn !== undefined) {
      console.log('[openOrActivateTab] Setting jump position for existing tab:', {
        tabId,
        jumpToLine,
        jumpToColumn,
      });
      setTabs((currentTabs: Tab[]) =>
        currentTabs.map(tab =>
          tab.id === tabId
            ? {
                ...tab,
                jumpToLine,
                jumpToColumn,
              }
            : tab
        )
      );
    }
    setActiveTabId(tabId);
    return;
  }

  // 新規タブ作成
  const isBufferArray = !!file.isBufferArray;
  const newTab: any = {
    id: tabId,
    name: options?.webPreview ? `Web Preview: ${file.name}` : file.name,
    content: isBufferArray ? '' : file.content || '',
    isDirty: false,
    path: file.path,
    // 後方互換: file.isCodeMirror が未定義の場合は false を明示
    isCodeMirror: typeof file.isCodeMirror === 'boolean' ? file.isCodeMirror : false,
    isBufferArray,
    bufferContent: isBufferArray ? file.bufferContent : undefined,
    preview: options?.preview,
    webPreview: options?.webPreview,
    aiReviewProps: options?.aiReviewProps,
  };
  // 新規タブ作成時の jumpTo は options を優先し、なければ file に付与された値を使う
  const newJumpToLine =
    options?.jumpToLine !== undefined ? options.jumpToLine : (file as any).jumpToLine;
  const newJumpToColumn =
    options?.jumpToColumn !== undefined ? options.jumpToColumn : (file as any).jumpToColumn;
  if (newJumpToLine !== undefined) newTab.jumpToLine = newJumpToLine;
  if (newJumpToColumn !== undefined) newTab.jumpToColumn = newJumpToColumn;

  if (options?.jumpToLine !== undefined) {
    console.log('[openOrActivateTab] Creating new tab with jump position:', {
      tabId,
      jumpToLine: options.jumpToLine,
      jumpToColumn: options.jumpToColumn,
    });
  }

  setTabs((currentTabs: Tab[]) => [...currentTabs, newTab]);
  setActiveTabId(tabId);
};

export const openFile = (
  file: FileItem,
  tabs: Tab[],
  setTabs: (tabs: Tab[] | ((tabs: Tab[]) => Tab[])) => void,
  setActiveTabId: (id: string) => void
) => {
  // 後方互換: 通常ファイルオープンはopenOrActivateTabで集約
  if (file.type === 'folder') return;
  openOrActivateTab(file, tabs, setTabs, setActiveTabId, {
    jumpToLine: (file as any).jumpToLine,
    jumpToColumn: (file as any).jumpToColumn,
  });
};
