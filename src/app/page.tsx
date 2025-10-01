'use client';

import React, { useState, useEffect } from 'react';
import { useTheme } from '../context/ThemeContext';
import {
  addEditorPane,
  removeEditorPane,
  toggleEditorLayout,
  setTabsForPane,
  setActiveTabIdForPane,
  splitPane,
  flattenPanes,
} from '@/hooks/pane';
import {
  useProjectTabResetEffect,
  useProjectFilesSyncEffect,
  useActiveTabContentRestore,
} from '@/hooks/tab';
import MenuBar from '@/components/MenuBar';
import LeftSidebar from '@/components/Left/LeftSidebar';
import PaneContainer from '@/components/PaneContainer';
import PaneResizer from '@/components/PaneResizer';
import { useDiffTabHandlers } from '@/hooks/useDiffTabHandlers';
import BottomPanel from '@/components/Bottom/BottomPanel';
import ProjectModal from '@/components/ProjectModal';
import {
  useLeftSidebarResize,
  useBottomPanelResize,
  useRightSidebarResize,
} from '@/utils/helper/resize';
import { openFile, openOrActivateTab } from '@/utils/openTab';
import { useGitMonitor } from '@/hooks/gitHooks';
import { useProject } from '@/utils/core/project';
import { Project } from '@/types';
import type { Tab, FileItem, MenuTab, EditorPane } from '@/types';
import RightSidebar from '@/components/Right/RightSidebar';
import FileSelectModal from '@/components/FileSelect';
import { handleFileSelect, handleFilePreview } from '@/hooks/fileSelectHandlers';
import { Terminal, Search } from 'lucide-react';
import PanelRightIcon from '@/components/Right/PanelRightIcon';
import OperationWindow from '@/components/OperationWindow';
import { LOCALSTORAGE_KEY } from '@/context/config';

