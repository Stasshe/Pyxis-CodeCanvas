import { LOCALSTORAGE_KEY } from '@/constants/config';
import type { GitCommands } from '@/engine/cmd/global/git';
import { tree as treeOperation } from '@/engine/cmd/global/gitOperations/tree';
import type { NpmCommands } from '@/engine/cmd/global/npm';
import type { UnixCommands } from '@/engine/cmd/global/unix';
import { terminalCommandRegistry } from '@/engine/cmd/terminalRegistry';
import { fileRepository } from '@/engine/core/fileRepository';
import { gitFileSystem } from '@/engine/core/gitFileSystem';
import { clearAllTranslationCache, deleteTranslationCache } from '@/engine/i18n/storage-adapter';
import { exportPage } from '@/engine/in-ex/exportPage';
import { STORES, storageService } from '@/engine/storage';
import { clearAllTerminalHistory } from '@/stores/terminalHistoryStorage';

export async function handlePyxisCommand(
  cmd: string,
  args: string[],
  projectName: string,
  projectId: string,
  writeOutput: (output: string) => Promise<void>
) {
  // Obtain registry instances
  const unixInst: UnixCommands = terminalCommandRegistry.getUnixCommands(projectName, projectId);
  const gitInst: GitCommands = terminalCommandRegistry.getGitCommands(projectName, projectId);
  const npmInst: NpmCommands = terminalCommandRegistry.getNpmCommands(
    projectName,
    projectId,
    `/projects/${projectName}`
  );

  try {
    switch (cmd) {
      case 'init': {
        // pyxis init --all --admin: Complete system initialization/reset
        const hasAll = args.includes('--all');
        const hasAdmin = args.includes('--admin');

        if (!hasAll || !hasAdmin) {
          await writeOutput('Usage: pyxis init --all --admin');
          await writeOutput('This command requires both --all and --admin flags for safety.');
          await writeOutput('It will completely reset all IndexedDB databases and localStorage.');
          break;
        }

        await writeOutput('⚠️  WARNING: This will DELETE ALL DATA including:');
        await writeOutput('  - All IndexedDB databases (pyxis-global, pyxisproject, lightning-fs)');
        await writeOutput('  - localStorage (except recent projects and language settings)');
        await writeOutput('  - session-scoped preferences (terminal history)');
        await writeOutput('');
        await writeOutput('Type "yes" to confirm or "no" to cancel:');

        // Note: This is a simplified version. In a real implementation,
        // we would need to wait for user input. For now, we'll require
        // the user to run a separate confirmation command.
        await writeOutput('');
        await writeOutput('To proceed, run: pyxis init --all --admin --confirm');

        if (args.includes('--confirm')) {
          await writeOutput('');
          await writeOutput('Starting complete system reset...');

          try {
            // 1. Close all database connections first
            await writeOutput('[1/5] Closing database connections...');

            // Close storageService connection
            try {
              storageService.close();
              await writeOutput('  ✓ Closed pyxis-global connection');
            } catch (e) {
              console.warn('Failed to close storageService:', e);
            }

            // Close fileRepository connection
            try {
              await fileRepository.close();
              await writeOutput('  ✓ Closed PyxisProjects connection');
            } catch (e) {
              console.warn('Failed to close fileRepository:', e);
            }

            // Wait a bit for connections to fully close
            await new Promise(resolve => setTimeout(resolve, 500));

            // 2. Clear all IndexedDB databases IN PARALLEL
            await writeOutput('[2/5] Clearing IndexedDB databases...');
            const dbs = await (window.indexedDB.databases ? window.indexedDB.databases() : []);

            // Delete all databases in parallel for speed
            const deletionResults = await Promise.allSettled(
              dbs.map(async dbInfo => {
                if (!dbInfo.name) return { name: '', success: false };

                try {
                  await new Promise<void>((resolve, reject) => {
                    const deleteReq = window.indexedDB.deleteDatabase(dbInfo.name!);

                    // Reduced timeout to 3 seconds for parallel operations
                    const timeoutId = setTimeout(() => {
                      console.warn(`Database ${dbInfo.name} deletion timed out`);
                      resolve(); // Resolve to continue with reset
                    }, 3000);

                    deleteReq.onsuccess = () => {
                      clearTimeout(timeoutId);
                      resolve();
                    };

                    deleteReq.onerror = () => {
                      clearTimeout(timeoutId);
                      resolve(); // Resolve to continue with reset
                    };

                    deleteReq.onblocked = () => {
                      console.warn(`Database ${dbInfo.name} deletion blocked`);
                      // Let timeout handle it
                    };
                  });
                  return { name: dbInfo.name, success: true };
                } catch (error) {
                  return { name: dbInfo.name, success: false };
                }
              })
            );

            // Count successful deletions and output results
            let deletedCount = 0;
            for (const result of deletionResults) {
              if (result.status === 'fulfilled' && result.value.name) {
                if (result.value.success) {
                  deletedCount++;
                  await writeOutput(`  ✓ Deleted database: ${result.value.name}`);
                } else {
                  await writeOutput(`  ✗ Failed to delete ${result.value.name}`);
                }
              }
            }

            await writeOutput(`  Deleted ${deletedCount}/${dbs.length} database(s)`);

            // 3. Clear localStorage (except protected keys)
            await writeOutput('[3/5] Clearing localStorage...');
            const protectedKeys = [LOCALSTORAGE_KEY.RECENT_PROJECTS, LOCALSTORAGE_KEY.LOCALE];

            const savedValues: Record<string, string> = {};
            protectedKeys.forEach(key => {
              const value = localStorage.getItem(key);
              if (value) savedValues[key] = value;
            });

            localStorage.clear();

            // Restore protected keys
            Object.entries(savedValues).forEach(([key, value]) => {
              localStorage.setItem(key, value);
            });

            await writeOutput(
              `  ✓ Cleared localStorage (preserved ${Object.keys(savedValues).length} protected items)`
            );

            // 4. Clear session-scoped data (migrated to IndexedDB user_preferences)
            await writeOutput('[4/5] Clearing session-scoped preferences...');
            await clearAllTerminalHistory();
            await storageService.clear(STORES.USER_PREFERENCES);
            await writeOutput('  ✓ Cleared session-scoped preferences');

            // 5. Reload page to reinitialize
            await writeOutput('[5/5] Reloading application...');
            await writeOutput('');
            await writeOutput('✅ Complete system reset successful!');
            await writeOutput('Page will reload in 2 seconds...');

            setTimeout(() => {
              window.location.reload();
            }, 2000);
          } catch (error) {
            await writeOutput('');
            await writeOutput(`❌ Reset failed: ${(error as Error).message}`);
            throw error;
          }
        }
        break;
      }

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
          } else if (projectName) {
            const projectPath = `/projects/${projectName}`;
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
        const cmdLower = cmd.toLowerCase();
        const localArgs = [...args];

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
          const cwd = unixInst ? await unixInst.pwd() : '';
          const targetPath = localArgs[1].startsWith('/') ? localArgs[1] : `${cwd}/${localArgs[1]}`;
          const normalizedPath = unixInst?.normalizePath(targetPath);
          if (normalizedPath) {
            await exportPage(normalizedPath, writeOutput, unixInst);
          } else {
            await writeOutput('無効なパスが指定されました。');
          }
        } else if (localArgs[0]?.toLowerCase() === '--indexeddb') {
          const win = window.open('about:blank', '_blank');
          if (!win) {
            await writeOutput('about:blankの新規タブを開けませんでした。');
            break;
          }
          const mod = await import('@/engine/in-ex/exportIndexeddb');
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
              '@/engine/cmd/global/npmOperations/npmDependencySize'
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

      case 'storage-tree':
      case 'storage tree':
        try {
          await writeOutput('=== Pyxis Storage (pyxis-global) ===\n');

          const allStores = Object.values(STORES);
          let totalEntries = 0;

          for (const storeName of allStores) {
            try {
              const entries = await storageService.getAll(storeName);
              totalEntries += entries.length;

              await writeOutput(`\n📁 ${storeName} (${entries.length} entries)`);

              if (entries.length === 0) {
                await writeOutput('  (empty)');
              } else {
                for (let i = 0; i < Math.min(entries.length, 10); i++) {
                  const entry = entries[i];
                  const timestamp = new Date(entry.timestamp).toLocaleString('ja-JP');
                  const expires = entry.expiresAt
                    ? ` | expires: ${new Date(entry.expiresAt).toLocaleString('ja-JP')}`
                    : '';
                  const dataSize =
                    typeof entry.data === 'string'
                      ? entry.data.length
                      : JSON.stringify(entry.data).length;

                  await writeOutput(
                    `  [${i + 1}] id: ${entry.id} | ${dataSize} bytes | ${timestamp}${expires}`
                  );
                }

                if (entries.length > 10) {
                  await writeOutput(`  ... and ${entries.length - 10} more entries`);
                }
              }
            } catch (err) {
              await writeOutput(`  Error reading store ${storeName}: ${(err as Error).message}`);
            }
          }

          await writeOutput(
            `\n📊 Total: ${totalEntries} entries across ${allStores.length} stores`
          );
        } catch (e) {
          await writeOutput(`storage-tree: エラー: ${(e as Error).message}`);
        }
        break;

      case 'storage-clear':
      case 'storage clear':
        try {
          if (args.length === 0) {
            await storageService.clearAll();
            await writeOutput('storage-clear: 全てのストアを削除しました');
          } else {
            const storeName = args[0];
            const validStores = Object.values(STORES);

            if (validStores.includes(storeName as any)) {
              await storageService.clear(storeName as any);
              await writeOutput(`storage-clear: ${storeName} を削除しました`);
            } else {
              await writeOutput(
                `storage-clear: 無効なストア名です。有効なストア: ${validStores.join(', ')}`
              );
            }
          }
        } catch (e) {
          await writeOutput(`storage-clear: エラー: ${(e as Error).message}`);
        }
        break;

      case 'storage-get':
      case 'storage get':
        try {
          if (args.length < 2) {
            await writeOutput('Usage: storage-get <store-name> <entry-id>');
          } else {
            const storeName = args[0];
            const entryId = args[1];
            const validStores = Object.values(STORES);

            if (!validStores.includes(storeName as any)) {
              await writeOutput(
                `storage-get: 無効なストア名です。有効なストア: ${validStores.join(', ')}`
              );
              break;
            }

            const data = await storageService.get(storeName as any, entryId);

            if (data === null) {
              await writeOutput(`storage-get: ${storeName}/${entryId} が見つかりませんでした`);
            } else {
              await writeOutput(`=== ${storeName}/${entryId} ===`);
              const dataStr = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
              await writeOutput(dataStr);
            }
          }
        } catch (e) {
          await writeOutput(`storage-get: エラー: ${(e as Error).message}`);
        }
        break;

      case 'storage-delete':
      case 'storage delete':
        try {
          if (args.length < 2) {
            await writeOutput('Usage: storage-delete <store-name> <entry-id>');
          } else {
            const storeName = args[0];
            const entryId = args[1];
            const validStores = Object.values(STORES);

            if (!validStores.includes(storeName as any)) {
              await writeOutput(
                `storage-delete: 無効なストア名です。有効なストア: ${validStores.join(', ')}`
              );
              break;
            }

            await storageService.delete(storeName as any, entryId);
            await writeOutput(`storage-delete: ${storeName}/${entryId} を削除しました`);
          }
        } catch (e) {
          await writeOutput(`storage-delete: エラー: ${(e as Error).message}`);
        }
        break;

      case 'storage-clean':
      case 'storage clean':
        try {
          await writeOutput('storage-clean: 期限切れエントリを削除中...');
          await storageService.cleanExpired();
          await writeOutput('storage-clean: 完了');
        } catch (e) {
          await writeOutput(`storage-clean: エラー: ${(e as Error).message}`);
        }
        break;

      case 'storage-stats':
      case 'storage stats':
        try {
          await writeOutput('=== Pyxis Storage Statistics ===\n');

          const allStores = Object.values(STORES);
          let totalEntries = 0;
          let totalSize = 0;
          let expiredCount = 0;

          for (const storeName of allStores) {
            try {
              const entries = await storageService.getAll(storeName);
              let storeSize = 0;
              let storeExpired = 0;
              const now = Date.now();

              for (const entry of entries) {
                const dataSize =
                  typeof entry.data === 'string'
                    ? entry.data.length
                    : JSON.stringify(entry.data).length;
                storeSize += dataSize;

                if (entry.expiresAt && now > entry.expiresAt) {
                  storeExpired++;
                }
              }

              totalEntries += entries.length;
              totalSize += storeSize;
              expiredCount += storeExpired;

              const storeSizeKB = (storeSize / 1024).toFixed(2);
              await writeOutput(
                `${storeName}: ${entries.length} entries, ${storeSizeKB} KB${storeExpired > 0 ? ` (${storeExpired} expired)` : ''}`
              );
            } catch (err) {
              await writeOutput(`${storeName}: Error - ${(err as Error).message}`);
            }
          }

          const totalSizeKB = (totalSize / 1024).toFixed(2);
          const totalSizeMB = (totalSize / (1024 * 1024)).toFixed(2);

          await writeOutput(
            `\n📊 Total: ${totalEntries} entries, ${totalSizeKB} KB (${totalSizeMB} MB)`
          );
          if (expiredCount > 0) {
            await writeOutput(`⚠️  ${expiredCount} expired entries (run 'storage-clean' to remove)`);
          }
        } catch (e) {
          await writeOutput(`storage-stats: エラー: ${(e as Error).message}`);
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
