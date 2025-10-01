// zipファイル解凍用
import FS from '@isomorphic-git/lightning-fs';
import JSZip from 'jszip';

import { fileRepository } from '@/engine/core/fileRepository';
import { gitFileSystem } from '@/engine/core/gitFileSystem';
import type { ProjectFile } from '@/types';

// UNIXライクなコマンド実装（新アーキテクチャ: IndexedDB優先、自動同期）
export class UnixCommands {
  public fs: FS;
  private currentDir: string;
  private projectId: string;
  private projectName: string;

  constructor(projectName: string, projectId?: string) {
    this.fs = gitFileSystem.getFS();
    this.currentDir = gitFileSystem.getProjectDir(projectName);
    this.projectId = projectId || '';
    this.projectName = projectName;

    if (!this.projectId) {
      console.warn('[UnixCommands] projectId is empty! DB operations will fail.');
    }

    this.ensureProjectDirectory();
  }

  private async ensureProjectDirectory(): Promise<void> {
    try {
      await this.fs.promises.stat(this.currentDir);
    } catch {
      await this.fs.promises.mkdir(this.currentDir, { recursive: true } as any);
    }
  }

  pwd(): string {
    return this.currentDir;
  }

  getRelativePath(): string {
    const projectBase = this.currentDir.split('/')[2];
    const relativePath = this.currentDir.replace(`/projects/${projectBase}`, '');
    return relativePath || '/';
  }

  setCurrentDir(dir: string): void {
    this.currentDir = dir;
  }

  public getRelativePathFromProject(fullPath: string): string {
    const projectBase = `/projects/${this.currentDir.split('/')[2]}`;
    return fullPath.replace(projectBase, '') || '/';
  }

  public normalizePath(path: string): string {
    const parts = path.split('/').filter(part => part !== '' && part !== '.');
    const normalized: string[] = [];

    for (const part of parts) {
      if (part === '..') {
        if (normalized.length > 0 && normalized[normalized.length - 1] !== '..') {
          normalized.pop();
        }
      } else {
        normalized.push(part);
      }
    }

    return '/' + normalized.join('/');
  }

  async cd(path: string, options: string[] = []): Promise<string> {
    const allowSystemAccess = options.includes('--system') || options.includes('--root');
    const projectRoot = gitFileSystem.getProjectDir(this.currentDir.split('/')[2]);
    const newPath = path.startsWith('/') ? path : `${this.currentDir}/${path}`;
    const normalizedPath = this.normalizePath(newPath);

    if (!allowSystemAccess && !normalizedPath.startsWith(projectRoot)) {
      throw new Error('cd: Permission denied - Cannot navigate outside project directory');
    }

    try {
      const stat = await this.fs.promises.stat(normalizedPath);
      if (stat.isDirectory()) {
        this.currentDir = normalizedPath;
        return `Changed directory to ${normalizedPath}`;
      } else {
        throw new Error('Not a directory');
      }
    } catch (error) {
      if ((error as Error).message.includes('Permission denied')) {
        throw error;
      }
      throw new Error(`cd: ${path}: No such directory`);
    }
  }

