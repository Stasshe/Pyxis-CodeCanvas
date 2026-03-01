// フォルダ単位のZIPエクスポート・ダウンロード
import JSZip from 'jszip';

import { fileRepository } from '@/engine/core/fileRepository';
import type { FileItem } from '@/types';

export async function exportFolderZip(folder: FileItem, projectId: string) {
  if (folder.type !== 'folder' || !folder.children) return;
  const zip = new JSZip();
  // 再帰的にフォルダ内のファイルを追加
  async function addToZip(items: FileItem[], basePath: string) {
    for (const item of items) {
      if (item.type === 'file') {
        const fresh = await fileRepository.getFileByPath(projectId, item.path);
        if (fresh?.isBufferArray && fresh?.bufferContent) {
          zip.file(basePath + item.name, fresh.bufferContent as ArrayBuffer);
        } else {
          zip.file(basePath + item.name, fresh?.content ?? '');
        }
      } else if (item.type === 'folder' && item.children) {
        await addToZip(item.children, `${basePath + item.name}/`);
      }
    }
  }
  await addToZip(folder.children, `${folder.name}/`);
  const blob = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${folder.name}.zip`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 1000);
}
