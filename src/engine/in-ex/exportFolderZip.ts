import JSZip from 'jszip';

import { basename, fsClient, normalizePath } from '@/engine/core/fs';
import { assertArchiveEntriesReadable } from './archiveEntries';

export async function exportFolderZip(folderPath: string): Promise<void> {
  const rootPath = normalizePath(folderPath);
  const entries = await fsClient.walk(rootPath);
  await assertArchiveEntriesReadable(entries);
  const zip = new JSZip();
  let folderName = basename(rootPath);
  if (!folderName) folderName = 'workspace';
  zip.folder(folderName);

  for (const entry of entries) {
    const relativePath = normalizePath(entry.path).slice(rootPath.length).replace(/^\//, '');
    if (entry.type === 'folder') {
      if (relativePath) zip.folder(`${folderName}/${relativePath}`);
      continue;
    }
    zip.file(`${folderName}/${relativePath}`, await fsClient.readFile(entry.path));
  }

  const blob = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${folderName}.zip`;
  document.body.appendChild(anchor);
  anchor.click();
  setTimeout(() => {
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }, 1000);
}
