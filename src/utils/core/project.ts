import { useState, useEffect } from 'react';
import { Project, ProjectFile } from '@/types/';
import { projectDB } from './database'; // プロジェクトデータベースのインポート
import { FileItem } from '@/types';
import { getFileSystem } from './filesystem';
import { GitCommands, syncProjectFiles, initializeFileSystem, debugFileSystem } from './filesystem';
import { LOCALSTORAGE_KEY } from '@/context/config';

// プロジェクト作成時のGit初期化とコミット
const initializeProjectGit = async (project: Project, files: ProjectFile[], convertToFileItems: (files: ProjectFile[]) => FileItem[]) => {
  try {
    console.log('Initializing Git for project:', project.name);
    console.log('Files to sync:', files.length);
    
    // ファイルシステムを確実に初期化
    initializeFileSystem();
    
    // 少し待機してファイルシステムの初期化を完了
    await new Promise(resolve => setTimeout(resolve, 200));
    
    // デバッグ: ファイルシステムの状態を確認
    await debugFileSystem();
    
    // ファイルをファイルシステムに同期
    const fileItems = convertToFileItems(files);
    console.log('Converted file items:', fileItems.length);
    
    const flatFiles = flattenFileItems(fileItems);
    console.log('Flattened files:', flatFiles.length, flatFiles.map(f => f.path));
    
    await syncProjectFiles(project.name, flatFiles);
    
    // ファイル同期後に十分な待機時間を設ける
    console.log('Waiting for filesystem sync to complete...');
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Git初期化
    const git = new GitCommands(project.name);
    try {
      await git.init();
      console.log('Git init completed');
      
      // Git初期化後も少し待機
      await new Promise(resolve => setTimeout(resolve, 200));
      
      // すべてのファイルをステージング
      try {
        const addResult = await git.add('.');
        console.log('Files staged:', addResult);
        
        // ステージング後も少し待機
        await new Promise(resolve => setTimeout(resolve, 200));
        
        // ステージ状態を確認
        const statusBeforeCommit = await git.status();
        console.log('Status before commit:', statusBeforeCommit);
        
        // 初期コミット
        const commitResult = await git.commit('Initial commit', {
          name: 'Pyxis User',
          email: 'user@pyxis.dev'
        });
        console.log('Initial commit completed:', commitResult);
        
        // コミット後の状態を確認
        const statusAfterCommit = await git.status();
        console.log('Status after commit:', statusAfterCommit);
        
        // ログを確認
        const logResult = await git.getFormattedLog(5);
        console.log('Log after commit:', logResult);
        
      } catch (commitError) {
        console.error('Initial commit failed:', commitError);
        
        // 詳細なエラー情報を表示
        console.log('Attempting to debug the issue...');
        try {
          const statusDebug = await git.status();
          console.log('Debug status:', statusDebug);
        } catch (debugError) {
          console.error('Status debug failed:', debugError);
        }
      }
    } catch (initError) {
      console.warn('Git initialization failed:', initError);
    }
    
    console.log('Git initialization process completed for project:', project.name);
  } catch (error) {
    console.error('Failed to initialize Git for project:', error);
    // Gitエラーでプロジェクト作成を失敗させない
  }
};

// FileItemの階層構造をフラットな配列に変換
const flattenFileItems = (items: FileItem[], basePath = ''): Array<{ path: string; content?: string; type: 'file' | 'folder' }> => {
  const result: Array<{ path: string; content?: string; type: 'file' | 'folder' }> = [];
  
  for (const item of items) {
    const fullPath = basePath === '' ? `/${item.name}` : `${basePath}/${item.name}`;
    
    result.push({
      path: fullPath,
      content: item.content,
      type: item.type
    });
    
    if (item.children && item.children.length > 0) {
      result.push(...flattenFileItems(item.children, fullPath));
    }
  }
  
  return result;
};