  async ls(path?: string, options: string[] = []): Promise<string> {
    const targetPath = path
      ? path.startsWith('/')
        ? path
        : `${this.currentDir}/${path}`
      : this.currentDir;

    const showAll = options.includes('-a') || options.includes('--all');
    const showLong = options.includes('-l') || options.includes('--long');
    const showSystem = options.includes('--system') || options.includes('--root');
    const showComplete = options.includes('--complete') || options.includes('--full');

    try {
      const stat = await this.fs.promises.stat(targetPath);

      if (!stat.isDirectory()) {
        if (showLong) {
          const size = stat.size || 0;
          const date = new Date().toLocaleDateString();
          return `${stat.isDirectory() ? 'd' : '-'}rw-r--r-- 1 user user ${size} ${date} ${path}`;
        }
        return path || targetPath.split('/').pop() || '';
      }

      const files = await this.fs.promises.readdir(targetPath);
      let filteredFiles = files;

      if (!showAll && !showSystem && !showComplete) {
        filteredFiles = files.filter(
          file =>
            file !== '.git' &&
            file !== '.' &&
            file !== '..' &&
            !file.startsWith('.git') &&
            !file.startsWith('.')
        );
      } else if (showAll && !showSystem && !showComplete) {
        filteredFiles = files.filter(
          file => file !== '.git' && file !== '.' && file !== '..' && !file.startsWith('.git')
        );
      } else if (showSystem || showComplete) {
        filteredFiles = files.filter(file => file !== '.' && file !== '..');
      }

      if (filteredFiles.length === 0) {
        return '(empty directory)';
      }

      const fileDetails = await Promise.all(
        filteredFiles.map(async file => {
          try {
            const filePath = `${targetPath}/${file}`;
            const fileStat = await this.fs.promises.stat(filePath);
            return {
              name: file,
              isDirectory: fileStat.isDirectory(),
              path: filePath,
              size: fileStat.size || 0,
              mtime: new Date(fileStat.mtimeMs || Date.now()),
            };
          } catch {
            return {
              name: file,
              isDirectory: false,
              path: `${targetPath}/${file}`,
              size: 0,
              mtime: new Date(),
            };
          }
        })
      );

      const sortedFiles = fileDetails.sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) {
          return a.isDirectory ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      });

      if (showLong) {
        let result = `total ${sortedFiles.length}\n`;
        for (const file of sortedFiles) {
          const type = file.isDirectory ? 'd' : '-';
          const size = file.size.toString().padStart(8);
          const date = file.mtime.toLocaleDateString();
          const time = file.mtime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          result += `${type}rw-r--r-- 1 user user ${size} ${date} ${time} ${file.name}${file.isDirectory ? '/' : ''}\n`;
        }
        return result.trim();
      }

