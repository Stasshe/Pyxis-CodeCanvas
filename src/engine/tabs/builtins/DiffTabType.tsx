// src/engine/tabs/builtins/DiffTabType.tsx
import React, { useRef, useCallback, useEffect } from 'react';

import { TabTypeDefinition, DiffTab, TabComponentProps } from '../types';

import { useGitContext } from '@/components/PaneContainer';
import DiffTabComponent from '@/components/Tab/DiffTab';
import { useProject } from '@/engine/core/project';
import { useTabStore } from '@/stores/tabStore';
import { useKeyBinding } from '@/hooks/useKeyBindings';

/**
 * Diffタブのコンポーネント
 */
const DiffTabRenderer: React.FC<TabComponentProps> = ({ tab }) => {
  const diffTab = tab as DiffTab;
  const updateTab = useTabStore(state => state.updateTab);
  const { saveFile, currentProject } = useProject(); // ← currentProject も取得
  const { setGitRefreshTrigger } = useGitContext();

  // 保存タイマーの管理
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const latestContentRef = useRef<string>('');

  // クリーンアップ
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  // 即時保存ハンドラー（Ctrl+S用）
  const handleImmediateSave = useCallback(async () => {
    if (!diffTab.editable || !diffTab.path) {
      console.log('[DiffTabType] Save skipped:', { 
        editable: diffTab.editable, 
        path: diffTab.path 
      });
      return;
    }

    if (!saveFile) {
      console.error('[DiffTabType] saveFile is undefined');
      return;
    }

    if (!currentProject) {
      console.error('[DiffTabType] No current project');
      return;
    }

    // デバウンスタイマーをクリア
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }

    const contentToSave = latestContentRef.current || 
      (diffTab.diffs.length > 0 ? diffTab.diffs[0].latterContent : '');

    console.log('[DiffTabType] Immediate save:', {
      path: diffTab.path,
      contentLength: contentToSave.length,
    });

    try {
      await saveFile(diffTab.path, contentToSave);
      updateTab(diffTab.paneId, diffTab.id, { isDirty: false } as Partial<DiffTab>);
      setGitRefreshTrigger(prev => prev + 1);
      console.log('[DiffTabType] ✓ Immediate save completed');
    } catch (error) {
      console.error('[DiffTabType] Immediate save failed:', error);
    }
  }, [diffTab, saveFile, currentProject, updateTab, setGitRefreshTrigger]);

  // Ctrl+S バインディング
  useKeyBinding(
    'saveFile',
    handleImmediateSave,
    [handleImmediateSave]
  );

  const handleImmediateContentChange = useCallback((content: string) => {
    // 最新のコンテンツを保存
    latestContentRef.current = content;

    // 即座にコンテンツを更新（isDirtyをtrue）
    if (diffTab.diffs.length > 0) {
      const updatedDiffs = [...diffTab.diffs];
      updatedDiffs[0] = {
        ...updatedDiffs[0],
        latterContent: content,
      };
      updateTab(diffTab.paneId, diffTab.id, {
        diffs: updatedDiffs,
        isDirty: true,
      } as Partial<DiffTab>);
    }
  }, [diffTab, updateTab]);

  const handleContentChange = useCallback(async (content: string) => {
    if (!diffTab.editable || !diffTab.path || !saveFile || !currentProject) {
      console.log('[DiffTabType] Debounced save skipped:', {
        editable: diffTab.editable,
        path: diffTab.path,
        hasSaveFile: !!saveFile,
        hasProject: !!currentProject,
      });
      return;
    }

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    console.log('[DiffTabType] Scheduling debounced save in 5 seconds...');
    saveTimeoutRef.current = setTimeout(async () => {
      console.log('[DiffTabType] Executing debounced save');
      
      try {
        await saveFile(diffTab.path!, content);
        updateTab(diffTab.paneId, diffTab.id, { isDirty: false } as Partial<DiffTab>);
        setGitRefreshTrigger(prev => prev + 1);
        console.log('[DiffTabType] ✓ Debounced save completed');
      } catch (error) {
        console.error('[DiffTabType] Debounced save failed:', error);
      }
    }, 5000);
  }, [diffTab, saveFile, currentProject, updateTab, setGitRefreshTrigger]);

  return (
    <DiffTabComponent
      diffs={diffTab.diffs}
      editable={diffTab.editable}
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

  createTab: (data, options): DiffTab => {
    const files = data.files;
    const isMultiFile = Array.isArray(files);
    const diffs = isMultiFile ? files : [files];

    let tabId: string;
    let tabName: string;

    if (isMultiFile) {
      const firstDiff = diffs[0];
      tabId = `diff-all-${firstDiff.formerCommitId}-${firstDiff.latterCommitId}`;
      tabName = `Diff: ${firstDiff.formerCommitId?.slice(0, 6) || ''}..${firstDiff.latterCommitId?.slice(0, 6) || ''}`;
    } else {
      const diff = diffs[0];
      tabId = `diff-${diff.formerCommitId}-${diff.latterCommitId}-${diff.formerFullPath}`;
      tabName = `Diff: ${diff.formerFullPath.split('/').pop()} (${diff.formerCommitId?.slice(0, 6) || ''}..${diff.latterCommitId?.slice(0, 6) || ''})`;
    }

    return {
      id: tabId,
      name: tabName,
      kind: 'diff',
      path: isMultiFile ? '' : diffs[0].formerFullPath,
      paneId: options?.paneId || '',
      diffs: diffs,
      editable: data.editable ?? false,
    };
  },

  shouldReuseTab: (existingTab, newFile, options) => {
    return existingTab.path === newFile.path && existingTab.kind === 'diff';
  },
};
