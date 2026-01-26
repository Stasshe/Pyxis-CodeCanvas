/**
 * Git Clone Operations
 *
 * Handles git clone with optimized .git folder handling:
 * - Terminal clone: Excludes .git directory completely
 * - ProjectModal clone: Includes .git directory for full git functionality
 *
 * Performance optimizations:
 * - Bulk file creation for IndexedDB
 * - Efficient traversal skipping unnecessary directories
 * - Streaming file content handling
 */

import type FS from '@isomorphic-git/lightning-fs';
import git from 'isomorphic-git';
import http from 'isomorphic-git/http/web';

import { fileRepository } from '@/engine/core/fileRepository';
import { joinPath, toAppPath } from '@/engine/core/pathUtils';
import { authRepository } from '@/engine/user/authRepository';

export interface CloneOptions {
  /** When true, removes .git directory after cloning (for terminal clones) */
  skipDotGit?: boolean;
  /** Maximum depth for git objects (default: 10) */
  maxGitObjects?: number;
}

export interface CloneContext {
  fs: FS;
  dir: string;
  projectId: string;
  projectName: string;
}

/**
 * Git Clone Operations class
 * Extracted from GitCommands for better modularity and maintainability
 */
export class GitCloneOperations {
  private fs: FS;
  private dir: string;
  private projectId: string;
  private projectName: string;

  constructor(context: CloneContext) {
    this.fs = context.fs;
    this.dir = context.dir;
    this.projectId = context.projectId;
    this.projectName = context.projectName;
  }

  /**
   * Clone a remote repository
   *
   * @param url Repository URL to clone
   * @param targetDir Target directory (optional)
   * @param options Clone options
   * @returns Success message
   */
  async clone(url: string, targetDir?: string, options: CloneOptions = {}): Promise<string> {
    // URL validation
    if (!url || typeof url !== 'string' || !url.trim()) {
      throw new Error('Invalid repository URL');
    }

    const repoName = url.split('/').pop()?.replace('.git', '') || 'repository';
    const cloneDir = this.resolveCloneDirectory(targetDir, repoName);

    console.log(`[GitClone] Clone directory: ${cloneDir}`);

    // Check if target directory already exists
    await this.validateTargetDirectory(cloneDir, targetDir, repoName);

    // Execute clone
    await this.executeClone(url, cloneDir, options);

    console.log('[GitClone] Starting optimized IndexedDB sync...');

    // Handle .git directory based on options
    if (options.skipDotGit) {
      await this.removeGitDirectory(cloneDir);
    }

    // Calculate relative path for sync
    const baseRelativePath = this.calculateBaseRelativePath(cloneDir, targetDir, repoName);

    // Sync files to IndexedDB
    await this.syncClonedFilesToIndexedDB(cloneDir, baseRelativePath);

    return `Cloning into '${targetDir || repoName}'...\nClone completed successfully.`;
  }

  /**
   * Resolve the clone directory path
   */
  private resolveCloneDirectory(targetDir: string | undefined, repoName: string): string {
    const baseDir = this.dir.endsWith('/') ? this.dir.slice(0, -1) : this.dir;

    if (targetDir) {
      if (targetDir === '.' || targetDir === './') {
        return baseDir;
      }
      if (targetDir.startsWith('/')) {
        return targetDir;
      }
      return `${baseDir}/${targetDir}`;
    }
    return `${baseDir}/${repoName}`;
  }

  /**
   * Validate that the target directory doesn't already exist
   */
  private async validateTargetDirectory(
    cloneDir: string,
    targetDir: string | undefined,
    repoName: string
  ): Promise<void> {
    try {
      await this.fs.promises.stat(cloneDir);
      throw new Error(
        `fatal: destination path '${targetDir || repoName}' already exists and is not an empty directory.`
      );
    } catch (error) {
      if ((error as Error).message.includes('already exists')) {
        throw error;
      }
      // Directory doesn't exist, which is expected
    }
  }

