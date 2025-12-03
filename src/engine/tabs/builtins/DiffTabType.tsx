// src/engine/tabs/builtins/DiffTabType.tsx
import React, { useRef, useCallback, useEffect } from 'react';

import { TabTypeDefinition, DiffTab, TabComponentProps } from '../types';

import { useGitContext } from '@/components/PaneContainer';
import DiffTabComponent from '@/components/Tab/DiffTab';
import { fileRepository } from '@/engine/core/fileRepository';
import { useTabStore } from '@/stores/tabStore';
import { useKeyBinding } from '@/hooks/useKeyBindings';
import { getCurrentProjectId } from '@/stores/projectStore';

/**
 * Diffタブのコンポーネント
 * 
 * NOTE: NEW-ARCHITECTURE.mdに従い、ファイル操作はfileRepositoryを直接使用。
 * useProject()フックは各コンポーネントで独立した状態を持つため、
 * currentProjectがnullになりファイルが保存されない問題があった。
 * 代わりにグローバルなprojectStoreからプロジェクトIDを取得する。
 */
const DiffTabRenderer: React.FC<TabComponentProps> = ({ tab }) => {
  const diffTab = tab as DiffTab;
  const updateTabContent = useTabStore(state => state.updateTabContent);
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

    // グローバルストアからプロジェクトIDを取得
    const projectId = getCurrentProjectId();
    if (!projectId) {
      console.error('[DiffTabType] No project ID available');
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
      // fileRepositoryを直接使用してファイルを保存（NEW-ARCHITECTURE.mdに従う）
      await fileRepository.saveFileByPath(projectId, diffTab.path, contentToSave);
      // 保存後は全タブのisDirtyをクリア
      updateTabContent(diffTab.id, contentToSave, false);
      setGitRefreshTrigger(prev => prev + 1);
      console.log('[DiffTabType] ✓ Immediate save completed');
    } catch (error) {
      console.error('[DiffTabType] Immediate save failed:', error);
    }
  }, [diffTab.editable, diffTab.path, diffTab.diffs, diffTab.id, updateTabContent, setGitRefreshTrigger]);

  // Ctrl+S バインディング
  useKeyBinding(
    'saveFile',
    handleImmediateSave,
    [handleImmediateSave]
  );

  const handleImmediateContentChange = useCallback((content: string) => {
    // 最新のコンテンツを保存
    latestContentRef.current = content;

    // 即座に同じパスを持つ全タブのコンテンツを更新（isDirtyをtrue）
    updateTabContent(diffTab.id, content, true);
  }, [diffTab.id, updateTabContent]);

  const handleContentChange = useCallback(async (content: string) => {
    // グローバルストアからプロジェクトIDを取得
    const projectId = getCurrentProjectId();
    if (!diffTab.editable || !diffTab.path || !projectId) {
      console.log('[DiffTabType] Debounced save skipped:', {
        editable: diffTab.editable,
        path: diffTab.path,
        hasProjectId: !!projectId,
      });
      return;
    }

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    console.log('[DiffTabType] Scheduling debounced save in 5 seconds...');
    saveTimeoutRef.current = setTimeout(async () => {
      console.log('[DiffTabType] Executing debounced save');
      
      // 保存時点で再度プロジェクトIDを取得（変更されている可能性があるため）
      const currentProjectId = getCurrentProjectId();
      if (!currentProjectId) {
        console.error('[DiffTabType] No project ID at save time');
        return;
      }
      
      try {
        // fileRepositoryを直接使用してファイルを保存（NEW-ARCHITECTURE.mdに従う）
        await fileRepository.saveFileByPath(currentProjectId, diffTab.path!, content);
        // 保存後は全タブのisDirtyをクリア
        updateTabContent(diffTab.id, content, false);
        setGitRefreshTrigger(prev => prev + 1);
        console.log('[DiffTabType] ✓ Debounced save completed');
      } catch (error) {
        console.error('[DiffTabType] Debounced save failed:', error);
      }
    }, 5000);
  }, [diffTab.editable, diffTab.path, diffTab.id, updateTabContent, setGitRefreshTrigger]);

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
    const diffTab = existingTab as DiffTab;
    
    // 複数ファイルの場合はコミットIDで比較
    if (newFile.files && Array.isArray(newFile.files) && newFile.files.length > 1) {
      const firstDiff = newFile.files[0];
      return (
        diffTab.kind === 'diff' &&
        diffTab.diffs.length > 1 &&
        diffTab.diffs[0]?.formerCommitId === firstDiff.formerCommitId &&
        diffTab.diffs[0]?.latterCommitId === firstDiff.latterCommitId
      );
    }
    
    // 単一ファイルの場合はパスとコミットIDで比較
    const singleFileDiff = newFile.files ? newFile.files[0] : newFile;
    return (
      diffTab.kind === 'diff' &&
      diffTab.diffs.length === 1 &&
      diffTab.diffs[0]?.formerFullPath === singleFileDiff.formerFullPath &&
      diffTab.diffs[0]?.formerCommitId === singleFileDiff.formerCommitId &&
      diffTab.diffs[0]?.latterCommitId === singleFileDiff.latterCommitId
    );
  },
};
