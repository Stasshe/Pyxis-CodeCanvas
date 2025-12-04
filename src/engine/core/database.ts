/**
 * ProjectDB - Wrapper class for backward compatibility
 * Uses FileRepository internally
 * @deprecated Use fileRepository directly for new code
 * 
 * NOTE: ChatSpace operations have been removed. Use chatStorageAdapter directly.
 */

import { fileRepository } from './fileRepository';

import type { Project, ProjectFile } from '@/types';

class ProjectDB {
  async init(): Promise<void> {
    return fileRepository.init();
  }

  async createProject(name: string, description?: string): Promise<Project> {
    return fileRepository.createProject(name, description);
  }

  async createEmptyProject(name: string, description?: string): Promise<Project> {
    return fileRepository.createEmptyProject(name, description);
  }

  async saveProject(project: Project): Promise<void> {
    return fileRepository.saveProject(project);
  }

  async updateProject(projectId: string, updates: Partial<Project>): Promise<void> {
    return fileRepository.updateProject(projectId, updates);
  }

  async getProjects(): Promise<Project[]> {
    return fileRepository.getProjects();
  }

  async deleteProject(projectId: string): Promise<void> {
    return fileRepository.deleteProject(projectId);
  }

  async createFile(
    projectId: string,
    path: string,
    content: string,
    type: 'file' | 'folder',
    isBufferArray?: boolean,
    bufferContent?: ArrayBuffer
  ): Promise<ProjectFile> {
    return fileRepository.createFile(projectId, path, content, type, isBufferArray, bufferContent);
  }

  async saveFile(file: ProjectFile): Promise<void> {
    return fileRepository.saveFile(file);
  }

  async getProjectFiles(projectId: string): Promise<ProjectFile[]> {
    return fileRepository.getProjectFiles(projectId);
  }

  async deleteFile(fileId: string): Promise<void> {
    return fileRepository.deleteFile(fileId);
  }

  async clearAIReview(projectId: string, filePath: string): Promise<void> {
    return fileRepository.clearAIReview(projectId, filePath);
  }
}

export const projectDB = new ProjectDB();
