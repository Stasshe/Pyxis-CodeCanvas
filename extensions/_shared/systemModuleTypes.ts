/**
 * System Module Types for Extensions
 * 
 * 拡張機能が使用するシステムモジュールの詳細な型定義
 * この型定義は、src/engine/extensions/systemModuleTypes.ts の簡略版です
 * 拡張機能開発時に型補完を提供するために使用します
 */

/**
 * FileRepository - ファイル操作API
 */
export interface FileRepository {
  // プロジェクト操作
  createProject(name: string, description?: string): Promise<any>;
  getProject(projectId: string): Promise<any | null>;
  getProjects(): Promise<any[]>;
  updateProject(projectId: string, updates: Partial<any>): Promise<void>;
  deleteProject(projectId: string): Promise<void>;
  
  // ファイル操作
  createFile(projectId: string, path: string, content: string, language?: string): Promise<any>;
  getFile(fileId: string): Promise<any | null>;
  getProjectFiles(projectId: string): Promise<any[]>;
  updateFileContent(fileId: string, content: string): Promise<void>;
  deleteFile(fileId: string): Promise<void>;
  
  // 変更リスナー
  addChangeListener(listener: (event: any) => void): () => void;
}


/**
 * normalizeCjsEsm - CommonJS/ES Module変換ユーティリティ
 */
export interface NormalizeCjsEsmModule {
  normalizeCjsEsm(code: string): string;
  extractImports(code: string): Array<{
    source: string;
    specifiers: Array<{
      type: 'default' | 'named' | 'namespace';
      imported?: string;
      local: string;
    }>;
  }>;
  extractExports(code: string): Array<{
    type: 'named' | 'default' | 'all';
    exported?: string;
    local?: string;
    source?: string;
  }>;
}

/**
 * システムモジュールの型マップ
 */
export interface SystemModuleMap {
  fileRepository: FileRepository;
  normalizeCjsEsm: NormalizeCjsEsmModule;
}

/**
 * システムモジュール名
 */
export type SystemModuleName = keyof SystemModuleMap;

/**
 * 型安全なgetSystemModuleのヘルパー型
 */
export type GetSystemModule = <T extends SystemModuleName>(
  moduleName: T
) => Promise<SystemModuleMap[T]>;
