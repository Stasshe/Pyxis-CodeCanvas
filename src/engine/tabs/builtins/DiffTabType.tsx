// src/engine/tabs/builtins/DiffTabType.tsx
import type React from 'react';
import { useCallback, useEffect, useMemo, useRef } from 'react';

import type { DiffFileEntry, DiffTab, TabComponentProps, TabTypeDefinition } from '../types';

import { useGitContext } from '@/components/Pane/PaneContainer';
import DiffTabComponent from '@/components/Tab/DiffTab';
import { useKeyBinding } from '@/hooks/keybindings/useKeyBindings';
import { useSettings } from '@/hooks/state/useSettings';
import { useProjectSnapshot } from '@/stores/projectStore';
import {
  addSaveListener,
  initTabSaveSync,
  saveImmediately,
  setContent as setTabContent,
} from '@/stores/tabState';

import { useTabContent } from '@/stores/tabContentStore';

/**
 * Diffタブのコンポーネント
 *
 * tabState (Valtio) でコンテンツ・デバウンス保存・タブ間同期を管理。
 * editable=true の場合のみ編集可能。
 */
const DiffTabRenderer: React.FC<TabComponentProps> = ({ tab }) => {
  const diffTab = tab as DiffTab;
  const { setGitRefreshTrigger } = useGitContext();

  const { currentProject } = useProjectSnapshot();
  const projectId = currentProject?.id;

  const { settings } = useSettings(projectId);
  const wordWrapConfig = settings?.editor?.wordWrap ? 'on' : 'off';

  // tabContentStoreから最新コンテンツを取得
  const storeContent = useTabContent(diffTab.id);

  // コンテンツをマージした新しいdiffsを作成
  const mergedDiffs = useMemo(() => {
    if (!diffTab.diffs || diffTab.diffs.length === 0) return diffTab.diffs;
    // ストアにコンテンツがあり、かつ編集可能な単一ファイルの場合、latterContentを更新
    if (storeContent !== undefined && diffTab.editable && diffTab.diffs.length === 1) {
      return [{ ...diffTab.diffs[0], latterContent: storeContent }];
    }
    return diffTab.diffs;
  }, [diffTab.diffs, storeContent, diffTab.editable]);

  const latestContentRef = useRef<string>('');
  const initialContent = diffTab.diffs.length === 1 ? diffTab.diffs[0]?.latterContent || '' : '';

  useEffect(() => {
    initTabSaveSync();
    if (diffTab.editable && diffTab.path && diffTab.diffs.length === 1) {
      latestContentRef.current = initialContent;
    }
  }, [diffTab.editable, diffTab.path, initialContent]);

  useEffect(() => {
    if (!diffTab.editable || !diffTab.path) return;
    const unsubscribe = addSaveListener((_path, success) => {
      if (success) setGitRefreshTrigger(prev => prev + 1);
    });
    return unsubscribe;
  }, [diffTab.editable, diffTab.path, setGitRefreshTrigger]);

  const handleImmediateSave = useCallback(async () => {
    if (!diffTab.editable || !diffTab.path) return;
    const success = await saveImmediately(diffTab.path);
    if (success) console.log('[DiffTabType] ✓ Immediate save completed');
  }, [diffTab.editable, diffTab.path]);

  useKeyBinding('saveFile', handleImmediateSave, [handleImmediateSave]);

  const handleImmediateContentChange = useCallback(
    (content: string) => {
      if (!diffTab.editable || !diffTab.path) return;
      latestContentRef.current = content;
      setTabContent(diffTab.path, content);
    },
    [diffTab.editable, diffTab.path]
  );

  const handleContentChange = useCallback(
    async (content: string) => {
      if (!diffTab.editable || !diffTab.path) return;
      setTabContent(diffTab.path, content);
    },
    [diffTab.editable, diffTab.path]
  );

  return (
    <DiffTabComponent
      diffs={mergedDiffs}
      editable={diffTab.editable}
      wordWrapConfig={wordWrapConfig}
      onImmediateContentChange={handleImmediateContentChange}
      onContentChange={handleContentChange}
    />
  );
};

/**
 * Diffタブタイプの定義
 */