      return sortedFiles.map(f => f.name + (f.isDirectory ? '/' : '')).join('\n');
    } catch {
      throw new Error(`ls: ${path || this.currentDir}: No such file or directory`);
    }
  }

  async mkdir(dirName: string, recursive = false): Promise<string> {
    const targetPath = dirName.startsWith('/') ? dirName : `${this.currentDir}/${dirName}`;
    const normalizedPath = this.normalizePath(targetPath);
    const relativePath = this.getRelativePathFromProject(normalizedPath);

    try {
      // IndexedDBに作成（自動的にGitFileSystemに同期＆フラッシュ）
      await fileRepository.createFile(this.projectId, relativePath, '', 'folder');
      return `Directory created: ${normalizedPath}`;
    } catch (error) {
      throw new Error(`mkdir: cannot create directory '${dirName}': ${(error as Error).message}`);
    }
  }

  async touch(fileName: string): Promise<string> {
    const targetPath = fileName.startsWith('/') ? fileName : `${this.currentDir}/${fileName}`;
    const normalizedPath = this.normalizePath(targetPath);
    const relativePath = this.getRelativePathFromProject(normalizedPath);

    try {
      // IndexedDBに作成（自動的にGitFileSystemに同期＆フラッシュ）
      await fileRepository.createFile(this.projectId, relativePath, '', 'file');
      return `File created: ${normalizedPath}`;
    } catch (error) {
      throw new Error(`touch: cannot create file '${fileName}': ${(error as Error).message}`);
    }
  }

  async rm(fileName: string, recursive = false): Promise<string> {
    const targetPath = fileName.startsWith('/') ? fileName : `${this.currentDir}/${fileName}`;

    // ワイルドカード展開
    if (fileName.includes('*')) {
      const dirPath = targetPath.substring(0, targetPath.lastIndexOf('/')) || this.currentDir;
      const pattern = targetPath.substring(targetPath.lastIndexOf('/') + 1);
      const normalizedDir = this.normalizePath(dirPath);

      try {
        const filesInDir = await this.fs.promises.readdir(normalizedDir);
        const regex = new RegExp('^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
        const matchedFiles = filesInDir.filter((file: string) => regex.test(file));

        if (matchedFiles.length === 0) {
          throw new Error(`No matches found: ${fileName}`);
        }

        const results: string[] = [];
        for (const file of matchedFiles) {
          try {
            const result = await this.rm(`${dirPath}/${file}`, recursive);
            results.push(result);
          } catch (error) {
            results.push(`rm: cannot remove '${file}': ${(error as Error).message}`);
          }
        }

        return results.join('\n');
      } catch (error) {
        throw new Error(`rm: ${(error as Error).message}`);
      }
    }

    const normalizedPath = this.normalizePath(targetPath);
    const relativePath = this.getRelativePathFromProject(normalizedPath);

    try {
      // IndexedDBから削除（自動的にGitFileSystemからも削除＆フラッシュ）
      const files = await fileRepository.getProjectFiles(this.projectId);
      const fileToDelete = files.find(f => f.path === relativePath);

      if (!fileToDelete) {
        throw new Error(`No such file or directory: ${fileName}`);
      }

      await fileRepository.deleteFile(fileToDelete.id);

      // フォルダの場合は子ファイルも削除（各削除で自動フラッシュ）
      if (fileToDelete.type === 'folder') {
        const childFiles = files.filter(f => f.path.startsWith(relativePath + '/'));
        for (const child of childFiles) {
          await fileRepository.deleteFile(child.id);
        }
      }

      return `removed '${fileName}'`;
    } catch (error) {
      throw new Error(`rm: ${(error as Error).message}`);
    }
  }

  async cat(fileName: string): Promise<string> {
    const targetPath = fileName.startsWith('/') ? fileName : `${this.currentDir}/${fileName}`;
    const normalizedPath = this.normalizePath(targetPath);

    try {
      const content = await this.fs.promises.readFile(normalizedPath, { encoding: 'utf8' });
      return content as string;
    } catch {
      throw new Error(`cat: ${fileName}: No such file`);
    }
  }

  async echo(text: string, fileName?: string): Promise<string> {
    if (!fileName) {
      return text;
    }

    let append = false;
    let actualFileName = fileName;

    if (fileName.startsWith('>>')) {
      append = true;
      actualFileName = fileName.replace(/^>>\s*/, '');
    } else if (fileName.startsWith('>')) {
      actualFileName = fileName.replace(/^>\s*/, '');
    }

    const targetPath = actualFileName.startsWith('/')
      ? actualFileName
      : `${this.currentDir}/${actualFileName}`;
    const normalizedPath = this.normalizePath(targetPath);
    const relativePath = this.getRelativePathFromProject(normalizedPath);

    try {
      let content = text;

      if (append) {
        const files = await fileRepository.getProjectFiles(this.projectId);
        const existingFile = files.find(f => f.path === relativePath);
        if (existingFile) {
          content = (existingFile.content || '') + text;
        }
      }

      // IndexedDBに保存（自動的にGitFileSystemに同期＆フラッシュ）
      const files = await fileRepository.getProjectFiles(this.projectId);
      const existingFile = files.find(f => f.path === relativePath);

      if (existingFile) {
        await fileRepository.saveFile({
          ...existingFile,
          content,
          updatedAt: new Date(),
        });
      } else {
        await fileRepository.createFile(this.projectId, relativePath, content, 'file');
      }

      return append ? `Appended to: ${normalizedPath}` : `Text written to: ${normalizedPath}`;
    } catch (error) {
      throw new Error(`echo: cannot write to '${actualFileName}': ${(error as Error).message}`);
    }
  }

  async mv(source: string, destination: string): Promise<string> {
    const srcPath = source.startsWith('/') ? source : `${this.currentDir}/${source}`;
    const destPath = destination.startsWith('/')
      ? destination
      : `${this.currentDir}/${destination}`;
    const srcNormalized = this.normalizePath(srcPath);
    const destNormalized = this.normalizePath(destPath);
    const srcRelative = this.getRelativePathFromProject(srcNormalized);
    const destRelative = this.getRelativePathFromProject(destNormalized);

    try {
      // IndexedDBで移動（削除→作成、各操作で自動的にGitFileSystemに同期＆フラッシュ）
      const files = await fileRepository.getProjectFiles(this.projectId);
      const srcFile = files.find(f => f.path === srcRelative);

      if (!srcFile) {
        throw new Error(`No such file or directory: ${source}`);
      }

      // 新しい場所に作成（自動同期＆フラッシュ）
      await fileRepository.createFile(
        this.projectId,
        destRelative,
        srcFile.content || '',
        srcFile.type,
        srcFile.isBufferArray,
        srcFile.bufferContent
      );

      // 元の場所から削除（自動同期＆フラッシュ）
      await fileRepository.deleteFile(srcFile.id);

      return `'${source}' -> '${destination}'`;
    } catch (error) {
      throw new Error(`mv: ${(error as Error).message}`);
    }
  }

  async rename(oldPath: string, newPath: string): Promise<string> {
    const oldNormalized = this.normalizePath(oldPath);
    const newNormalized = this.normalizePath(newPath);
    const oldRelative = this.getRelativePathFromProject(oldNormalized);
    const newRelative = this.getRelativePathFromProject(newNormalized);

    try {
      // IndexedDBでリネーム（削除→作成、各操作で自動的にGitFileSystemに同期＆フラッシュ）
      const files = await fileRepository.getProjectFiles(this.projectId);
      const oldFile = files.find(f => f.path === oldRelative);

      if (!oldFile) {
        throw new Error(`No such file or directory: ${oldPath}`);
      }

      // 新しい名前で作成（自動同期＆フラッシュ）
      // ArrayBuffer(bufferContent)も含めて全てのデータをコピー
      await fileRepository.createFile(
        this.projectId,
        newRelative,
        oldFile.content || '',
        oldFile.type,
        oldFile.isBufferArray,
        oldFile.bufferContent // ArrayBufferをそのまま渡す
      );

      // 古いファイルを削除（自動同期＆フラッシュ）
      await fileRepository.deleteFile(oldFile.id);

      // フォルダの場合は子ファイルもリネーム（ArrayBuffer対応）
      if (oldFile.type === 'folder') {
        const childFiles = files.filter(f => f.path.startsWith(oldRelative + '/'));
        for (const child of childFiles) {
          const newChildPath = child.path.replace(oldRelative, newRelative);
          // 子ファイルのArrayBuffer(bufferContent)も含めて全てのデータをコピー
          await fileRepository.createFile(
            this.projectId,
            newChildPath,
            child.content || '',
            child.type,
            child.isBufferArray,
            child.bufferContent // 子ファイルのArrayBufferもそのまま渡す
          );
          await fileRepository.deleteFile(child.id);
        }
      }

      return `Renamed '${oldPath}' to '${newPath}'`;
    } catch (error) {
      throw new Error(`rename: ${(error as Error).message}`);
    }
  }

  async unzip(zipFileName: string, destDir: string, bufferContent: ArrayBuffer): Promise<string> {
    const extractDir = destDir
      ? destDir.startsWith('/')
        ? destDir
        : `${this.currentDir}/${destDir}`
      : this.currentDir;
    const normalizedDest = this.normalizePath(extractDir);

    try {
      const zip = await JSZip.loadAsync(bufferContent);
      let fileCount = 0;

      for (const relPath in zip.files) {
        const file = zip.files[relPath];

        if (!relPath || relPath === '/' || relPath.includes('../')) {
          continue;
        }

        const destPath = `${normalizedDest}/${relPath}`;
        const normalizedFilePath = this.normalizePath(destPath);
        const relativePath = this.getRelativePathFromProject(normalizedFilePath);

        if (file.dir || relPath.endsWith('/')) {
          // ディレクトリ（自動同期＆フラッシュ）
          await fileRepository.createFile(this.projectId, relativePath, '', 'folder');
        } else {
          // ファイル（自動同期＆フラッシュ）
          let content: Uint8Array | string = await file.async('uint8array');
          let isText = false;
          let isBufferArray = false;

          try {
            const text = new TextDecoder('utf-8', { fatal: true }).decode(content);
            if (
              /\.(txt|md|js|ts|jsx|tsx|json|html|css|py|sh|yml|yaml|xml|svg|csv)$/i.test(relPath)
            ) {
              isText = true;
              content = text;
            }
          } catch {
            isBufferArray = true;
          }

          if (isText && typeof content === 'string') {
            await fileRepository.createFile(this.projectId, relativePath, content, 'file');
          } else if (isBufferArray && content instanceof Uint8Array) {
            const buffer =
              content.buffer instanceof ArrayBuffer
                ? content.buffer
                : new ArrayBuffer(content.byteLength);
            if (buffer !== content.buffer) {
              new Uint8Array(buffer).set(content);
            }
            await fileRepository.createFile(this.projectId, relativePath, '', 'file', true, buffer);
          }
        }
        fileCount++;
      }

      return `Unzipped ${fileCount} file(s) to ${normalizedDest}`;
    } catch (error) {
      throw new Error(`unzip: ${zipFileName}: ${(error as Error).message}`);
    }
  }

  async tree(path?: string, options: string[] = []): Promise<string> {
    const targetPath = path
      ? path.startsWith('/')
        ? path
        : `${this.currentDir}/${path}`
      : this.currentDir;
    const normalizedPath = this.normalizePath(targetPath);

    const showAll = options.includes('-a') || options.includes('--all');
    const maxDepth = options.includes('-L')
      ? parseInt(options[options.indexOf('-L') + 1] || '999', 10)
      : 999;

    let dirCount = 0;
    let fileCount = 0;

    const buildTree = async (
      dirPath: string,
      prefix: string = '',
      depth: number = 0
    ): Promise<string> => {
      if (depth > maxDepth) return '';

      try {
        const files = await this.fs.promises.readdir(dirPath);
        let filteredFiles = files;

        if (!showAll) {
          filteredFiles = files.filter(
            (file: string) =>
              file !== '.git' &&
              file !== '.' &&
              file !== '..' &&
              !file.startsWith('.git') &&
              !file.startsWith('.')
          );
        }

        const fileDetails = await Promise.all(
          filteredFiles.map(async (file: string) => {
            try {
              const filePath = `${dirPath}/${file}`;
              const fileStat = await this.fs.promises.stat(filePath);
              return {
                name: file,
                isDirectory: fileStat.isDirectory(),
                path: filePath,
              };
            } catch {
              return {
                name: file,
                isDirectory: false,
                path: `${dirPath}/${file}`,
              };
            }
          })
        );

        const sortedFiles = fileDetails.sort((a, b) => {
          if (a.isDirectory !== b.isDirectory) {
            return a.isDirectory ? -1 : 1;
          }
          return a.name.localeCompare(b.name);
        });

        let result = '';
        for (let i = 0; i < sortedFiles.length; i++) {
          const file = sortedFiles[i];
          const isLast = i === sortedFiles.length - 1;
          const connector = isLast ? '└── ' : '├── ';
          const newPrefix = prefix + (isLast ? '    ' : '│   ');

          result += `${prefix}${connector}${file.name}${file.isDirectory ? '/' : ''}\n`;

          if (file.isDirectory) {
            dirCount++;
            result += await buildTree(file.path, newPrefix, depth + 1);
          } else {
            fileCount++;
          }
        }

        return result;
      } catch (error) {
        return `${prefix}[error reading directory]\n`;
      }
    };

    try {
      const stat = await this.fs.promises.stat(normalizedPath);
      if (!stat.isDirectory()) {
        return normalizedPath;
      }

      let result = `${normalizedPath}\n`;
      result += await buildTree(normalizedPath);
      result += `\n${dirCount} directories, ${fileCount} files`;

      return result;
    } catch (error) {
      throw new Error(`tree: ${path || this.currentDir}: No such directory`);
    }
  }
}
