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
  // Determine kind
  const kind: 'editor' | 'preview' | 'webPreview' | 'ai' | 'diff' = options?.aiReviewProps
    ? 'ai'
    : options?.webPreview
      ? 'webPreview'
      : options?.preview
        ? 'preview'
        : 'editor';

  // タブID生成ロジック: include kind so that same file can have multiple tab kinds
  let tabId = file.id ? String(file.id) : file.path;
  if (kind !== 'editor') tabId = `${kind}:${file.path}`;

  // 既存タブ検索: 復元されたタブはペインID接頭辞やサフィックスを含む場合がある
  // 正規化ルール:
  // - 比較はファイルのフルパス(path)で行う
  // - tab.id が `${paneId}:${path}` の形式や `${something}:${path}-preview` のような形式でもマッチさせる
  const normalizePath = (p: string | undefined) => {
    if (!p) return '';
    // If p contains a kind prefix like "preview:/path" or "editor:/path", strip the prefix
    const withoutKindPrefix = p.includes(':') ? p.replace(/^[^:]+:/, '') : p;
    // remove known suffixes used historically
    return withoutKindPrefix.replace(/(-preview|-diff|-ai)$/, '');
  };

  const targetPath = normalizePath(tabId) || normalizePath(file.path);

  // Find existing tab: only consider a tab a match if its normalized path equals the file path
  // AND its kind matches. If no kind is present (older tabs), fall back to previous behavior.
  const existing = tabs.find(tab => {
    // direct id match
    if (tab.id === tabId) return true;

    // Determine kind of the existing tab. If it's explicitly set, require exact match to avoid
    // conflating AI review tabs with normal editor tabs. If it's missing (legacy tabs), treat
    // them as 'editor' for backward compatibility.
    const tabKind = (tab as any).kind
      ? (tab as any).kind
      : tab.id && typeof tab.id === 'string' && tab.id.includes(':')
        ? tab.id.split(':')[0]
        : 'editor';

    const tabIdNorm = normalizePath(tab.id);
    const tabPathNorm = normalizePath(tab.path);
    const filePathNorm = normalizePath(file.path);

    const pathMatches = tabIdNorm === filePathNorm || tabPathNorm === filePathNorm;

    // Strict kind matching rule:
    // - If the existing tab has an explicit kind, it must equal the requested kind.
    // - If the existing tab is a legacy tab without explicit kind, allow matching to 'editor' only.
    const existingHasExplicitKind = typeof (tab as any).kind === 'string';
    const kindMatches = existingHasExplicitKind ? tabKind === kind : kind === 'editor';

    return pathMatches && kindMatches;
  });
  if (existing) {
    // 優先順位: options に指定があればそれを使い、なければ file に付与された jumpToLine/jumpToColumn を使う
    const jumpToLine =
      options?.jumpToLine !== undefined ? options.jumpToLine : (file as any).jumpToLine;
    const jumpToColumn =
      options?.jumpToColumn !== undefined ? options.jumpToColumn : (file as any).jumpToColumn;

    if (jumpToLine !== undefined || jumpToColumn !== undefined) {
      console.log('[openOrActivateTab] Setting jump position for existing tab:', {
        // Use the actual existing tab id (may include pane prefix)
        existingId: existing.id,
        jumpToLine,
        jumpToColumn,
      });
      setTabs((currentTabs: Tab[]) =>
        currentTabs.map(tab =>
          tab.id === existing.id
            ? {
                ...tab,
                jumpToLine,
                jumpToColumn,
              }
            : tab
        )
      );
    }
    // Activate the actual existing tab id so UI selects the restored tab (which may include pane prefixes)
    setActiveTabId(existing.id);
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
    kind,
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