export default function Home() {
  const [activeMenuTab, setActiveMenuTab] = useState<MenuTab>('files');
  const [leftSidebarWidth, setLeftSidebarWidth] = useState(240);
  const [bottomPanelHeight, setBottomPanelHeight] = useState(200);
  // 右サイドバー関連
  const [rightSidebarWidth, setRightSidebarWidth] = useState(240);
  const [isRightSidebarVisible, setIsRightSidebarVisible] = useState(true);
  const handleRightResize = useRightSidebarResize(rightSidebarWidth, setRightSidebarWidth);
  // 右サイドバーの表示切替（例: メニューやボタンでトグルする場合）
  const toggleRightSidebar = () => setIsRightSidebarVisible(v => !v);
  const [isLeftSidebarVisible, setIsLeftSidebarVisible] = useState(true);
  const [isBottomPanelVisible, setIsBottomPanelVisible] = useState(true);
  const [isProjectModalOpen, setIsProjectModalOpen] = useState(false);
  const [isOperationWindowVisible, setIsOperationWindowVisible] = useState(false);
  const [gitRefreshTrigger, setGitRefreshTrigger] = useState(0);
  const [gitChangesCount, setGitChangesCount] = useState(0); // Git変更ファイル数
  const [nodeRuntimeOperationInProgress, setNodeRuntimeOperationInProgress] = useState(false); // NodeRuntime操作中フラグ
  const [fileSelectState, setFileSelectState] = useState<{ open: boolean; paneIdx: number | null }>(
    { open: false, paneIdx: null }
  );
  // Editor layout is fixed to vertical in this build.
  const [editors, setEditors] = useState<EditorPane[]>([
    { id: 'editor-1', tabs: [], activeTabId: '' },
  ]);
  const [isRestoredFromLocalStorage, setIsRestoredFromLocalStorage] = useState(false); // localStorage復元完了フラグ

  // 初回レンダリング後にlocalStorageから復元（SSR/CSR不一致防止）
  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = window.localStorage.getItem(LOCALSTORAGE_KEY.EDITOR_LAYOUT);
        if (saved) {
          const parsedRaw = JSON.parse(saved);
          // Backwards compatible: old format was an array of editors
          const parsed = Array.isArray(parsedRaw) ? { editors: parsedRaw } : parsedRaw;
          if (parsed && Array.isArray(parsed.editors) && parsed.editors.length > 0) {
            // ペインツリー全体を再帰的に復元
            const restorePaneRecursive = (pane: any, total: number): any => {
              const newId = pane.id;
              // リーフペインならタブを初期化
              const tabs = Array.isArray(pane.tabs)
                ? pane.tabs.map((tab: any) => {
                    let tabId;
                    let tabPath = tab.path;
                    if (tab.id === 'welcome') {
                      tabId = 'welcome';
                      tabPath = '/';
                    } else if (tab.preview) {
                      tabId = `${newId}:${tab.path}-preview`;
                    } else if (tab.diffProps) {
                      tabId = `${newId}:${tab.path}-diff`;
                    } else if (tab.aiReviewProps) {
                      tabId = `${newId}:${tab.path}-ai`;
                    } else {
                      tabId = `${newId}:${tab.path}`;
                    }
                    if (tabPath && !tabPath.startsWith('/')) tabPath = '/' + tabPath;
                    return {
                      ...tab,
                      id: tabId,
                      path: tabPath,
                      content: '',
                      bufferContent: undefined,
                      needsContentRestore:
                        tabId !== 'welcome' &&
                        !tab.diffProps &&
                        !tab.webPreview &&
                        tabPath &&
                        tabPath !== '/',
                    };
                  })
                : [];
              // activeTabIdをtabs配列のIDと完全一致させる
              let restoredActiveTabId = '';
              if (pane.activeTabId && tabs.length > 0) {
                const found = tabs.find((t: any) => t.id === pane.activeTabId);
                if (found) restoredActiveTabId = found.id;
                else {
                  const foundByPath = tabs.find(
                    (t: any) =>
                      t.path === pane.activeTabId ||
                      t.path === pane.activeTabId.replace(/^.*?:/, '')
                  );
                  if (foundByPath) restoredActiveTabId = foundByPath.id;
                }
              }
              if (!restoredActiveTabId && tabs.length > 0) restoredActiveTabId = tabs[0].id;
              // 子ペインがあれば再帰的に復元
              const children = Array.isArray(pane.children)
                ? pane.children.map((child: any) => restorePaneRecursive(child, total))
                : undefined;
              return {
                ...pane,
                id: newId,
                tabs,
                activeTabId: restoredActiveTabId,
                size: pane.size || 100 / total,
                layout: pane.layout || 'vertical',
                children,
                parentId: pane.parentId || undefined,
              };
            };
            const initEditors = parsed.editors.map((editor: any) =>
              restorePaneRecursive(editor, parsed.editors.length)
            );
            setEditors(initEditors);
            // UIの復元: left/right/bottom の表示状態やサイズ
            if (parsed.ui) {
              if (typeof parsed.ui.isLeftSidebarVisible === 'boolean')
                setIsLeftSidebarVisible(parsed.ui.isLeftSidebarVisible);
              if (typeof parsed.ui.isBottomPanelVisible === 'boolean')
                setIsBottomPanelVisible(parsed.ui.isBottomPanelVisible);
              if (typeof parsed.ui.isRightSidebarVisible === 'boolean')
                setIsRightSidebarVisible(parsed.ui.isRightSidebarVisible);
              if (typeof parsed.ui.leftSidebarWidth === 'number')
                setLeftSidebarWidth(parsed.ui.leftSidebarWidth);
              if (typeof parsed.ui.rightSidebarWidth === 'number')
                setRightSidebarWidth(parsed.ui.rightSidebarWidth);
              if (typeof parsed.ui.bottomPanelHeight === 'number')
                setBottomPanelHeight(parsed.ui.bottomPanelHeight);
            }
            // ルートリーフペインのactiveTabIdを復元
            const firstLeaf = (() => {
              const findLeaf = (pane: any): any => {
                if (!pane.children || pane.children.length === 0) return pane;
                return findLeaf(pane.children[0]);
              };
              return findLeaf(initEditors[0]);
            })();
            if (firstLeaf && firstLeaf.tabs.length > 0) {
              setActiveTabId(firstLeaf.tabs[0].id);
            }
          }
        }
      } catch (e) {
        console.error('[DEBUG] Error restoring editors from localStorage:', e);
      }
      setIsRestoredFromLocalStorage(true); // 復元完了フラグを設定
    }
  }, []);
  // editors/editorLayout変更時にlocalStorageへ保存（contentとbufferContentを除外）
  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        // contentとbufferContentの両方を除外してlocalStorageに保存
        const editorsWithoutContent = editors.map(editor => ({
          ...editor,
          tabs: editor.tabs.map(({ content, bufferContent, ...tabRest }) => ({
            ...tabRest,
            // content除外、pathとisBufferArrayは保持してDBから復元できるようにする
          })),
        }));

        const payload = {
          editors: editorsWithoutContent,
          ui: {
            isLeftSidebarVisible,
            isRightSidebarVisible,
            isBottomPanelVisible,
            leftSidebarWidth,
            rightSidebarWidth,
            bottomPanelHeight,
          },
        };

        window.localStorage.setItem(LOCALSTORAGE_KEY.EDITOR_LAYOUT, JSON.stringify(payload));
      } catch (e) {}
    }
  }, [
    editors,
    isLeftSidebarVisible,
    isRightSidebarVisible,
    isBottomPanelVisible,
    leftSidebarWidth,
    rightSidebarWidth,
    bottomPanelHeight,
  ]);

  const { colors } = useTheme();

  // ペイン追加/削除/分割方向切替はpane.tsの関数を利用

  // Diffタブ関連のハンドラをカスタムフックから取得

  // --- 既存のタブ・ファイル操作は最初のリーフペインに集約（初期実装） ---
  const flatPanes = flattenPanes(editors);
  const firstLeafPane = flatPanes[0] || { tabs: [], activeTabId: '' };
  const tabs = firstLeafPane.tabs;
  // setTabsのデバッグログを追加
  const setTabs: React.Dispatch<React.SetStateAction<Tab[]>> = update => {
    if (flatPanes.length > 0) {
      setTabsForPane(editors, setEditors, 0, update);
    }
  };
  const activeTabId = firstLeafPane.activeTabId;
  const setActiveTabId = (id: string) => {
    if (flatPanes.length > 0) {
      setActiveTabIdForPane(editors, setEditors, 0, id);
    }
  };
  const setTabsForAllPanes = (update: Tab[] | ((tabs: Tab[]) => Tab[])) => {
    setEditors(prevEditors => {
      return prevEditors.map(editor => {
        const updatedTabs = typeof update === 'function' ? update(editor.tabs) : update;
        return { ...editor, tabs: updatedTabs };
      });
    });
  };

  // プロジェクト管理
  const {
    currentProject,
    projectFiles,
    loadProject,
    saveFile,
    deleteFile,
    createProject,
    syncTerminalFileOperation,
    refreshProjectFiles,
    clearAIReview,
  } = useProject();

  const handleLeftResize = useLeftSidebarResize(leftSidebarWidth, setLeftSidebarWidth);
  const handleBottomResize = useBottomPanelResize(bottomPanelHeight, setBottomPanelHeight);

  // Diffタブ関連のハンドラをカスタムフックから取得
  const { handleDiffFileClick, handleDiffAllFilesClick } = useDiffTabHandlers(
    currentProject,
    setTabs,
    setActiveTabId
  );

  // プロジェクト変更時のタブリセットuseEffectを分離
  useProjectTabResetEffect({
    currentProject,
    setTabs: update => {
      if (isRestoredFromLocalStorage) {
        setTabsForAllPanes(update);
      } else {
        console.log(
          '[DEBUG] Skipping useProjectTabResetEffect: localStorage restoration not complete'
        );
      }
    },
    setActiveTabId,
    pane: 0,
  });

  // 注意: 以下のフックは古いタブシステム用のため、新しいペインシステムでは無効化
  // プロジェクトファイル更新時のタブ同期useEffectを分離
  // useProjectFilesSyncEffect({
  //   currentProject,
  //   projectFiles,
  //   tabs,
  //   setTabs,
  //   nodeRuntimeOperationInProgress,
  //   isRestoredFromLocalStorage
  // });

  // アクティブタブのコンテンツ復元フック（全ペイン対応）
  // アクティブタブのコンテンツ復元フック（全ペイン対応）
  useActiveTabContentRestore({
    editors,
    projectFiles,
    setEditors,
    isRestoredFromLocalStorage,
  });

  // Git状態監視ロジックをフックに分離
  useEffect(() => {
    const { checkGitStatus } = useGitMonitor({
      currentProject,
      loadProject,
      saveFile,
      deleteFile,
      tabs,
      setTabs,
      activeTabId,
      setActiveTabId,
      projectFiles,
      setGitRefreshTrigger,
      setNodeRuntimeOperationInProgress,
      refreshProjectFiles,
      setGitChangesCount,
      gitRefreshTrigger,
    });
    checkGitStatus();
    const interval = setInterval(checkGitStatus, 60000);
    return () => clearInterval(interval);
  }, [currentProject, gitRefreshTrigger]);

  const handleMenuTabClick = (tab: MenuTab) => {
    if (activeMenuTab === tab && isLeftSidebarVisible) {
      setIsLeftSidebarVisible(false);
    } else {
      setActiveMenuTab(tab);
      setIsLeftSidebarVisible(true);
    }
  };

  const toggleBottomPanel = () => {
    setIsBottomPanelVisible(!isBottomPanelVisible);
  };

  const toggleOperationWindow = () => {
    // 直前に選択されたペインを維持
    const lastSelectedPane = fileSelectState.paneIdx;
    setIsOperationWindowVisible(!isOperationWindowVisible);
  };

  // Ctrl+P でOperation Windowを開く
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'p') {
        e.preventDefault();
        // フォーカスのあるペインまたは最後に選択したペインを使用
        const focusedPaneIndex = fileSelectState.paneIdx ?? 0;
        setIsOperationWindowVisible(true);
        // ペインインデックスを設定
        setFileSelectState(prev => ({ ...prev, paneIdx: focusedPaneIndex }));
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  /**
   * ファイルを開く。必要に応じて行・カラム番号でジャンプする。
   * @param file ファイル情報
   * @param line 行番号（1始まり、省略可）
   * @param column カラム番号（1始まり、省略可）
   */
  const handleFileOpen = (file: FileItem, line?: number, column?: number) => {
    console.log('[handleFileOpen] Opening file:', {
      name: file.name,
      path: file.path,
      contentLength: file.content?.length || 0,
      line,
      column,
    });
    // 最新のプロジェクトファイルから正しいコンテンツ・バイナリ情報を取得
    let fileToOpen = file;
    if (currentProject && projectFiles.length > 0) {
      const latestFile = projectFiles.find(f => f.path === file.path);
      if (latestFile) {
        fileToOpen = {
          ...file,
          content: latestFile.content,
          isBufferArray: (latestFile as any).isBufferArray,
          bufferContent: (latestFile as any).bufferContent,
        };
      }
    }
    if (fileToOpen.isBufferArray) {
      console.log(
        '[handleFileOpen] fileToOpen bufferContent:',
        fileToOpen.path,
        fileToOpen.bufferContent instanceof ArrayBuffer,
        fileToOpen.bufferContent?.byteLength
      );
    }
    // openFile: Tab生成時にもisBufferArray/bufferContentを渡す
    if (line !== undefined || column !== undefined) {
      const tabObj: any = {
        ...fileToOpen,
        jumpToLine: line,
        jumpToColumn: column,
      };
      openFile(tabObj, tabs, setTabs, setActiveTabId);
    } else {
      openFile(fileToOpen, tabs, setTabs, setActiveTabId);
    }
  };

  // 保存再起動イベントリスナー
  useEffect(() => {
    const handleSaveRestart = () => {
      // editors/tabsの全てのisDirtyなタブを保存
      setEditors(prevEditors => {
        prevEditors.forEach((editor, idx) => {
          editor.tabs.forEach(async tab => {
            if (tab.isDirty && currentProject && saveFile) {
              try {
                await saveFile(tab.path, tab.content);
                // 保存後、isDirtyをfalseに
                setEditors(prev => {
                  const updated = [...prev];
                  updated[idx] = {
                    ...updated[idx],
                    tabs: updated[idx].tabs.map(t =>
                      t.id === tab.id ? { ...t, isDirty: false } : t
                    ),
                  };
                  return updated;
                });
              } catch (e) {
                console.error('[SaveRestart] Failed to save:', tab.path, e);
              }
            }
          });
        });
        return prevEditors;
      });
      // Git状態更新
      setTimeout(() => {
        setGitRefreshTrigger(prev => prev + 1);
      }, 200);
    };
    window.addEventListener('pyxis-save-restart', handleSaveRestart);
    return () => {
      window.removeEventListener('pyxis-save-restart', handleSaveRestart);
    };
  }, [saveFile]);

  // 即座のローカル更新専用関数
  // 即座のローカル更新: 全ペインの同じファイルタブも同期（ネストされたペインにも対応）
  const handleTabContentChangeImmediate = (tabId: string, content: string) => {
    setEditors(prevEditors => {
      // 対象ファイルパスを取得（ネストされたペインも含めて探索）
      const findPathInPane = (pane: EditorPane): string | undefined => {
        // 現在のペインのタブをチェック
        const tab = pane.tabs.find(t => t.id === tabId);
        if (tab) return tab.path;

        // 子ペインがあれば再帰的に探索
        if (pane.children) {
          for (const child of pane.children) {
            const found = findPathInPane(child);
            if (found) return found;
          }
        }
        return undefined;
      };

      const targetPath = (() => {
        for (const editor of prevEditors) {
          const found = findPathInPane(editor);
          if (found) return found;
        }
        return undefined;
      })();

      if (!targetPath) return prevEditors;

      // ペインを再帰的に更新する関数
      const updatePane = (pane: EditorPane): EditorPane => {
        const updatedTabs = pane.tabs.map(t =>
          t.path === targetPath ? { ...t, content, isDirty: true } : t
        );

        const updatedChildren = pane.children?.map(child => updatePane(child));

        return {
          ...pane,
          tabs: updatedTabs,
          ...(updatedChildren ? { children: updatedChildren } : {}),
        };
      };

      // 全てのルートペインを更新
      return prevEditors.map(pane => updatePane(pane));
    });
  };

  const handleProjectSelect = async (project: Project) => {
    setTabsForAllPanes([]); // 全ペインのタブをリセット
    setActiveTabId(''); // アクティブタブIDをリセット
    setEditors([{ id: 'editor-1', tabs: [], activeTabId: '' }]); // エディタ状態を初期化
    setIsLeftSidebarVisible(true);
    localStorage.removeItem(LOCALSTORAGE_KEY.EDITOR_LAYOUT); // localStorageのエディタ状態をクリア
    setIsRestoredFromLocalStorage(false); // 復元フラグをリセット
    await loadProject(project);
  };

  const handleProjectCreate = async (name: string, description?: string) => {
    if (createProject) {
      // 全てのタブ、ペーン、セッションをリセット
      setTabsForAllPanes([]); // 全ペインのタブをリセット
      setActiveTabId(''); // アクティブタブIDをリセット
      setEditors([{ id: 'editor-1', tabs: [], activeTabId: '' }]); // エディタ状態を初期化
      setIsLeftSidebarVisible(true);
      localStorage.removeItem(LOCALSTORAGE_KEY.EDITOR_LAYOUT); // localStorageのエディタ状態をクリア
      setIsRestoredFromLocalStorage(false); // 復元フラグをリセット

      await createProject(name, description);
    }
  };

  const handleProjectModalOpen = () => {
    setIsProjectModalOpen(true);
  };

  // // editorsとtabsのデバッグログを追加
  // useEffect(() => {
  //   console.log('[DEBUG] Current editors state:', editors);
  //   console.log('[DEBUG] Current tabs state:', tabs);
  // }, [editors, tabs]);

  return (
    <>
      <div
        className="w-full flex justify-end items-center overflow-hidden"
        style={{
          background: colors.background,
          height: '30px',
        }}
      >
        <button
          className="absolute left-1/2 transform -translate-x-1/2 h-6 flex items-center justify-center border rounded transition-colors"
          onClick={toggleOperationWindow}
          title="ファイル検索 (Ctrl+P)"
          style={{
            zIndex: 50,
            background: isOperationWindowVisible ? colors.accentBg : colors.mutedBg,
            color: isOperationWindowVisible ? colors.primary : colors.mutedFg,
            borderColor: colors.border,
            width: '35%',
            minWidth: 180,
            maxWidth: 500,
            paddingLeft: 12,
            paddingRight: 12,
          }}
        >
          <Search
            size={14}
            color={isOperationWindowVisible ? colors.primary : colors.mutedFg}
          />
          <span className="ml-2 truncate">{currentProject?.name} [ファイル検索]</span>
        </button>
        <button
          className={`relative right-2 h-6 px-2 flex items-center justify-center border rounded transition-colors`}
          onClick={toggleBottomPanel}
          title="ターミナル表示/非表示"
          style={{
            zIndex: 50,
            background: isBottomPanelVisible ? colors.accentBg : colors.mutedBg,
            color: isBottomPanelVisible ? colors.primary : colors.mutedFg,
            borderColor: colors.border,
          }}
        >
          <Terminal
            size={8}
            color={isBottomPanelVisible ? colors.primary : colors.mutedFg}
          />
        </button>
        <button
          className={`relative right-3 h-6 px-2 flex items-center justify-center border rounded transition-colors ml-1`}
          onClick={toggleRightSidebar}
          title="右パネル表示/非表示"
          style={{
            zIndex: 50,
            background: isRightSidebarVisible ? colors.accentBg : colors.mutedBg,
            color: isRightSidebarVisible ? colors.primary : colors.mutedFg,
            borderColor: colors.border,
          }}
        >
          <PanelRightIcon
            size={16}
            color={isRightSidebarVisible ? colors.primary : colors.mutedFg}
          />
        </button>
      </div>
      <div
        className="h-full w-full flex overflow-hidden"
        style={{
          background: colors.background,
          position: 'relative',
        }}
      >
        <MenuBar
          activeMenuTab={activeMenuTab}
          onMenuTabClick={handleMenuTabClick}
          onProjectClick={handleProjectModalOpen}
          gitChangesCount={gitChangesCount}
        />

        {isLeftSidebarVisible && (
          <LeftSidebar
            activeMenuTab={activeMenuTab}
            leftSidebarWidth={leftSidebarWidth}
            files={projectFiles}
            currentProject={currentProject!}
            onFileOpen={handleFileOpen}
            onFilePreview={file => {
              // 最新のファイル内容を取得
              let fileToPreview = file;
              if (currentProject && projectFiles.length > 0) {
                const latestFile = projectFiles.find(f => f.path === file.path);
                if (latestFile) {
                  fileToPreview = { ...file, content: latestFile.content };
                }
              }
              openOrActivateTab(fileToPreview, tabs, setTabs, setActiveTabId, { preview: true });
            }}
            onWebPreview={(file: FileItem) => {
              openOrActivateTab(file, tabs, setTabs, setActiveTabId, { webPreview: true });
            }}
            onResize={handleLeftResize}
            onGitRefresh={() => {
              if (currentProject && loadProject) {
                loadProject(currentProject);
              }
            }}
            gitRefreshTrigger={gitRefreshTrigger}
            onGitStatusChange={setGitChangesCount}
            onFileOperation={async (
              path: string,
              type: 'file' | 'folder' | 'delete',
              content?: string,
              isNodeRuntime?: boolean,
              isBufferArray?: boolean,
              bufferContent?: ArrayBuffer
            ) => {
              if (isNodeRuntime) {
                setNodeRuntimeOperationInProgress(true);
              }
              // バイナリファイルの場合はsyncTerminalFileOperation等で分岐
              if (syncTerminalFileOperation) {
                // バイナリファイルの場合はbufferContentを、テキストファイルの場合はcontentを渡す
                if (isBufferArray && bufferContent) {
                  await syncTerminalFileOperation(path, type, '', bufferContent);
                } else {
                  await syncTerminalFileOperation(path, type, (content as string) || '', undefined);
                }
              }
              setGitRefreshTrigger(prev => prev + 1);
            }}
            onDiffFileClick={handleDiffFileClick}
            onDiffAllFilesClick={handleDiffAllFilesClick}
          />
        )}

        {/* メインエリア＋右サイドバー: 横並びflexで全体が動く */}
        <div
          className="flex-1 flex flex-row overflow-hidden min-h-0"
          style={{ position: 'relative' }}
        >
          {/* メインエディタ部 */}
          <div className="flex-1 flex flex-col overflow-hidden min-h-0">
            <div
              className={'flex-1 flex flex-row overflow-hidden min-h-0'}
              style={{ gap: '0px', position: 'relative' }}
            >
              {editors.map((editor, idx) => (
                <React.Fragment key={editor.id}>
                  <div
                    className="relative min-w-0 min-h-0"
                    style={{
                      width: `${editor.size || 100 / editors.length}%`,
                      flexShrink: 0,
                      overflow: 'hidden',
                    }}
                  >
                    <PaneContainer
                      pane={editor}
                      paneIndex={idx}
                      allPanes={editors}
                      setEditors={setEditors}
                      currentProject={currentProject || undefined}
                      saveFile={saveFile}
                      clearAIReview={clearAIReview}
                      refreshProjectFiles={refreshProjectFiles}
                      setGitRefreshTrigger={setGitRefreshTrigger}
                      setFileSelectState={setFileSelectState}
                      onTabContentChange={handleTabContentChangeImmediate}
                      isBottomPanelVisible={isBottomPanelVisible}
                      toggleBottomPanel={toggleBottomPanel}
                      nodeRuntimeOperationInProgress={nodeRuntimeOperationInProgress}
                    />

                    {/* ルートレベルペイン間のリサイザー */}
                    {idx < editors.length - 1 && (
                      <div
                        style={{
                          position: 'absolute',
                          right: 0,
                          top: 0,
                          bottom: 0,
                          width: '6px',
                          zIndex: 10,
                        }}
                      >
                        <PaneResizer
                          direction={'vertical'}
                          leftSize={editor.size || 100 / editors.length}
                          rightSize={editors[idx + 1]?.size || 100 / editors.length}
                          onResize={(leftSize: number, rightSize: number) => {
                            const updatedEditors = [...editors];
                            updatedEditors[idx] = { ...editor, size: leftSize };
                            updatedEditors[idx + 1] = {
                              ...updatedEditors[idx + 1],
                              size: rightSize,
                            };
                            setEditors(updatedEditors);
                          }}
                        />
                      </div>
                    )}
                  </div>
                </React.Fragment>
              ))}
            </div>
            {isBottomPanelVisible && (
              <BottomPanel
                height={bottomPanelHeight}
                currentProject={currentProject?.name}
                currentProjectId={currentProject?.id || ''}
                projectFiles={projectFiles}
                onResize={handleBottomResize}
                onTerminalFileOperation={async (
                  path: string,
                  type: 'file' | 'folder' | 'delete',
                  content?: string,
                  isNodeRuntime?: boolean,
                  isBufferArray?: boolean,
                  bufferContent?: ArrayBuffer
                ) => {
                  if (isNodeRuntime) {
                    setNodeRuntimeOperationInProgress(true);
                  }
                  if (syncTerminalFileOperation) {
                    // bufferContentが存在する場合、それを渡す
                    if (bufferContent) {
                      await syncTerminalFileOperation(path, type, '', bufferContent);
                    } else {
                      await syncTerminalFileOperation(
                        path,
                        type,
                        (content as string) || '',
                        undefined
                      );
                    }
                  }
                  await refreshProjectFiles();
                  setGitRefreshTrigger(prev => prev + 1);
                }}
              />
            )}
          </div>
          {/* 右サイドバー: リサイズバーを本体の左側に配置 */}
          {isRightSidebarVisible && (
            <>
              <div
                className="resizer resizer-vertical flex-shrink-0"
                onMouseDown={handleRightResize}
                onTouchStart={handleRightResize}
                style={{
                  background: colors.sidebarResizerBg,
                  cursor: 'col-resize',
                }}
              />
              <RightSidebar
                rightSidebarWidth={rightSidebarWidth}
                onResize={() => {}} // 右サイドバー本体には不要
                projectFiles={projectFiles}
                currentProject={currentProject}
                currentProjectId={currentProject?.id || ''}
                tabs={tabs}
                setTabs={setTabs}
                setActiveTabId={setActiveTabId}
                saveFile={saveFile}
                clearAIReview={clearAIReview}
              />
            </>
          )}
        </div>

        <ProjectModal
          isOpen={isProjectModalOpen}
          onClose={() => setIsProjectModalOpen(false)}
          onProjectSelect={handleProjectSelect}
          onProjectCreate={handleProjectCreate}
          currentProject={currentProject}
        />
        {/* ファイル選択モーダル */}
        <FileSelectModal
          isOpen={fileSelectState.open}
          onClose={() => setFileSelectState({ open: false, paneIdx: null })}
          files={projectFiles}
          editors={editors}
          setEditors={setEditors}
          setFileSelectState={setFileSelectState}
          onFileSelect={file => {
            handleFileSelect({
              file,
              fileSelectState,
              currentProject,
              projectFiles,
              editors,
              setEditors,
            });
            setFileSelectState({ open: false, paneIdx: null });
          }}
          onFilePreview={file => {
            handleFilePreview({
              file,
              fileSelectState,
              currentProject,
              projectFiles,
              editors,
              setEditors,
            });
            setFileSelectState({ open: false, paneIdx: null });
          }}
          onFileOperation={async (path, type, content, isNodeRuntime) => {
            // 既存のonFileOperationのロジックを流用
            if (isNodeRuntime) {
              setNodeRuntimeOperationInProgress(true);
            }
            if (syncTerminalFileOperation) {
              await syncTerminalFileOperation(path, type, (content as string) || '', undefined);
            }
            setGitRefreshTrigger(prev => prev + 1);
          }}
          currentProjectName={currentProject?.name || ''}
          currentPaneIndex={fileSelectState.paneIdx}
        />
        <OperationWindow
          isVisible={isOperationWindowVisible}
          onClose={() => {
            setIsOperationWindowVisible(false);
            setFileSelectState(prev => ({ ...prev, open: false })); // openフラグのみリセット
          }}
          projectFiles={projectFiles}
          editors={editors}
          setEditors={setEditors}
          setFileSelectState={setFileSelectState}
          currentPaneIndex={fileSelectState.paneIdx}
        />
      </div>
    </>
  );
}
