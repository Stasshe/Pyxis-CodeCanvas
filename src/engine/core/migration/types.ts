import type { AIReviewHistoryEntry, AIReviewStatus, ChatSpace } from '@/types';

export interface LegacyProject {
  id: string;
  name: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface LegacyMapping extends LegacyProject {
  rootPath: string;
}

export interface LegacyFile {
  id: string;
  projectId: string;
  path: string;
  type: 'file' | 'folder';
  content?: string;
  isBufferArray?: boolean;
  bufferContent?: ArrayBuffer;
  aiReviewStatus?: AIReviewStatus;
  aiReviewComments?: string;
  aiAgentCode?: string;
  aiAgentSuggestedContent?: string;
  aiAgentOriginalSnapshot?: string;
  isAiAgentReview?: boolean;
  aiReviewHistory?: readonly AIReviewHistoryEntry[];
}

export interface LegacyFileReference {
  key: IDBValidKey;
  id: string;
  projectId: string;
  path: string;
  type: 'file' | 'folder';
  hasReview: boolean;
}

export type LegacyChatSpace = Omit<ChatSpace, 'rootPath'> & { projectId: string };

export interface LegacyCache {
  key: string;
  value: string | ArrayBuffer;
  mtime: number;
  isDir: boolean;
}

export interface MigrationState {
  id: 'opfs-v1';
  phase: 'copying' | 'cleanup' | 'complete';
  mappings: LegacyMapping[];
}
