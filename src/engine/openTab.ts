import { Tab, FileItem } from '../types';
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
    fullPath: file.path,
    isCodeMirror: file.isCodeMirror,
    isBufferArray,
    bufferContent: isBufferArray ? file.bufferContent : undefined,
    preview: options?.preview,
    webPreview: options?.webPreview,
    aiReviewProps: options?.aiReviewProps,
  };
  if (options?.jumpToLine !== undefined) newTab.jumpToLine = options.jumpToLine;
  if (options?.jumpToColumn !== undefined) newTab.jumpToColumn = options.jumpToColumn;
  setTabs((currentTabs: Tab[]) => [...currentTabs, newTab]);
  setActiveTabId(tabId);
};

// これを外から使うことはない。あるならoptionが必要
const createNewTab = (file: FileItem): Tab => {
  console.log('[createNewTab] Creating tab for file:', {
    name: file.name,
    path: file.path,
    contentLength: file.content?.length || 0,
  });
  // fullPath生成: projects/{repoName}/... 形式に揃える
  let fullPath = file.path;
  if (!fullPath.startsWith('projects/')) {
    // repoNameはpathから推測できない場合は空文字
    fullPath = `projects/${file.path}`;
  }
  return {
    id: Date.now().toString(),
    name: file.name,
    content: file.content || '',
    isDirty: false,
    path: file.path,
    fullPath,
    isCodeMirror: file.isCodeMirror ?? false, // 追加
  };
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
