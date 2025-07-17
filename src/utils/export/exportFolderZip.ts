// フォルダ単位のZIPエクスポート・ダウンロード
import JSZip from 'jszip';
import type { FileItem } from '@/types';

export async function exportFolderZip(folder: FileItem) {
  if (folder.type !== 'folder' || !folder.children) return;
  const zip = new JSZip();
  // 再帰的にフォルダ内のファイルを追加
  function addToZip(items: FileItem[], basePath: string) {
    for (const item of items) {
      if (item.type === 'file') {
        zip.file(basePath + item.name, item.content ?? '');
      } else if (item.type === 'folder' && item.children) {
        addToZip(item.children, basePath + item.name + '/');
      }
    }
  }
  addToZip(folder.children, folder.name + '/');
  const blob = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = folder.name + '.zip';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 1000);
}
