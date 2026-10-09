import { type GitIgnoreRule, isPathIgnored } from '@/engine/core/gitignore';
import { posixPath } from '@/engine/core/pathUtils';
import type { FileItem } from '@/types';

export function buildExecutableProjectFiles(
  files: FileItem[],
  supportedExtensions: Set<string>,
  gitignoreRules: GitIgnoreRule[]
): FileItem[] {
  const executableFiles: FileItem[] = [];
  const extensions = [...supportedExtensions];

  const walk = (items: FileItem[], parentPath = '') => {
    for (const item of items) {
      const fullPath = posixPath.join(parentPath, item.name);

      if (item.type === 'file') {
        const isSupported = extensions.some(ext => item.name.endsWith(ext));
        if (isSupported && !isPathIgnored(gitignoreRules, fullPath, false)) {
          executableFiles.push({
            id: item.id || fullPath,
            name: item.name,
            path: fullPath,
            content: item.content,
            type: 'file',
          });
        }
      }

      if (item.children) walk(item.children, fullPath);
    }
  };

  walk(files);
  return executableFiles;
}
