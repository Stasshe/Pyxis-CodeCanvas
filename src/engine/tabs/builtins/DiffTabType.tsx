// src/engine/tabs/builtins/DiffTabType.tsx
import type React from 'react';
import { useCallback, useEffect, useRef } from 'react';

import type { DiffTab, TabComponentProps, TabTypeDefinition } from '../types';

import { useGitContext } from '@/components/PaneContainer';
import DiffTabComponent from '@/components/Tab/DiffTab';
import { editorMemoryManager } from '@/engine/editor';
import { useKeyBinding } from '@/hooks/useKeyBindings';
import { useSettings } from '@/hooks/useSettings';
import { useProjectStore } from '@/stores/projectStore';

/**
 * Diffタブのコンポーネント
 *
 * EditorMemoryManagerを使用した統一的なメモリ管理システムに対応。
 * - editable=trueの場合のみコンテンツ編集が可能
 * - コンテンツ変更はEditorMemoryManagerを通じて行う
 * - デバウンス保存、タブ間同期は自動的に処理される
 */
const DiffTabRenderer: React.FC<TabComponentProps> = ({ tab }) => {
  const diffTab = tab as DiffTab;
  const { setGitRefreshTrigger } = useGitContext();

  // グローバルストアからプロジェクト情報を取得
  const currentProject = useProjectStore(state => state.currentProject);
  const projectId = currentProject?.id;

  // ユーザー設定からwordWrap設定を取得
  const { settings } = useSettings(projectId);
  const wordWrapConfig = settings?.editor?.wordWrap ? 'on' : 'off';

  // 最新のコンテンツを保持（即時保存用）
  const latestContentRef = useRef<string>('');

  // 初期コンテンツをメモ化
  const initialContent = diffTab.diffs.length === 1 ? diffTab.diffs[0]?.latterContent || '' : '';

  // EditorMemoryManagerを初期化し、初期コンテンツを登録
  useEffect(() => {
    const initMemory = async () => {
      await editorMemoryManager.init();
      // editable単一ファイルdiffの場合のみ登録
      if (diffTab.editable && diffTab.path && diffTab.diffs.length === 1) {
        editorMemoryManager.registerInitialContent(diffTab.path, initialContent);
        latestContentRef.current = initialContent;
      }
    };
    initMemory();
    // 依存配列から diffTab.diffs を除外し、初期化は path/editable の変更時のみ実行
  }, [diffTab.editable, diffTab.path, initialContent]);

  // 保存完了時にGit状態を更新
  useEffect(() => {
    if (!diffTab.editable || !diffTab.path) return;

    const unsubscribe = editorMemoryManager.addSaveListener((savedPath, success) => {
      if (success) {
        setGitRefreshTrigger(prev => prev + 1);
      }
    });

    return unsubscribe;
  }, [diffTab.editable, diffTab.path, setGitRefreshTrigger]);

  // 即時保存ハンドラー（Ctrl+S用）
  const handleImmediateSave = useCallback(async () => {
    if (!diffTab.editable || !diffTab.path) {
      console.log('[DiffTabType] Save skipped:', {
        editable: diffTab.editable,
        path: diffTab.path,
      });
      return;
    }

    console.log('[DiffTabType] Immediate save:', {
      path: diffTab.path,
      contentLength: latestContentRef.current.length,
    });

    const success = await editorMemoryManager.saveImmediately(diffTab.path);
    if (success) {
      console.log('[DiffTabType] ✓ Immediate save completed');
    }
  }, [diffTab.editable, diffTab.path]);

  // Ctrl+S バインディング
  useKeyBinding('saveFile', handleImmediateSave, [handleImmediateSave]);

  // 即時コンテンツ変更ハンドラー
  const handleImmediateContentChange = useCallback(
    (content: string) => {
      if (!diffTab.editable || !diffTab.path) return;

      // 最新のコンテンツを保存
      latestContentRef.current = content;

      // EditorMemoryManagerを通じてコンテンツを更新
      editorMemoryManager.setContent(diffTab.path, content);
    },
    [diffTab.editable, diffTab.path]
  );

  // デバウンス保存付きのコンテンツ変更ハンドラー
  // 注: DiffTabでは即時変更ハンドラーで既に保存がスケジュールされるため、
  // このハンドラーは主に互換性のために残している
  const handleContentChange = useCallback(
    async (content: string) => {
      if (!diffTab.editable || !diffTab.path) {
        console.log('[DiffTabType] Content change skipped:', {
          editable: diffTab.editable,
          path: diffTab.path,
        });
        return;
      }

      // EditorMemoryManagerが自動的にデバウンス保存をスケジュール
      editorMemoryManager.setContent(diffTab.path, content);
    },
    [diffTab.editable, diffTab.path]
  );

  return (
    <DiffTabComponent
      diffs={diffTab.diffs}
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

  getContentPath: (tab) => {
    const diffTab = tab as DiffTab;
    // 編集可能な単一ファイルdiffのみパスを返す
    if (diffTab.editable && diffTab.diffs?.length === 1) {
      return diffTab.path || undefined;
    }
    return undefined;
  },
};