  /**
   * Execute the git clone operation
   */
  private async executeClone(url: string, cloneDir: string, options: CloneOptions): Promise<void> {
    try {
      const depth = options.maxGitObjects ?? 10;

      await git.clone({
        fs: this.fs,
        http,
        dir: cloneDir,
        url,
        corsProxy: 'https://cors.isomorphic-git.org',
        singleBranch: true,
        depth,
        onAuth: () => {
          if (authRepository && typeof authRepository.getAccessToken === 'function') {
            return authRepository.getAccessToken().then(token => {
              if (token) {
                return { username: 'x-access-token', password: token };
              }
              return {};
            });
          }
          return {};
        },
      });
    } catch (cloneError) {
      console.error('[GitClone] Clone failed:', cloneError);
      // Cleanup failed clone directory
      try {
        await this.fs.promises.rmdir(cloneDir);
      } catch {
        // Ignore cleanup errors
      }
      throw new Error(
        `Failed to clone repository: ${(cloneError as Error).message}. Please check the URL and try again.`
      );
    }
  }

  /**
   * Remove .git directory after cloning (for terminal clones)
   */
  private async removeGitDirectory(cloneDir: string): Promise<void> {
    try {
      const gitPath = cloneDir.endsWith('/') ? `${cloneDir}.git` : `${cloneDir}/.git`;
      await this.removeDirectoryRecursive(gitPath);
      console.log('[GitClone] .git directory removed');
    } catch (removeError) {
      console.warn('[GitClone] Failed to remove .git directory:', removeError);
    }
  }

  /**
   * Recursively remove a directory
   */
  private async removeDirectoryRecursive(path: string): Promise<void> {
    try {
      const entries = await this.fs.promises.readdir(path);
      for (const entry of entries) {
        const fullPath = `${path}/${entry}`;
        try {
          const stat = await this.fs.promises.stat(fullPath);
          if (stat.isDirectory()) {
            await this.removeDirectoryRecursive(fullPath);
          } else {
            await this.fs.promises.unlink(fullPath);
          }
        } catch {
          // Ignore individual file errors
        }
      }
      await this.fs.promises.rmdir(path);
    } catch {
      // Ignore directory errors
    }
  }

