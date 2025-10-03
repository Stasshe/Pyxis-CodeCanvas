/**
 * ProjectDB - Wrapper class for backward compatibility
 * Uses FileRepository internally
 * @deprecated Use fileRepository directly for new code
 */

import type { Project, ProjectFile, ChatSpace, ChatSpaceMessage } from '@/types';
import { fileRepository } from './fileRepository';

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

  async createChatSpace(projectId: string, name: string): Promise<ChatSpace> {
    return fileRepository.createChatSpace(projectId, name);
  }

  async saveChatSpace(chatSpace: ChatSpace): Promise<void> {
    return fileRepository.saveChatSpace(chatSpace);
  }

  async getChatSpaces(projectId: string): Promise<ChatSpace[]> {
    return fileRepository.getChatSpaces(projectId);
  }

  async deleteChatSpace(chatSpaceId: string): Promise<void> {
    return fileRepository.deleteChatSpace(chatSpaceId);
  }

  async addMessageToChatSpace(
    chatSpaceId: string,
    message: Omit<ChatSpaceMessage, 'id'>
  ): Promise<ChatSpaceMessage> {
    return fileRepository.addMessageToChatSpace(chatSpaceId, message);
  }

  async updateChatSpaceSelectedFiles(chatSpaceId: string, selectedFiles: string[]): Promise<void> {
    return fileRepository.updateChatSpaceSelectedFiles(chatSpaceId, selectedFiles);
  }

  async renameChatSpace(chatSpaceId: string, newName: string): Promise<void> {
    return fileRepository.renameChatSpace(chatSpaceId, newName);
  }
}

export const projectDB = new ProjectDB();
