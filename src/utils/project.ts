import { useState, useEffect } from 'react';
import { Project, ProjectFile, projectDB } from './database';
import { FileItem } from '@/types';
import { GitCommands, syncProjectFiles } from './filesystem';

// プロジェクト作成時のGit初期化とコミット
const initializeProjectGit = async (project: Project, files: ProjectFile[], convertToFileItems: (files: ProjectFile[]) => FileItem[]) => {
  try {
    console.log('Initializing Git for project:', project.name);
    
    // ファイルをファイルシステムに同期
    const fileItems = convertToFileItems(files);
    const flatFiles = flattenFileItems(fileItems);
    await syncProjectFiles(project.name, flatFiles);
    
    // Git初期化
    const git = new GitCommands(project.name);
    try {
      await git.init();
      console.log('Git init completed');
      
      // すべてのファイルをステージング
      try {
        const addResult = await git.add('.');
        console.log('Files staged:', addResult);
        
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
        // エラーでも続行する
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
    console.log('Converting files:', files);
    
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
    
    console.log('Unique files after deduplication:', uniqueFiles);
    
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

    console.log('Root items:', rootItems);

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
      const files = await projectDB.getProjectFiles(project.id);
      setCurrentProject(project);
      setProjectFiles(files);
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
        setProjectFiles(prev => prev.map(f => f.id === existingFile.id ? updatedFile : f));
        console.log('[saveFile] File updated successfully');
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
        await syncFileToFileSystem(currentProject.name, path, content);
        console.log('[saveFile] Synced to filesystem');
      } catch (syncError) {
        console.warn('[saveFile] Filesystem sync failed (non-critical):', syncError);
      }

      // プロジェクトの更新日時を更新
      const updatedProject = { ...currentProject, updatedAt: new Date() };
      await projectDB.saveProject(updatedProject);
      setCurrentProject(updatedProject);
      console.log('[saveFile] Project updated');
    } catch (error) {
      console.error('[saveFile] Failed to save file:', error);
      throw error;
    }
  };

  // ファイルを作成
  const createFile = async (path: string, type: 'file' | 'folder', content = '') => {
    if (!currentProject) return;

    try {
      const newFile = await projectDB.createFile(currentProject.id, path, content, type);
      setProjectFiles(prev => [...prev, newFile]);
      return newFile;
    } catch (error) {
      console.error('Failed to create file:', error);
      throw error;
    }
  };

  // ファイルを削除
  const deleteFile = async (fileId: string) => {
    try {
      await projectDB.deleteFile(fileId);
      setProjectFiles(prev => prev.filter(f => f.id !== fileId));
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
  const syncTerminalFileOperation = async (path: string, type: 'file' | 'folder' | 'delete', content = '') => {
    if (!currentProject) {
      console.log('[syncTerminalFileOperation] No current project');
      return;
    }

    console.log('[syncTerminalFileOperation] Starting:', { path, type, content, projectName: currentProject.name });

    try {
      if (type === 'delete') {
        // ファイルまたはフォルダを削除
        const fileToDelete = projectFiles.find(f => f.path === path);
        if (fileToDelete) {
          console.log('[syncTerminalFileOperation] Deleting file:', fileToDelete);
          await projectDB.deleteFile(fileToDelete.id);
          
          // 子ファイルも削除（フォルダの場合）
          if (fileToDelete.type === 'folder') {
            const childFiles = projectFiles.filter(f => f.path.startsWith(path + '/'));
            console.log('[syncTerminalFileOperation] Deleting child files:', childFiles);
            for (const child of childFiles) {
              await projectDB.deleteFile(child.id);
            }
          }
        }
      } else {
        // ファイルまたはフォルダを作成/更新
        const existingFile = projectFiles.find(f => f.path === path);
        
        if (existingFile) {
          // 既存ファイルを更新
          console.log('[syncTerminalFileOperation] Updating existing file:', existingFile);
          const updatedFile = { ...existingFile, content };
          await projectDB.saveFile(updatedFile);
        } else {
          // 新しいファイル/フォルダを作成
          console.log('[syncTerminalFileOperation] Creating new file/folder:', { path, type });
          await projectDB.createFile(currentProject.id, path, content, type);
          console.log('[syncTerminalFileOperation] File/folder created in DB');
        }
      }

      // プロジェクトファイルをリフレッシュ
      console.log('[syncTerminalFileOperation] Refreshing project files');
      await refreshProjectFiles();
      console.log('[syncTerminalFileOperation] Sync completed');
      
    } catch (error) {
      console.error('[syncTerminalFileOperation] Failed to sync terminal file operation:', error);
    }
  };

  // 新規プロジェクトを作成（Git初期化付き）
  const createProject = async (name: string, description?: string) => {
    try {
      setLoading(true);
      await projectDB.init();
      
      // プロジェクトを作成
      const newProject = await projectDB.createProject(name, description);
      
      // ファイルを取得
      const files = await projectDB.getProjectFiles(newProject.id);
      
      // プロジェクトを設定
      setCurrentProject(newProject);
      setProjectFiles(files);
      
      // Git初期化と初期コミット
      await initializeProjectGit(newProject, files, convertToFileItems);
      
      return newProject;
    } catch (error) {
      console.error('Failed to create project:', error);
      throw error;
    } finally {
      setLoading(false);
    }
  };

  // デフォルトプロジェクトを読み込み（初回起動時）
  useEffect(() => {
    const initProject = async () => {
      try {
        await projectDB.init();
        const projects = await projectDB.getProjects();
        
        if (projects.length > 0) {
          await loadProject(projects[0]);
        } else {
          // デフォルトプロジェクトを作成
          const defaultProject = await projectDB.createProject(
            'ウェルカムプロジェクト',
            'Pyxis エディターへようこそ！'
          );
          await loadProject(defaultProject);
        }
      } catch (error) {
        console.error('Failed to initialize project:', error);
      }
    };

    initProject();
  }, []);

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
  };
};
