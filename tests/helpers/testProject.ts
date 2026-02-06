/**
 * テストプロジェクトヘルパー
 * fileRepository に initialFileContents を事前ロードするユーティリティ
 */

import { fileRepository } from '@/engine/core/fileRepository';
import { initialFileContents } from '@/engine/initialFileContents';

// initialFileContents のノード型
type FileNode =
  | { type: 'file'; content: string }
  | { type: 'folder'; children: Record<string, FileNode> };

/**
 * initialFileContents のツリー構造をフラットなファイルエントリに変換する
 */
export function flattenInitialFiles(
  tree: Record<string, FileNode> = initialFileContents as Record<string, FileNode>,
  prefix = ''
): Array<{ path: string; content: string; type: 'file' | 'folder' }> {
  const entries: Array<{ path: string; content: string; type: 'file' | 'folder' }> = [];

  for (const [name, node] of Object.entries(tree)) {
    const path = `${prefix}/${name}`;

    if (node.type === 'file') {
      entries.push({ path, content: node.content, type: 'file' });
    } else if (node.type === 'folder') {
      entries.push({ path, content: '', type: 'folder' });
      if (node.children) {
        entries.push(...flattenInitialFiles(node.children, path));
      }
    }
  }

  return entries;
}

/**
 * fileRepository のシングルトンをリセットする
 */
export function resetRepository(): typeof fileRepository {
  const repo = fileRepository;
  // @ts-expect-error -- テスト用に内部状態を直接リセット
  repo.projects = new Map();
  // @ts-expect-error
  repo.files = new Map();
  // @ts-expect-error
  repo.listeners = new Set();
  return repo;
}

/**
 * テストプロジェクトを作成し、initialFileContents で事前ロードする
 * @returns { repo, projectId, projectName }
 */
export async function setupTestProject(
  projectName = 'TestProject'
): Promise<{
  repo: typeof fileRepository;
  projectId: string;
  projectName: string;
}> {
  const repo = resetRepository();
  await repo.init();

  const project = await repo.createEmptyProject(projectName);
  const entries = flattenInitialFiles();
  await repo.createFilesBulk(project.id, entries);

  return {
    repo,
    projectId: project.id,
    projectName: project.name,
  };
}
