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

import { proxy, useSnapshot } from 'valtio';

import type { Project } from '@/types';

/**
 * 単純化された Valtio プロジェクトストア
 * - `projectState` を直接参照（コンポーネント外）
 * - `useProjectSnapshot()` でコンポーネント内の購読
 * - `setCurrentProject()` で更新
 */
export const projectState = proxy({
  currentProject: null as Project | null,
  currentProjectId: null as string | null,
});

export const setCurrentProject = (project: Project | null) => {
  projectState.currentProject = project;
  projectState.currentProjectId = project?.id ?? null;
};

export const useProjectSnapshot = () => useSnapshot(projectState);

export const getCurrentProjectId = (): string | null => projectState.currentProjectId;
export const getCurrentProject = (): Project | null => projectState.currentProject;
