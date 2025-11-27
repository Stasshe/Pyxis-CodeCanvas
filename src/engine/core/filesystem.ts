/**
 * filesystem.ts - 後方互換性のためのラッパー
 * 新しいアーキテクチャ（GitFileSystem, SyncManager）を内部的に使用
 * @deprecated 新規コードでは gitFileSystem, syncManager を直接使用してください
 */

import FS from '@isomorphic-git/lightning-fs';

import { gitFileSystem } from './gitFileSystem';

// 後方互換性のため、FSインスタンスをエクスポート
export const getFileSystem = (): FS => {
  return gitFileSystem.getFS();
};

export const initializeFileSystem = (): FS => {
  return gitFileSystem.init();
};

export const getProjectDir = (projectName: string): string => {
  return gitFileSystem.getProjectDir(projectName);
};

export const getAllFilesAndDirs = async (
  baseDir: string = '/projects'
): Promise<Array<{ path: string; content?: string; type: 'file' | 'folder' }>> => {
  // baseDirからプロジェクト名を抽出
  const projectName = baseDir.replace('/projects/', '').replace('/projects', '');
  if (!projectName) return [];

  return gitFileSystem.getAllFiles(projectName);
};

export const debugFileSystem = async (): Promise<void> => {
  return gitFileSystem.logFileSystem();
};

export const ensureDirectoryExists = async (fs: FS, dirPath: string): Promise<void> => {
  return gitFileSystem.ensureDirectory(dirPath);
};