export const DiffTabType: TabTypeDefinition = {
  kind: 'diff',
  displayName: 'Diff',
  icon: 'GitCompare',
  canEdit: false,
  canPreview: false,
  component: DiffTabRenderer,
  // diff タブは diffs 配列を完全に保持するので、セッション復元は不要
  // editable な場合でも、保存されたコンテンツをそのまま使用する
  needsSessionRestore: false,

  createTab: (data, options): DiffTab => {
    // data contains { files, editable } where files is DiffFileEntry[] or single DiffFileEntry
    const files = data.files as DiffFileEntry[] | DiffFileEntry | undefined;
    const isMultiFile = Array.isArray(files);
    const diffs: DiffFileEntry[] = isMultiFile ? files : files ? [files] : [];

    let tabId: string;
    let tabName: string;

    if (isMultiFile && diffs.length > 0) {
      const firstDiff = diffs[0];
      tabId = `diff-all-${firstDiff.formerCommitId}-${firstDiff.latterCommitId}`;
      tabName = `Diff: ${firstDiff.formerCommitId?.slice(0, 6) || ''}..${firstDiff.latterCommitId?.slice(0, 6) || ''}`;
    } else if (diffs.length > 0) {
      const diff = diffs[0];
      tabId = `diff-${diff.formerCommitId}-${diff.latterCommitId}-${diff.formerFullPath}`;
      tabName = `Diff: ${diff.formerFullPath.split('/').pop()} (${diff.formerCommitId?.slice(0, 6) || ''}..${diff.latterCommitId?.slice(0, 6) || ''})`;
    } else {
      tabId = `diff-${Date.now()}`;
      tabName = 'Diff';
    }

    return {
      id: tabId,
      name: tabName,
      kind: 'diff',
      path: isMultiFile || diffs.length === 0 ? '' : diffs[0].formerFullPath,
      paneId: options?.paneId || '',
      diffs: diffs,
      editable: Boolean(data.editable),
    };
  },

  shouldReuseTab: (existingTab, newFile, options) => {
    const diffTab = existingTab as DiffTab;
    const files = newFile.files as DiffFileEntry[] | DiffFileEntry | undefined;

    // 複数ファイルの場合はコミットIDで比較
    if (files && Array.isArray(files) && files.length > 1) {
      const firstDiff = files[0];
      return (
        diffTab.kind === 'diff' &&
        diffTab.diffs.length > 1 &&
        diffTab.diffs[0]?.formerCommitId === firstDiff.formerCommitId &&
        diffTab.diffs[0]?.latterCommitId === firstDiff.latterCommitId
      );
    }

    // 単一ファイルの場合はパスとコミットIDで比較
    const singleFileDiff = files
      ? Array.isArray(files)
        ? files[0]
        : files
      : (newFile as unknown as DiffFileEntry);
    return (
      diffTab.kind === 'diff' &&
      diffTab.diffs.length === 1 &&
      diffTab.diffs[0]?.formerFullPath === singleFileDiff.formerFullPath &&
      diffTab.diffs[0]?.formerCommitId === singleFileDiff.formerCommitId &&
      diffTab.diffs[0]?.latterCommitId === singleFileDiff.latterCommitId
    );
  },

  updateContent: (tab, content, isDirty) => {
    const diffTab = tab as DiffTab;
    // diffs配列が空、または最初のdiffがない場合はそのまま返す
    if (!diffTab.diffs || diffTab.diffs.length === 0) {
      return tab;
    }
    // 変更がない場合は元のタブを返す
    if (diffTab.diffs[0].latterContent === content && diffTab.isDirty === isDirty) {
      return tab;
    }
    // latterContentを更新
    const updatedDiffs = [...diffTab.diffs];
    updatedDiffs[0] = { ...updatedDiffs[0], latterContent: content };
    return { ...diffTab, diffs: updatedDiffs, isDirty };
  },

  getContentPath: tab => {
    const diffTab = tab as DiffTab;
    // 編集可能な単一ファイルdiffのみパスを返す
    if (diffTab.editable && diffTab.diffs?.length === 1) {
      return diffTab.path || undefined;
    }
    return undefined;
  },

  // diffs 配列はデフォルトシリアライズで完全に保持される
};