export const useProject = () => {
  const [currentProject, setCurrentProject] = useState<Project | null>(null);
  const [projectFiles, setProjectFiles] = useState<ProjectFile[]>([]);
  const [loading, setLoading] = useState(false);

  // プロジェクトファイルをFileItem形式に変換
  const convertToFileItems = (files: ProjectFile[]): FileItem[] => {

    // パスによる重複排除
    const uniqueFiles = files.reduce((acc, file) => {
      const existing = acc.find(f => f.path === file.path);
      if (!existing) {
        acc.push(file);
      } else {
        // より新しいファイルを保持
        if (file.updatedAt > existing.updatedAt) {
          const index = acc.indexOf(existing);
          acc[index] = file;
        }
      }
      return acc;
    }, [] as ProjectFile[]);
    
    const fileMap = new Map<string, FileItem>();
    const rootItems: FileItem[] = [];

    // まずすべてのファイルをMapに登録
    uniqueFiles.forEach(file => {
      const item: FileItem = {
        id: file.id,
        name: file.name,
        type: file.type,
        path: file.path,
        content: file.content,
        // バイナリファイル判定とデータを保持
        isBufferArray: file.isBufferArray,
        bufferContent: file.bufferContent,
        children: file.type === 'folder' ? [] : undefined,
      };
      fileMap.set(file.path, item);
    });

    // 階層構造を構築
    uniqueFiles.forEach(file => {
      const item = fileMap.get(file.path);
      if (!item) return;

      if (file.parentPath === '/' || !file.parentPath || file.path === '/') {
        rootItems.push(item);
      } else {
        const parent = fileMap.get(file.parentPath);
        if (parent && parent.children) {
          parent.children.push(item);
        } else {
          console.warn(`Parent not found for ${file.path}, parentPath: ${file.parentPath}`);
        }
      }
    });

    //console.log('Root items:', rootItems);

    // フォルダを先に、ファイルを後にソート
    const sortItems = (items: FileItem[]): FileItem[] => {
      return items.sort((a, b) => {
        if (a.type !== b.type) {
          return a.type === 'folder' ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      }).map(item => ({
        ...item,
        children: item.children ? sortItems(item.children) : undefined,
      }));
    };

    return sortItems(rootItems);
  };

  // プロジェクトを読み込み
  const loadProject = async (project: Project) => {
    setLoading(true);
    try {
      await projectDB.init();
      // console.log('[loadProject] Getting project files...');
      const files = await projectDB.getProjectFiles(project.id);
      // console.log('[loadProject] Received files:', files.length, files);
      
      setCurrentProject(project);
      setProjectFiles(files);

      // デバッグ: ファイル変換前後でコンテンツが保持されているかチェック
      const convertedFiles = convertToFileItems(files);
      // console.log('[loadProject] Converted files:', convertedFiles.length);
      convertedFiles.forEach(file => {
        if (file.type === 'file' && file.content) {
          console.log('[loadProject] File with content:', file.path, 'contentLength:', file.content.length);
        }
      });

      // console.log('[loadProject] Project files after loading:', files);

      // Git初期化状態をチェック
      try {
        const git = new GitCommands(project.name);
        const currentBranch = await git.getCurrentBranch();
        
        // Git初期化されていない場合は初期化を実行
        if (currentBranch === '(no git)') {
          console.log('Git not initialized for project:', project.name, 'Initializing...');
          await initializeProjectGit(project, files, convertToFileItems);
        }
      } catch (gitError) {
        console.warn('Git check failed, attempting initialization:', gitError);
        try {
          await initializeProjectGit(project, files, convertToFileItems);
        } catch (initError) {
          console.warn('Git initialization failed (non-critical):', initError);
        }
      }
    } catch (error) {
      console.error('Failed to load project:', error);
    } finally {
      setLoading(false);
    }
  };

  // ファイルを保存
  const saveFile = async (path: string, content: string) => {
    if (!currentProject) {
      console.error('[saveFile] No current project');
      return;
    }

    console.log('[saveFile] Starting save:', { 
      path, 
      contentLength: content.length, 
      projectId: currentProject.id,
      projectName: currentProject.name 
    });

    try {
      // データベースが初期化されていることを確認
      await projectDB.init();
      
      // 既存ファイルを探す
      const existingFile = projectFiles.find(f => f.path === path);
      console.log('[saveFile] Existing file found:', !!existingFile);
      
      if (existingFile) {
        // 既存ファイルを更新
        const updatedFile = { ...existingFile, content, updatedAt: new Date() };
        console.log('[saveFile] Updating existing file:', updatedFile.id);
        await projectDB.saveFile(updatedFile);
        
        // 内容が実際に変わった場合のみ状態を更新
        if (existingFile.content !== content) {
          setProjectFiles(prev => prev.map(f => f.id === existingFile.id ? updatedFile : f));
          console.log('[saveFile] File state updated');
        } else {
          console.log('[saveFile] File content unchanged, skipping state update');
        }
      } else {
        // 新しいファイルを作成
        console.log('[saveFile] Creating new file');
        const newFile = await projectDB.createFile(currentProject.id, path, content, 'file');
        setProjectFiles(prev => [...prev, newFile]);
        console.log('[saveFile] New file created:', newFile.id);
      }

      // ファイルシステムに同期（Git変更検知のため）
      try {
        const { syncFileToFileSystem } = await import('./filesystem');
        await syncFileToFileSystem(currentProject.name, path, content, existingFile ? 'update' : 'create');
        console.log('[saveFile] Synced to filesystem');
      } catch (syncError) {
        console.warn('[saveFile] Filesystem sync failed (non-critical):', syncError);
      }

      console.log('[saveFile] File save completed successfully');
    } catch (error) {
      console.error('[saveFile] Failed to save file:', error);
      throw error;
    }
  };

  // ファイルを作成
  const createFile = async (path: string, type: 'file' | 'folder', content = '') => {
    if (!currentProject) return;

    try {
      console.log('[createFile] Creating file:', { path, type, contentLength: content.length });
      const newFile = await projectDB.createFile(currentProject.id, path, content, type);
      setProjectFiles(prev => [...prev, newFile]);
      
      // ファイルシステムに同期（Git変更検知のため）
      if (type === 'file') {
        try {
          const { syncFileToFileSystem } = await import('./filesystem');
          await syncFileToFileSystem(currentProject.name, path, content, 'create');
          console.log('[createFile] Synced to filesystem for Git detection');
        } catch (syncError) {
          console.warn('[createFile] Filesystem sync failed (non-critical):', syncError);
        }
      }
      
      console.log('[createFile] File created successfully:', newFile.id);
      return newFile;
    } catch (error) {
      console.error('Failed to create file:', error);
      throw error;
    }
  };

  // ファイルを削除
  const deleteFile = async (fileId: string) => {
    if (!currentProject) return;

    try {
      // 削除対象ファイルの情報を取得
      const fileToDelete = projectFiles.find(f => f.id === fileId);
      console.log('[deleteFile] Deleting file:', fileToDelete?.path);
      
      await projectDB.deleteFile(fileId);
      setProjectFiles(prev => prev.filter(f => f.id !== fileId));
      
      // ファイルシステムからも削除（Git変更検知のため）
        if (fileToDelete && fileToDelete.type === 'file') {
          try {
            const { syncFileToFileSystem } = await import('./filesystem');
            // ファイルを物理的に削除してGit検知を有効にする
            await syncFileToFileSystem(currentProject.name, fileToDelete.path, null, 'delete');
            console.log('[deleteFile] File physically deleted from filesystem for Git detection');
          } catch (syncError) {
            console.warn('[deleteFile] Filesystem deletion failed (non-critical):', syncError);
          }
        }
      
      console.log('[deleteFile] File deleted successfully');
    } catch (error) {
      console.error('Failed to delete file:', error);
      throw error;
    }
  };

  // プロジェクトファイルをリフレッシュ（ターミナル操作後の同期用）
  const refreshProjectFiles = async () => {
    if (!currentProject) return;

    try {
      const files = await projectDB.getProjectFiles(currentProject.id);
      setProjectFiles(files);
    } catch (error) {
      console.error('Failed to refresh project files:', error);
    }
  };

  // ターミナルからのファイル操作を同期
  const syncTerminalFileOperation = async (path: string, type: 'file' | 'folder' | 'delete', content: string = '', bufferContent?: ArrayBuffer) => {
    if (!currentProject) {
      console.log('[syncTerminalFileOperation] No current project');
      return;
    }

    console.log('[syncTerminalFileOperation] Starting:', { path, type, content, projectName: currentProject.name });

    // 「.」パスはプロジェクト更新通知のためのダミー操作
    // 実際のファイル作成は行わず、プロジェクトリフレッシュのみ実行
    if (path === '.') {
      console.log('[syncTerminalFileOperation] Dummy project refresh operation detected, skipping file operations');
      await refreshProjectFiles();
      return;
    }

    try {
      if (type === 'delete') {
        console.log('[syncTerminalFileOperation] Processing delete operation for:', path);
        // ファイルまたはフォルダを削除
        const files = await projectDB.getProjectFiles(currentProject.id);
        const fileToDelete = files.find(f => f.path === path);
        console.log('[syncTerminalFileOperation] File to delete found:', !!fileToDelete, fileToDelete?.path);
        if (fileToDelete) {
          console.log('[syncTerminalFileOperation] Deleting file from DB:', fileToDelete.id);
          await projectDB.deleteFile(fileToDelete.id);
          if (fileToDelete.type === 'folder') {
            const childFiles = files.filter(f => f.path.startsWith(path + '/'));
            console.log('[syncTerminalFileOperation] Deleting child files:', childFiles.length);
            for (const child of childFiles) {
              await projectDB.deleteFile(child.id);
            }
          }
          
          // ファイルシステムからも削除（Git変更検知のため）
          if (fileToDelete.type === 'file') {
            try {
              const { syncFileToFileSystem } = await import('./filesystem');
              await syncFileToFileSystem(currentProject.name, path, null, 'delete');
              console.log('[syncTerminalFileOperation] File physically deleted from filesystem for Git detection');
              
              // 追加的なGitキャッシュフラッシュ（削除検知のため）
              try {
                const fs = getFileSystem();
                if (fs && (fs as any).sync) {
                  await (fs as any).sync();
                  console.log('[syncTerminalFileOperation] Additional Git cache flush completed');
                  
                  // Gitが削除を認識するまで少し待機
                  await new Promise(resolve => setTimeout(resolve, 300));
                }
              } catch (flushError) {
                console.warn('[syncTerminalFileOperation] Additional Git cache flush failed:', flushError);
              }
            } catch (syncError) {
              console.warn('[syncTerminalFileOperation] Filesystem deletion failed (non-critical):', syncError);
            }
          }
          console.log('[syncTerminalFileOperation] Delete operation completed for:', path);
        } else {
          console.log('[syncTerminalFileOperation] File not found in DB for deletion:', path);
        }
      } else {
        // ファイルまたはフォルダを作成/更新
        const existingFile = projectFiles.find(f => f.path === path);
        if (existingFile) {
          // 既存ファイルを更新
          console.log('[syncTerminalFileOperation] Updating existing file:', existingFile);
          let updatedFile;
          if (bufferContent) {
            updatedFile = { ...existingFile, content: '', isBufferArray: true, bufferContent, updatedAt: new Date() };
          } else {
            updatedFile = { ...existingFile, content, isBufferArray: false, bufferContent: undefined, updatedAt: new Date() };
          }
          await projectDB.saveFile(updatedFile);
          console.log('[syncTerminalFileOperation] File updated in DB');
          // ファイルシステムにも同期（Git変更検知のため）
          if (type === 'file') {
            try {
              const { syncFileToFileSystem } = await import('./filesystem');
              await syncFileToFileSystem(currentProject.name, path, content, 'update');
              console.log('[syncTerminalFileOperation] File updated in filesystem for Git detection');
            } catch (syncError) {
              console.warn('[syncTerminalFileOperation] Filesystem update failed (non-critical):', syncError);
            }
          }
        } else {
          // 新しいファイル/フォルダを作成
          console.log('[syncTerminalFileOperation] Creating new file/folder:', { path, type });
          if (bufferContent) {
            const newFile = await projectDB.createFile(currentProject.id, path, '', type, true, bufferContent);
            console.log('[syncTerminalFileOperation] File/folder created in DB with ID:', newFile.id);
          } else {
            const newFile = await projectDB.createFile(currentProject.id, path, content, type, false);
            console.log('[syncTerminalFileOperation] File/folder created in DB with ID:', newFile.id);
          }
          // ファイルシステムにも同期（Git変更検知のため）
          if (type === 'file' || type === 'folder') {
            const existingFile = projectFiles.find(f => f.path === path);
            if (existingFile) {
              console.log(`[syncTerminalFileOperation] Skipping creation: ${path} already exists.`);
              return; // 既に存在する場合はスキップ
            }
            try {
              const { syncFileToFileSystem } = await import('./filesystem');
              await syncFileToFileSystem(currentProject.name, path, content, 'create');
              console.log('[syncTerminalFileOperation] File created in filesystem for Git detection');
            } catch (syncError) {
              console.warn('[syncTerminalFileOperation] Filesystem creation failed (non-critical):', syncError);
            }
          }
          // 作成を確認（プロジェクトファイル一覧から確認）
          console.log('[syncTerminalFileOperation] Verifying file creation...');
        }
      }

      // プロジェクトファイルをリフレッシュ（遅延なし - バッチ処理時の高速化）
      console.log('[syncTerminalFileOperation] Refreshing project files...');
      await refreshProjectFiles();
      console.log('[syncTerminalFileOperation] Sync completed, files count:', projectFiles.length);
      
    } catch (error) {
      console.error('[syncTerminalFileOperation] Failed to sync terminal file operation:', error);
      throw error; // エラーを上位に伝播して問題を明確にする
    }
  };

  // 新規プロジェクトを作成（Git初期化付き）
  const createProject = async (name: string, description?: string) => {
    try {
      setLoading(true);
      await projectDB.init();
      
      // プロジェクトを作成
      console.log('[createProject] Creating new project:', name);
      const newProject = await projectDB.createProject(name, description);
      console.log('[createProject] Project created:', newProject);
      
      // ファイルを取得
      console.log('[createProject] Getting files for new project...');
      const files = await projectDB.getProjectFiles(newProject.id);
      console.log('[createProject] Files retrieved:', files.length, files);
      
      // プロジェクトを設定
      setCurrentProject(newProject);
      setProjectFiles(files);
      
      // Git初期化と初期コミット
      await initializeProjectGit(newProject, files, convertToFileItems);
      
      // 初期チャットスペースを作成
      try {
        await projectDB.createChatSpace(newProject.id, `${newProject.name} - 初期チャット`);
        console.log('[createProject] Initial chat space created');
      } catch (error) {
        console.warn('[createProject] Failed to create initial chat space:', error);
        // チャットスペース作成の失敗はプロジェクト作成を妨げない
      }
      
      return newProject;
    } catch (error) {
      console.error('Failed to create project:', error);
      throw error;
    } finally {
      setLoading(false);
    }
  };

  // 最近のプロジェクトを保存
  const saveRecentProject = (project: Project) => {
    try {
      const recentProjectsStr = localStorage.getItem(LOCALSTORAGE_KEY.RECENT_PROJECTS);
      let recentProjects: Project[] = [];
      
      if (recentProjectsStr) {
        recentProjects = JSON.parse(recentProjectsStr);
      }
      
      // 既存のプロジェクトを除外
      recentProjects = recentProjects.filter(p => p.id !== project.id);
      
      // 新しいプロジェクトを先頭に追加
      recentProjects.unshift(project);
      
      // 最大10件まで保持
      recentProjects = recentProjects.slice(0, 10);
      
      localStorage.setItem(LOCALSTORAGE_KEY.RECENT_PROJECTS, JSON.stringify(recentProjects));
    } catch (error) {
      console.error('Failed to save recent project:', error);
    }
  };

  // 最近のプロジェクトを取得
  const getRecentProjects = (): Project[] => {
    try {
      const recentProjectsStr = localStorage.getItem(LOCALSTORAGE_KEY.RECENT_PROJECTS);
      if (recentProjectsStr) {
        return JSON.parse(recentProjectsStr);
      }
    } catch (error) {
      console.error('Failed to get recent projects:', error);
    }
    return [];
  };

  // プロジェクトがロードされたら履歴に追加
  useEffect(() => {
    if (currentProject) {
      saveRecentProject(currentProject);
    }
  }, [currentProject]);

  // デフォルトプロジェクトを読み込み（初回起動時）
  useEffect(() => {
    const initProject = async () => {
      try {
        await projectDB.init();
        const projects = await projectDB.getProjects();
        
        // 最近のプロジェクトを確認
        const recentProjects = getRecentProjects();
        const lastProject = recentProjects[0];
        
        if (lastProject && projects.find(p => p.id === lastProject.id)) {
          // 最後に開いたプロジェクトが存在すれば、それを読み込む
          await loadProject(lastProject);
        } else if (projects.length > 0) {
          // 最後に開いたプロジェクトがない場合は最初のプロジェクトを読み込む
          await loadProject(projects[0]);
        } else {
          // デフォルトプロジェクトを作成
          setLoading(true);
          try {
            console.log('[initProject] Creating default project...');
            const defaultProject = await projectDB.createProject(
              'Welcome-Project',
              'Pyxis エディターへようこそ！'
            );
            console.log('[initProject] Default project created:', defaultProject);
            
            // ファイルを取得
            console.log('[initProject] Getting files for default project...');
            const files = await projectDB.getProjectFiles(defaultProject.id);
            console.log('[initProject] Default project files:', files.length, files);
            
            // プロジェクトを設定
            setCurrentProject(defaultProject);
            setProjectFiles(files);
            
            // Git初期化と初期コミット
            console.log('[initProject] Starting Git initialization...');
            await initializeProjectGit(defaultProject, files, convertToFileItems);
          } finally {
            setLoading(false);
          }
        }
      } catch (error) {
        console.error('Failed to initialize project:', error);
        setLoading(false);
      }
    };

    initProject();
  }, []);

  // AIレビューをクリアする
  const clearAIReview = async (filePath: string): Promise<void> => {
    if (!currentProject) {
      throw new Error('No project selected');
    }

    try {
      await projectDB.clearAIReview(currentProject.id, filePath);
      
      // プロジェクトファイルを再読み込み
      const files = await projectDB.getProjectFiles(currentProject.id);
      setProjectFiles(files);
    } catch (error) {
      console.error('Failed to clear AI review:', error);
      throw error;
    }
  };

  return {
    currentProject,
    projectFiles: convertToFileItems(projectFiles),
    loading,
    loadProject,
    saveFile,
    createFile,
    deleteFile,
    createProject,
    refreshProjectFiles,
    syncTerminalFileOperation,
    clearAIReview,
  };
};