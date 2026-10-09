import type { FsClient } from '../_shared/systemModuleTypes';

export interface TodoItem {
  id: string;
  text: string;
  filePath: string;
  line: number;
  projectName: string;
  file: { id: string; name: string; path: string; type: 'file' };
}

type TodoScanFileSystem = Pick<FsClient, 'readdir' | 'readFile'>;

export async function scanTodos(
  fsClient: TodoScanFileSystem,
  rootPath: string,
  isCurrent: () => boolean
): Promise<TodoItem[] | null> {
  const files: Awaited<ReturnType<FsClient['readdir']>> = [];
  const collectFiles = async (directory: string): Promise<boolean> => {
    if (!isCurrent()) return false;
    const entries = await fsClient.readdir(directory);
    if (!isCurrent()) return false;

    for (const entry of entries) {
      if (isExcludedPath(entry.path)) continue;
      if (entry.type === 'folder') {
        if (!(await collectFiles(entry.path))) return false;
        continue;
      }
      if (entry.type === 'file') files.push(entry);
    }
    return true;
  };

  if (!(await collectFiles(rootPath))) return null;
  const todos: TodoItem[] = [];
  const projectName = rootPath.split('/').pop() ?? rootPath;

  for (const file of files) {
    if (!isCurrent()) return null;

    let content: string;
    try {
      const bytes = await fsClient.readFile(file.path);
      if (bytes.includes(0)) continue;
      content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      continue;
    }
    if (!isCurrent()) return null;

    content.split('\n').forEach((line, index) => {
      const todoMatch = line.match(/(?:TODO|FIXME)\s*[:：]\s*(.+)/i);
      if (!todoMatch) return;

      todos.push({
        id: `${file.path}-${index}`,
        text: todoMatch[1].trim(),
        filePath: file.path,
        line: index + 1,
        projectName,
        file: {
          id: file.path,
          name: file.path.split('/').pop() ?? file.path,
          path: file.path,
          type: 'file',
        },
      });
    });
  }

  return todos;
}

function isExcludedPath(path: string): boolean {
  return path.split('/').some(part => part === '.git' || part === 'node_modules');
}