  /**
   * Calculate the base relative path for syncing
   */
  private calculateBaseRelativePath(
    cloneDir: string,
    targetDir: string | undefined,
    repoName: string
  ): string {
    const baseDir = this.dir.endsWith('/') ? this.dir.slice(0, -1) : this.dir;
    return cloneDir === baseDir
      ? ''
      : (targetDir && targetDir !== '.' ? targetDir : repoName).replace(/^\//, '');
  }

  /**
   * Optimized sync of cloned files to IndexedDB
   * - Collects all files/folders first
   * - Creates in bulk for maximum efficiency
   */
  private async syncClonedFilesToIndexedDB(
    clonePath: string,
    baseRelativePath: string
  ): Promise<void> {
    console.log('[GitClone] Starting optimized sync...');
    const startTime = performance.now();

    try {
      // Path normalization helper
      const normalizeClonePath = (base: string, entry?: string): string => {
        if (!entry) {
          return toAppPath(base);
        }
        return joinPath(toAppPath(base), entry);
      };

      // Collect all directories and files
      const allDirectories: Array<{ path: string; depth: number }> = [];
      const allFiles: Array<{
        path: string;
        content: string | Uint8Array;
        isBinary: boolean;
      }> = [];

      // Add root folder if needed
      if (baseRelativePath) {
        allDirectories.push({
          path: normalizeClonePath(baseRelativePath),
          depth: baseRelativePath.split('/').length,
        });
      }

      // Recursive traversal
      const traverse = async (currentPath: string, relativeBase: string, depth: number) => {
        try {
          const entries = await this.fs.promises.readdir(currentPath);

          for (const entry of entries) {
            // Skip special directories
            if (entry === '.' || entry === '..' || entry === '.git') continue;

            const fullPath = `${currentPath}${currentPath.endsWith('/') ? '' : '/'}${entry}`;
            const relativePath = normalizeClonePath(relativeBase, entry);

            try {
              const stat = await this.fs.promises.stat(fullPath);

              if (stat.isDirectory()) {
                allDirectories.push({ path: relativePath, depth });
                await traverse(fullPath, relativePath.replace(/^\//, ''), depth + 1);
              } else {
                const contentBuffer = await this.fs.promises.readFile(fullPath);
                const isBinary = this.isBinaryFile(contentBuffer as Uint8Array);

                allFiles.push({
                  path: relativePath,
                  content: contentBuffer,
                  isBinary,
                });
              }
            } catch (statError) {
              console.warn(`[GitClone] Failed to stat ${fullPath}:`, statError);
            }
          }
        } catch (readdirError) {
          console.warn(`[GitClone] Failed to read directory ${currentPath}:`, readdirError);
        }
      };

      // Execute traversal
      await traverse(clonePath, baseRelativePath, 1);

      console.log(
        `[GitClone] Collected ${allDirectories.length} directories and ${allFiles.length} files`
      );

      // Sort directories by depth (shallow first)
      allDirectories.sort((a, b) => a.depth - b.depth);

      // Prepare bulk entries
      const directoryEntries = allDirectories.map(dir => ({
        path: dir.path,
        content: '',
        type: 'folder' as const,
      }));

      const fileEntries = allFiles.map(file => this.prepareFileEntry(file));

      // Bulk create directories
      console.log('[GitClone] Creating directories in bulk...');
      if (directoryEntries.length > 0) {
        await fileRepository.createFilesBulk(this.projectId, directoryEntries, true);
      }

      // Bulk create files with batching
      console.log('[GitClone] Creating files in bulk...');
      if (fileEntries.length > 0) {
        const BATCH_SIZE = 100;
        for (let i = 0; i < fileEntries.length; i += BATCH_SIZE) {
          const batch = fileEntries.slice(i, i + BATCH_SIZE);
          await fileRepository.createFilesBulk(this.projectId, batch);
          console.log(
            `[GitClone] Created batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(fileEntries.length / BATCH_SIZE)}`
          );
        }
      }

      const endTime = performance.now();
      console.log(`[GitClone] Optimized sync completed in ${(endTime - startTime).toFixed(2)}ms`);
    } catch (error) {
      console.error('[GitClone] Optimized sync failed:', error);
      throw error;
    }
  }

  /**
   * Prepare file entry for bulk creation
   */
  private prepareFileEntry(file: {
    path: string;
    content: string | Uint8Array;
    isBinary: boolean;
  }): {
    path: string;
    content: string;
    type: 'file';
    isBufferArray?: boolean;
    bufferContent?: ArrayBuffer;
  } {
    if (file.isBinary) {
      const uint8Array = this.toUint8Array(file.content);
      return {
        path: file.path,
        content: '',
        type: 'file' as const,
        isBufferArray: true,
        bufferContent: uint8Array.buffer as ArrayBuffer,
      };
    }
    const content =
      typeof file.content === 'string'
        ? file.content
        : new TextDecoder().decode(file.content as Uint8Array);
    return {
      path: file.path,
      content,
      type: 'file' as const,
      isBufferArray: false,
    };
  }

  /**
   * Convert various content types to Uint8Array
   */
  private toUint8Array(content: string | Uint8Array): Uint8Array {
    if (content instanceof Uint8Array) {
      return content;
    }
    if (content && typeof (content as unknown as ArrayBuffer).byteLength === 'number') {
      return new Uint8Array(content as unknown as ArrayBuffer);
    }
    if (typeof content === 'string') {
      return new TextEncoder().encode(content);
    }
    return new Uint8Array(content as unknown as ArrayBufferLike);
  }

  /**
   * Check if file content is binary
   */
  private isBinaryFile(buffer: Uint8Array): boolean {
    const sampleSize = Math.min(buffer.length, 8000);
    for (let i = 0; i < sampleSize; i++) {
      const byte = buffer[i];
      if (byte === 0) return true;
      if (byte < 32 && byte !== 9 && byte !== 10 && byte !== 13) return true;
    }
    return false;
  }
}
