// TerminalPyxisCommands.tsx
// Pyxis独自のターミナルコマンドをまとめたモジュール

import type { UnixCommands } from '@/engine/cmd/unix';
import type { GitCommands } from '@/engine/cmd/git';
import type { NpmCommands } from '@/engine/cmd/npm';
import { gitFileSystem } from '@/engine/core/gitFileSystem';
import { fileRepository } from '@/engine/core/fileRepository';
import { exportPage } from '@/engine/export/exportPage';
import { LOCALSTORAGE_KEY } from '@/context/config';
import { clearAllTranslationCache, deleteTranslationCache } from '@/engine/i18n/storage-adapter';
import { tree as treeOperation } from '@/engine/cmd/gitOperations/tree';

// npm dependency size util is loaded dynamically where needed

export async function handlePyxisCommand(
  cmd: string,
  args: string[],
  refs: {
    unixCommandsRef: React.RefObject<UnixCommands | null>;
    gitCommandsRef: React.RefObject<GitCommands | null>;
    npmCommandsRef: React.RefObject<NpmCommands | null>;
  },
  currentProject: string,
  currentProjectId: string,
  writeOutput: (output: string) => Promise<void>
) {
  const { unixCommandsRef, gitCommandsRef, npmCommandsRef } = refs;

  try {
    switch (cmd) {
      case 'debug-db':
        try {
          await writeOutput('=== IndexedDB & Lightning-FS Debug Information ===\n');

          const dbs = await (window.indexedDB.databases ? window.indexedDB.databases() : []);

          for (const dbInfo of dbs) {
            const dbName = dbInfo.name;
            if (!dbName) continue;

            await writeOutput(`\n--- Database: ${dbName} (v${dbInfo.version}) ---`);

            try {
              const req = window.indexedDB.open(dbName);
              const db = await new Promise<IDBDatabase>((resolve, reject) => {
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
              });

              const objectStoreNames = Array.from(db.objectStoreNames);
              await writeOutput(`Object Stores: ${objectStoreNames.join(', ')}`);

              for (const storeName of objectStoreNames) {
                try {
                  const tx = db.transaction(storeName, 'readonly');
                  const store = tx.objectStore(storeName);
                  const getAllReq = store.getAll();
                  const items = await new Promise<any[]>((resolve, reject) => {
                    getAllReq.onsuccess = () => resolve(getAllReq.result);
                    getAllReq.onerror = () => reject(getAllReq.error);
                  });

                  await writeOutput(`\n  Store: ${storeName} (${items.length} items)`);

                  const isLightningFS = dbName.includes('lightning') || dbName.includes('fs');
                  if (items.length === 0) {
                    await writeOutput('    (empty)');
                  } else if (isLightningFS) {
                    for (let i = 0; i < Math.min(items.length, 10); i++) {
                      const item = items[i];
                      let summary = '';
                      if (typeof item === 'object' && item !== null) {
                        const keys = Object.keys(item);
                        if (keys.includes('id')) summary += `id: ${item.id}, `;
                        if (keys.includes('name')) summary += `name: ${item.name}, `;
                        if (keys.includes('path')) summary += `path: ${item.path}, `;
                        if (keys.includes('type')) summary += `type: ${item.type}, `;
                        if (keys.includes('projectId')) summary += `repo: ${item.projectId}, `;
                        if (keys.includes('content')) {
                          const contentSize =
                            typeof item.content === 'string'
                              ? item.content.length
                              : JSON.stringify(item.content).length;
                          summary += `content: ${contentSize} chars, `;
                        }
                        summary = summary.replace(/, $/, '');
                        if (summary === '') {
                          summary = `{${keys.slice(0, 3).join(', ')}${keys.length > 3 ? '...' : ''}}`;
                        }
                      } else {
                        summary = String(item).slice(0, 100);
                      }
                      await writeOutput(`    [${i}] ${summary}`);
                    }
                    if (items.length > 10) {
                      await writeOutput(`    ... and ${items.length - 10} more items`);
                    }
                  } else {
                    for (let i = 0; i < items.length; i++) {
                      const item = items[i];
                      let detail = '';
                      if (typeof item === 'object' && item !== null) {
                        const keys = Object.keys(item);
                        detail += '{ ';
                        for (const key of keys) {
                          let value = item[key];
                          if (key === 'content' || key === 'bufferContent') {
                            if (typeof value === 'string') {
                              value = value.slice(0, 10) + (value.length > 10 ? '...' : '');
                            } else if (value && typeof value === 'object') {
                              value =
                                JSON.stringify(value).slice(0, 10) +
                                (JSON.stringify(value).length > 10 ? '...' : '');
                            }
                          }
                          detail += `${key}: ${JSON.stringify(value)}, `;
                        }
                        detail = detail.replace(/, $/, '');
                        detail += ' }';
                      } else {
                        detail = String(item).slice(0, 100);
                      }
                      await writeOutput(`    [${i}] ${detail}`);
                    }
                  }
                } catch (storeError) {
                  await writeOutput(`    Error accessing store ${storeName}: ${storeError}`);
                }
              }

              db.close();
            } catch (dbError) {
              await writeOutput(`  Error opening database ${dbName}: ${dbError}`);
            }
          }

          await writeOutput('\n--- LocalStorage (Lightning-FS/pyxis-fs related) ---');
          const otherLightningFSKeys: string[] = [];
          for (let i = 0; i < window.localStorage.length; i++) {
            const key = window.localStorage.key(i);
            if (!key) continue;
            if (key.startsWith('fs/') || key.includes('lightning')) {
              otherLightningFSKeys.push(key);
            }
          }

          if (otherLightningFSKeys.length === 0) {
            await writeOutput('No Lightning-FS related localStorage entries found.');
          } else {
            await writeOutput(`Lightning-FS related entries (${otherLightningFSKeys.length}):`);
            for (const key of otherLightningFSKeys.slice(0, 10)) {
              const value = window.localStorage.getItem(key);
              const size = value ? value.length : 0;
              await writeOutput(`  ${key}: ${size} chars`);
            }
          }

          await writeOutput('\n--- File System Statistics ---');
          try {
            const fs = gitFileSystem.getFS();
            if (fs) {
              try {
                const projectsExists = await fs.promises.stat('/projects').catch(() => null);
                if (projectsExists) {
                  const projectDirs = await fs.promises.readdir('/projects');
                  await writeOutput(`Projects in filesystem: ${projectDirs.length}`);

                  for (const dir of projectDirs.slice(0, 10)) {
                    if (dir === '.' || dir === '..') continue;
                    try {
                      const projectPath = `/projects/${dir}`;
                      const files = await fs.promises.readdir(projectPath);
                      await writeOutput(`  ${dir}: ${files.length} files/dirs`);
                    } catch {
                      await writeOutput(`  ${dir}: (inaccessible)`);
                    }
                  }
                } else {
                  await writeOutput('No /projects directory found in filesystem');
                }
              } catch (fsError) {
                await writeOutput(`Error reading filesystem: ${fsError}`);
              }
            } else {
              await writeOutput('Filesystem not initialized');
            }
          } catch (importError) {
            await writeOutput(`Error importing filesystem: ${importError}`);
          }

          await writeOutput('\n=== Debug Information Complete ===');
        } catch (e) {
          await writeOutput(`debug-db: エラー: ${(e as Error).message}`);
        }
        break;

      case 'memory-clean':
        try {
          const fs = gitFileSystem.getFS();
          if (!fs) {
            await writeOutput('memory-clean: ファイルシステムが初期化できませんでした');
            break;
          }

          await fileRepository.init();

          const allProjects = await fileRepository.getProjects();
          const allDbPaths = new Map<string, Set<string>>();

          for (const project of allProjects) {
            const projectFiles = await fileRepository.getProjectFiles(project.id);
            allDbPaths.set(project.name, new Set(projectFiles.map(f => f.path)));
          }

          async function removeFileOrDirectory(fs: any, path: string): Promise<void> {
            try {
              const stat = await fs.promises.stat(path);
              if (stat.isDirectory()) {
                const files = await fs.promises.readdir(path);
                for (const file of files) {
                  await removeFileOrDirectory(fs, `${path}/${file}`);
                }
                await fs.promises.rmdir(path);
                console.log(`[memory-clean] Removed directory: ${path}`);
              } else {
                await fs.promises.unlink(path);
                console.log(`[memory-clean] Removed file: ${path}`);
              }
              if (fs && typeof (fs as any).sync === 'function') {
                await (fs as any).sync();
              }
            } catch (err) {
              console.warn(`[memory-clean] Failed to remove: ${path}`, err);
              throw err;
            }
          }

          async function cleanProjectDirectory(
            fs: any,
            projectName: string,
            dirPath: string,
            cleaned: string[]
          ): Promise<void> {
            const dbPaths = allDbPaths.get(projectName);
            if (!dbPaths) {
              try {
                await removeFileOrDirectory(fs, dirPath);
                cleaned.push(`${projectName}/ (project not in DB)`);
              } catch {}
              return;
            }

            try {
              const files = await fs.promises.readdir(dirPath);
              for (const file of files) {
                const fullPath = `${dirPath}/${file}`;
                const relativePath = fullPath.replace(`/projects/${projectName}`, '') || '/';

                if (file === '.git') {
                  continue;
                }

                if (!dbPaths.has(relativePath)) {
                  await removeFileOrDirectory(fs, fullPath);
                  cleaned.push(`${projectName}${relativePath}`);
                } else {
                  try {
                    const stat = await fs.promises.stat(fullPath);
                    if (stat.isDirectory()) {
                      await cleanProjectDirectory(fs, projectName, fullPath, cleaned);
                    }
                  } catch {}
                }
              }
            } catch {}
          }

          const cleaned: string[] = [];

          try {
            await fs.promises.stat('/projects');
            const projectDirs = await fs.promises.readdir('/projects');

            for (const dir of projectDirs) {
              if (dir === '.' || dir === '..') continue;

              const projectPath = `/projects/${dir}`;
              try {
                const stat = await fs.promises.stat(projectPath);
                if (stat.isDirectory()) {
                  await cleanProjectDirectory(fs, dir, projectPath, cleaned);
                }
              } catch {}
            }
          } catch (e) {}

          if (cleaned.length > 0) {
            await writeOutput(
              `memory-clean: 以下のファイル・ディレクトリを削除しました:\n${cleaned.join('\n')}`
            );
          } else {
            await writeOutput('memory-clean: 削除対象のファイルは見つかりませんでした');
          }
        } catch (e) {
          await writeOutput(`memory-clean: エラー: ${(e as Error).message}`);
        }
        break;

      case 'fs-clean':
        try {
          const fs = gitFileSystem.getFS();
          if (!fs) {
            await writeOutput('fs-clean: ファイルシステムが初期化できませんでした');
            break;
          }
          async function removeAll(fs: any, dirPath: string): Promise<void> {
            try {
              const stat = await fs.promises.stat(dirPath);
              if (stat.isDirectory()) {
                const files = await fs.promises.readdir(dirPath);
                for (const file of files) {
                  await removeAll(fs, `${dirPath}/${file}`);
                }
                await fs.promises.rmdir(dirPath);
              } else {
                await fs.promises.unlink(dirPath);
              }
              if (fs && typeof (fs as any).sync === 'function') {
                await (fs as any).sync();
              }
            } catch (err) {
              console.warn(`[fs-clean] Failed to remove: ${dirPath}`, err);
            }
          }
          try {
            await removeAll(fs, '/projects');
            await writeOutput('fs-clean: /projects配下を全て削除しました');
          } catch (e) {
            await writeOutput(`fs-clean: /projects削除エラー: ${(e as Error).message}`);
          }
          await writeOutput('fs-clean: 完了');
        } catch (e) {
          await writeOutput(`fs-clean: エラー: ${(e as Error).message}`);
        }
        break;

      case 'git tree':
      case 'git-tree': {
        // original: git tree --all
        // New behavior: if --all/-a/all provided -> show all projects (/projects)
        // Otherwise, if a currentProject is set, show only that project's tree.
        // If no currentProject, fall back to instructing to use --all.
        const allFlag = args.includes('--all') || args.includes('all') || args.includes('-a');

        try {
          const fs = gitFileSystem.getFS();
          if (!fs) {
            await writeOutput('git tree: filesystem not initialized');
            break;
          }

          if (allFlag) {
            const treeOutput = await treeOperation(fs, '/projects');
            await writeOutput(treeOutput || 'No files found under /projects');
          } else if (currentProject) {
            // show tree for current project only
            const projectPath = `/projects/${currentProject}`;
            const treeOutput = await treeOperation(fs, projectPath);
            await writeOutput(treeOutput || `No files found under ${projectPath}`);
          } else {
            await writeOutput(
              'git tree: no current project selected. Use "git tree --all" to show all projects/files or open a project first.'
            );
          }
        } catch (error) {
          await writeOutput(`git tree: ${(error as Error).message}`);
        }
        break;
      }

      case 'export':
      case 'export-page':
      case 'export--page':
      case 'export---page':
      case 'export-indexeddb':
      case 'export--indexeddb':
      case 'export---indexeddb': {
        // Accept variants where the subcommand was merged into the command name
        // e.g. `export-page`, `export---page`, `export indexedb` ended up as `export-indexeddb`, etc.
        const cmdLower = cmd.toLowerCase();
        const localArgs = [...args];

        // If the command name encodes the subcommand, inject the expected flag into args
        if (
          cmdLower.includes('page') &&
          !(
            localArgs[0]?.toLowerCase().startsWith('--page') ||
            localArgs[0]?.toLowerCase() === 'page'
          )
        ) {
          localArgs.unshift('--page');
        }
        if (
          cmdLower.includes('indexedb') &&
          !(
            localArgs[0]?.toLowerCase().startsWith('--indexeddb') ||
            localArgs[0]?.toLowerCase() === 'indexedb'
          )
        ) {
          localArgs.unshift('--indexeddb');
        }

        if (localArgs[0]?.toLowerCase() === '--page' && localArgs[1]) {
          const cwd = unixCommandsRef?.current ? await unixCommandsRef.current.pwd() : '';
          const targetPath = localArgs[1].startsWith('/') ? localArgs[1] : `${cwd}/${localArgs[1]}`;
          const normalizedPath = unixCommandsRef?.current?.normalizePath(targetPath);
          if (normalizedPath) {
            await exportPage(normalizedPath, writeOutput, unixCommandsRef);
          } else {
            await writeOutput('無効なパスが指定されました。');
          }
        } else if (localArgs[0]?.toLowerCase() === '--indexeddb') {
          const win = window.open('about:blank', '_blank');
          if (!win) {
            await writeOutput('about:blankの新規タブを開けませんでした。');
            break;
          }
          const mod = await import('@/engine/export/exportIndexeddb');
          mod.exportIndexeddbHtmlWithWindow(writeOutput, win);
        } else {
          await writeOutput(
            'export: サポートされているのは "export --page <path>" または "export --indexeddb" のみです'
          );
        }
        break;
      }

      case 'npm-size':
        if (args.length === 0) {
          await writeOutput('Usage: npm-size <package-name>');
        } else {
          const packageName = args[0];
          try {
            const { calculateDependencySize } = await import(
              '@/engine/cmd/npmOperations/npmDependencySize'
            );
            const size = await calculateDependencySize(packageName);
            await writeOutput(
              `Total size of ${packageName} and its dependencies: ${size.toFixed(2)} kB`
            );
          } catch (error) {
            await writeOutput(`Error calculating size: ${(error as Error).message}`);
          }
        }
        break;

      case 'i18n-clear':
        // usage: i18n-clear             -> clear all
        //        i18n-clear <locale> <namespace> -> delete specific entry
        try {
          if (args.length === 0) {
            await clearAllTranslationCache();
            await writeOutput('i18n-clear: 全ての翻訳キャッシュを削除しました');
          } else if (args.length >= 2) {
            const locale = args[0];
            const namespace = args[1];
            await deleteTranslationCache(locale as any, namespace);
            await writeOutput(`i18n-clear: ${locale}-${namespace} の翻訳キャッシュを削除しました`);
          } else {
            await writeOutput('i18n-clear: 引数不正。使い方: i18n-clear [<locale> <namespace>]');
          }
        } catch (e) {
          await writeOutput(`i18n-clear: エラー: ${(e as Error).message}`);
        }
        break;

      default:
        await writeOutput(`Unknown pyxis command: ${cmd}`);
    }
  } catch (error) {
    await writeOutput(`Error: ${(error as Error).message}`);
  }
}

export default handlePyxisCommand;
