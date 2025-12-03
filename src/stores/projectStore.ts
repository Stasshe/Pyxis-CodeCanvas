// src/stores/projectStore.ts
/**
 * プロジェクト状態のグローバルストア
 * 
 * NOTE: useProject()フックは各コンポーネントで独立したステートを持つため、
 * currentProjectがnullになりファイルが保存されない問題があった（PR130で発見）。
 * 
 * このストアは現在のプロジェクトIDとプロジェクト情報をグローバルに管理し、
 * 全てのコンポーネントが一貫したプロジェクト情報にアクセスできるようにする。
 * 
 * page.tsxでuseProject()を使用してプロジェクトをロードした際に、
 * このストアも同期的に更新される。
 */

import { create } from 'zustand';

import { Project } from '@/types';

interface ProjectStore {
  // 現在のプロジェクト
  currentProject: Project | null;
  currentProjectId: string | null;
  
  // アクション
  setCurrentProject: (project: Project | null) => void;
  
  // セレクター（便利関数）
  getProjectId: () => string | null;
}

export const useProjectStore = create<ProjectStore>((set, get) => ({
  currentProject: null,
  currentProjectId: null,
  
  setCurrentProject: (project: Project | null) => {
    set({
      currentProject: project,
      currentProjectId: project?.id || null,
    });
  },
  
  getProjectId: () => get().currentProjectId,
}));

/**
 * コンポーネント外からプロジェクトIDを取得するユーティリティ
 * useProjectStore.getState()を直接使用するよりも読みやすい
 */
export const getCurrentProjectId = (): string | null => {
  return useProjectStore.getState().currentProjectId;
};

/**
 * コンポーネント外から現在のプロジェクトを取得するユーティリティ
 */
export const getCurrentProject = (): Project | null => {
  return useProjectStore.getState().currentProject;
};
