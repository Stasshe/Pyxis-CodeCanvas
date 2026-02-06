import { describe, it, expect, beforeEach } from 'vitest';
import { FileRepository } from '@/engine/core/fileRepository/inmemory';
import { resetRepository } from '@tests/helpers/testProject';

/**
 * InMemoryFileRepository のテスト
 * Map ベースのファイルリポジトリが正しく動作することを検証
 */

describe('InMemoryFileRepository', () => {
  let repo: InstanceType<typeof FileRepository>;

  beforeEach(() => {
    repo = resetRepository();
  });

  // ==================== init / close ====================

  describe('init / close', () => {
    it('init は何もせず正常終了する', async () => {
      await expect(repo.init()).resolves.toBeUndefined();
    });

    it('close は何もせず正常終了する', async () => {
      await expect(repo.close()).resolves.toBeUndefined();
    });
  });

  // ==================== プロジェクト操作 ====================

  describe('createProject', () => {
    it('プロジェクトを作成できる', async () => {
      const project = await repo.createProject('TestProject', 'A test');
      expect(project.name).toBe('TestProject');
      expect(project.description).toBe('A test');
      expect(project.id).toMatch(/^project_/);
      expect(project.createdAt).toBeInstanceOf(Date);
    });

    it('同名プロジェクトは既存を返す', async () => {
      const first = await repo.createProject('Dup');
      const second = await repo.createProject('Dup');
      expect(first.id).toBe(second.id);
    });
  });

  describe('createEmptyProject', () => {
    it('空プロジェクトを作成できる', async () => {
      const project = await repo.createEmptyProject('Empty');
      expect(project.name).toBe('Empty');
    });

    it('同名プロジェクトでエラーになる', async () => {
      await repo.createEmptyProject('Dup');
      await expect(repo.createEmptyProject('Dup')).rejects.toThrow('既に存在します');
    });
  });

  describe('getProjects', () => {
    it('全プロジェクトを取得できる', async () => {
      await repo.createProject('A');
      await repo.createProject('B');
      const projects = await repo.getProjects();
      expect(projects).toHaveLength(2);
      expect(projects.map(p => p.name).sort()).toEqual(['A', 'B']);
    });
  });

  describe('updateProject', () => {
    it('プロジェクトを更新できる', async () => {
      const project = await repo.createProject('Old');
      await repo.updateProject(project.id, { name: 'New' });
      const [updated] = await repo.getProjects();
      expect(updated.name).toBe('New');
    });

    it('存在しないプロジェクトでエラー', async () => {
      await expect(repo.updateProject('nonexistent', { name: 'X' })).rejects.toThrow('not found');
    });
  });

  describe('deleteProject', () => {
    it('プロジェクトと関連ファイルを削除する', async () => {
      const project = await repo.createProject('ToDelete');
      await repo.createFile(project.id, '/main.ts', 'code', 'file');
      await repo.deleteProject(project.id);

      const projects = await repo.getProjects();
      expect(projects).toHaveLength(0);

      const files = await repo.getProjectFiles(project.id);
      expect(files).toHaveLength(0);
    });
  });

  // ==================== ファイル操作 ====================

  describe('createFile', () => {
    let projectId: string;

    beforeEach(async () => {
      const project = await repo.createProject('FileTest');
      projectId = project.id;
    });

    it('ファイルを作成できる', async () => {
      const file = await repo.createFile(projectId, '/hello.ts', 'console.log("hi")', 'file');
      expect(file.path).toBe('/hello.ts');
      expect(file.content).toBe('console.log("hi")');
      expect(file.type).toBe('file');
      expect(file.projectId).toBe(projectId);
    });

    it('フォルダを作成できる', async () => {
      const folder = await repo.createFile(projectId, '/src', '', 'folder');
      expect(folder.type).toBe('folder');
      expect(folder.path).toBe('/src');
    });

    it('親ディレクトリを自動作成する', async () => {
      await repo.createFile(projectId, '/deep/nested/file.ts', 'content', 'file');
      const files = await repo.getProjectFiles(projectId);
      const paths = files.map(f => f.path).sort();
      expect(paths).toContain('/deep');
      expect(paths).toContain('/deep/nested');
      expect(paths).toContain('/deep/nested/file.ts');
    });

    it('既存ファイルは上書きされる', async () => {
      await repo.createFile(projectId, '/app.ts', 'v1', 'file');
      const updated = await repo.createFile(projectId, '/app.ts', 'v2', 'file');
      expect(updated.content).toBe('v2');

      const files = await repo.getProjectFiles(projectId);
      const appFiles = files.filter(f => f.path === '/app.ts');
      expect(appFiles).toHaveLength(1);
    });

    it('パスは自動的に正規化される', async () => {
      const file = await repo.createFile(projectId, 'no-leading-slash.ts', 'x', 'file');
      expect(file.path).toBe('/no-leading-slash.ts');
    });

    it('バイナリファイルを作成できる', async () => {
      const buf = new ArrayBuffer(8);
      const file = await repo.createFile(projectId, '/image.png', '', 'file', true, buf);
      expect(file.isBufferArray).toBe(true);
      expect(file.bufferContent).toBe(buf);
      expect(file.content).toBe('');
    });
  });

  describe('saveFile', () => {
    it('ファイルを保存して updatedAt が更新される', async () => {
      const project = await repo.createProject('SaveTest');
      const file = await repo.createFile(project.id, '/test.ts', 'before', 'file');
      const oldUpdated = file.updatedAt;

      // 少し待ってから更新
      await new Promise(r => setTimeout(r, 10));
      file.content = 'after';
      await repo.saveFile(file);

      const retrieved = await repo.getFileByPath(project.id, '/test.ts');
      expect(retrieved?.content).toBe('after');
      expect(retrieved!.updatedAt.getTime()).toBeGreaterThanOrEqual(oldUpdated.getTime());
    });
  });

  describe('saveFileByPath', () => {
    it('既存ファイルを更新する', async () => {
      const project = await repo.createProject('SaveByPath');
      await repo.createFile(project.id, '/x.ts', 'old', 'file');
      await repo.saveFileByPath(project.id, '/x.ts', 'new');

      const file = await repo.getFileByPath(project.id, '/x.ts');
      expect(file?.content).toBe('new');
    });

    it('存在しないファイルを新規作成する', async () => {
      const project = await repo.createProject('SaveByPathNew');
      await repo.saveFileByPath(project.id, '/new.ts', 'content');

      const file = await repo.getFileByPath(project.id, '/new.ts');
      expect(file).not.toBeNull();
      expect(file?.content).toBe('content');
    });
  });

  describe('getProjectFiles', () => {
    it('不正な projectId でエラー', async () => {
      await expect(repo.getProjectFiles('')).rejects.toThrow('Invalid projectId');
    });

    it('プロジェクトの全ファイルを取得する', async () => {
      const project = await repo.createProject('GetFiles');
      await repo.createFile(project.id, '/a.ts', '1', 'file');
      await repo.createFile(project.id, '/b.ts', '2', 'file');

      const files = await repo.getProjectFiles(project.id);
      expect(files).toHaveLength(2);
    });
  });

  describe('getFileByPath', () => {
    it('パスでファイルを取得できる', async () => {
      const project = await repo.createProject('GetByPath');
      await repo.createFile(project.id, '/index.ts', 'export {}', 'file');

      const file = await repo.getFileByPath(project.id, '/index.ts');
      expect(file?.content).toBe('export {}');
    });

    it('存在しないパスは null を返す', async () => {
      const project = await repo.createProject('NoFile');
      const file = await repo.getFileByPath(project.id, '/nonexistent.ts');
      expect(file).toBeNull();
    });
  });

  describe('getFilesByPrefix', () => {
    it('プレフィックスでフィルタできる', async () => {
      const project = await repo.createProject('Prefix');
      await repo.createFile(project.id, '/src/a.ts', '1', 'file');
      await repo.createFile(project.id, '/src/b.ts', '2', 'file');
      await repo.createFile(project.id, '/lib/c.ts', '3', 'file');

      // /src フォルダ自体 + /src/a.ts + /src/b.ts = 3
      const srcFiles = await repo.getFilesByPrefix(project.id, '/src');
      expect(srcFiles).toHaveLength(3);
      expect(srcFiles.every(f => f.path.startsWith('/src'))).toBe(true);

      const libFiles = await repo.getFilesByPrefix(project.id, '/lib');
      expect(libFiles).toHaveLength(2); // /lib + /lib/c.ts
    });
  });

  describe('createFilesBulk', () => {
    it('複数ファイルを一括作成できる', async () => {
      const project = await repo.createProject('Bulk');
      const entries = [
        { path: '/a.ts', content: 'a', type: 'file' as const },
        { path: '/b.ts', content: 'b', type: 'file' as const },
        { path: '/src', content: '', type: 'folder' as const },
      ];

      const created = await repo.createFilesBulk(project.id, entries);
      expect(created).toHaveLength(3);

      const files = await repo.getProjectFiles(project.id);
      expect(files).toHaveLength(3);
    });
  });

  describe('deleteFile', () => {
    it('ファイルを削除できる', async () => {
      const project = await repo.createProject('Del');
      const file = await repo.createFile(project.id, '/target.ts', 'x', 'file');
      await repo.deleteFile(file.id);

      const remaining = await repo.getProjectFiles(project.id);
      expect(remaining.find(f => f.path === '/target.ts')).toBeUndefined();
    });

    it('フォルダ削除で配下も消える', async () => {
      const project = await repo.createProject('DelFolder');
      const folder = await repo.createFile(project.id, '/dir', '', 'folder');
      await repo.createFile(project.id, '/dir/child.ts', 'c', 'file');
      await repo.createFile(project.id, '/dir/deep/nested.ts', 'n', 'file');
      await repo.createFile(project.id, '/keep.ts', 'k', 'file');

      await repo.deleteFile(folder.id);

      const remaining = await repo.getProjectFiles(project.id);
      expect(remaining).toHaveLength(1);
      expect(remaining[0].path).toBe('/keep.ts');
    });

    it('存在しないファイルでエラー', async () => {
      await expect(repo.deleteFile('nonexistent')).rejects.toThrow('not found');
    });
  });

  describe('clearAIReview', () => {
    it('AI レビュー状態をクリアする', async () => {
      const project = await repo.createProject('AIReview');
      const file = await repo.createFile(project.id, '/reviewed.ts', 'code', 'file');

      // レビュー状態をセット
      file.aiReviewStatus = 'pending';
      file.aiReviewComments = 'needs fix';
      await repo.saveFile(file);

      await repo.clearAIReview(project.id, '/reviewed.ts');

      const updated = await repo.getFileByPath(project.id, '/reviewed.ts');
      expect(updated?.aiReviewStatus).toBeUndefined();
      expect(updated?.aiReviewComments).toBeUndefined();
    });
  });

  // ==================== イベントリスナー ====================

  describe('addChangeListener', () => {
    it('ファイル作成イベントを受け取る', async () => {
      const project = await repo.createProject('Events');
      const events: string[] = [];
      repo.addChangeListener(e => events.push(e.type));

      await repo.createFile(project.id, '/new.ts', 'x', 'file');

      // saveFile 内の update + createFile 内の create
      expect(events).toContain('create');
    });

    it('unsubscribe できる', async () => {
      const project = await repo.createProject('Unsub');
      const events: string[] = [];
      const unsub = repo.addChangeListener(e => events.push(e.type));
      unsub();

      await repo.createFile(project.id, '/x.ts', '', 'file');
      expect(events).toHaveLength(0);
    });
  });
});
