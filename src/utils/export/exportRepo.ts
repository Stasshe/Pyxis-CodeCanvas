// ZIPエクスポート・ダウンロード機能
import JSZip from 'jszip';
import type { Project } from '@/types';

// 現在のプロジェクトのみZIPエクスポート
export async function downloadWorkspaceZip({ currentProject, includeGit = false }: { currentProject: Project, includeGit?: boolean }) {
  const dbName = 'PyxisProjects';
  const req = window.indexedDB.open(dbName);
  const db: IDBDatabase = await new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  // projectsストア
  const projectsTx = db.transaction('projects', 'readonly');
  const projectsStore = projectsTx.objectStore('projects');
  const projectReq = projectsStore.get(currentProject.id);
  const project: any = await new Promise((resolve, reject) => {
    projectReq.onsuccess = () => resolve(projectReq.result);
    projectReq.onerror = () => reject(projectReq.error);
  });

  // filesストア
  const filesTx = db.transaction('files', 'readonly');
  const filesStore = filesTx.objectStore('files');
  // プロジェクトIDで絞り込み
  const filesReq = filesStore.getAll();
  const allFiles: any[] = await new Promise((resolve, reject) => {
    filesReq.onsuccess = () => resolve(filesReq.result);
    filesReq.onerror = () => reject(filesReq.error);
  });
  db.close();

  const projectDir = project.name || project.id;
  const zip = new JSZip();
  // プロジェクト情報（README的な）
  zip.file(`${projectDir}/.project.json`, JSON.stringify(project, null, 2));
  // ファイル群
  const projectFiles = allFiles.filter(f => f.projectId === currentProject.id);
  for (const file of projectFiles) {
    if (file.type === 'file') {
      zip.file(`${projectDir}${file.path}`, file.content);
    }
  }

  // .gitを含める場合（filesストアに.gitファイルがあれば追加）
  if (includeGit) {
    for (const file of projectFiles) {
      if (file.path.startsWith('/.git/') && file.type === 'file') {
        zip.file(`${projectDir}${file.path}`, file.content);
      }
    }
  }

  // ZIPバイナリ生成
  const blob = await zip.generateAsync({ type: 'blob' });
  // ダウンロード
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${projectDir}_export.zip`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 1000);
}
