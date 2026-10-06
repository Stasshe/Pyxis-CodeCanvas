import JSZip from 'jszip';

import { fsClient } from '@/engine/core/fs';
import { normalizePath } from '@/engine/core/pathUtils';
import type { Project } from '@/types';

export async function downloadWorkspaceZip({
  currentProject,
  includeGit = false,
}: {
  currentProject: Project;
  includeGit?: boolean;
}): Promise<void> {
  const rootPath = normalizePath(currentProject.rootPath);
  const entries = await fsClient.walk(rootPath);
  const zip = new JSZip();
  let rootName = currentProject.name;
  if (!rootName) rootName = 'workspace';

  for (const entry of entries) {
    const relativePath = normalizePath(entry.path).slice(rootPath.length).replace(/^\//, '');
    if (!includeGit && relativePath.split('/').includes('.git')) continue;
    if (entry.type === 'folder') {
      if (relativePath) zip.folder(`${rootName}/${relativePath}`);
      continue;
    }
    zip.file(`${rootName}/${relativePath}`, await fsClient.readFile(entry.path));
  }

  const blob = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${currentProject.name}_export.zip`;
  document.body.appendChild(anchor);
  anchor.click();
  setTimeout(() => {
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }, 1000);
}
