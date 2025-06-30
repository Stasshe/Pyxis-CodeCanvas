import { useState, useEffect } from 'react';
import { Project, ProjectFile, projectDB } from './database';
import { FileItem } from '@/types';

export const useProject = () => {
  const [currentProject, setCurrentProject] = useState<Project | null>(null);
  const [projectFiles, setProjectFiles] = useState<ProjectFile[]>([]);
  const [loading, setLoading] = useState(false);

  // プロジェクトファイルをFileItem形式に変換
  const convertToFileItems = (files: ProjectFile[]): FileItem[] => {
    console.log('Converting files:', files);
    const fileMap = new Map<string, FileItem>();
    const rootItems: FileItem[] = [];

    // まずすべてのファイルをMapに登録
    files.forEach(file => {
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
    files.forEach(file => {
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
    if (!currentProject) return;

    try {
      // 既存ファイルを探す
      const existingFile = projectFiles.find(f => f.path === path);
      
      if (existingFile) {
        // 既存ファイルを更新
        const updatedFile = { ...existingFile, content };
        await projectDB.saveFile(updatedFile);
        setProjectFiles(prev => prev.map(f => f.id === existingFile.id ? updatedFile : f));
      } else {
        // 新しいファイルを作成
        const newFile = await projectDB.createFile(currentProject.id, path, content, 'file');
        setProjectFiles(prev => [...prev, newFile]);
      }

      // プロジェクトの更新日時を更新
      await projectDB.saveProject(currentProject);
    } catch (error) {
      console.error('Failed to save file:', error);
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
  };
};
