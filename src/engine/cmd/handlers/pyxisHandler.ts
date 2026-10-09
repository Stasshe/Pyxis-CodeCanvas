import { LOCALSTORAGE_KEY } from '@/constants/config';
import type { UnixCommands } from '@/engine/cmd/global/unix';
import { terminalCommandRegistry } from '@/engine/cmd/terminalRegistry';
import { fsClient, HOME_DIR, NPM_CACHE_PATH, RUNTIME_CACHE_PATH, TMP_PATH } from '@/engine/core/fs';
import { normalizePath, resolvePath } from '@/engine/core/pathUtils';
import { clearAllTranslationCache, deleteTranslationCache } from '@/engine/i18n/storage-adapter';
import { isSupportedLocale } from '@/engine/i18n/types';
import { exportPage } from '@/engine/in-ex/exportPage';
import { STORES, type StoreName, storageService } from '@/engine/storage';
import { closeRecentFolders } from '@/engine/storage/recentFolderStorageAdapter';

function isStoreName(value: string): value is StoreName {
  return Object.values(STORES).some(storeName => storeName === value);
}

async function clearDirectoryContents(directory: string): Promise<void> {
  const mount = normalizePath(directory);
  for (const entry of await fsClient.readdir(mount)) {
    await fsClient.rm(entry.path, { recursive: true, force: true });
  }
}

async function clearFilesystem(): Promise<void> {
  for (const entry of await fsClient.readdir('/')) {
    if (entry.mount === 'memory') {
      await clearDirectoryContents(entry.path);
    } else if (entry.mount !== 'devices') {
      await fsClient.rm(entry.path, { recursive: true, force: true });
    }
  }
  for (const path of [HOME_DIR, RUNTIME_CACHE_PATH, NPM_CACHE_PATH]) {
    await fsClient.mkdir(path, { recursive: true });
  }
}

export async function handlePyxisCommand(
  cmd: string,
  args: string[],
  rootPath: string,
  writeOutput: (output: string) => Promise<void>
) {
  // Obtain registry instances
  const unixInst: UnixCommands = terminalCommandRegistry.getUnixCommands(rootPath);

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
        await writeOutput('  - All IndexedDB databases and OPFS files');
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
              console.warn('Failed to close storageService:', (e as Error).message);
            }

            await closeRecentFolders();
            await writeOutput('  ✓ Closed recent folders connection');

            // 2. Clear all IndexedDB databases IN PARALLEL
            await writeOutput('[2/5] Clearing IndexedDB databases...');
            const dbs = await window.indexedDB.databases();

            // Delete all databases in parallel for speed
            const deletedNames = await Promise.all(
              dbs.map(async dbInfo => {
                if (!dbInfo.name) return '';
                await new Promise<void>((resolve, reject) => {
                  const request = window.indexedDB.deleteDatabase(dbInfo.name!);
                  request.onsuccess = () => resolve();
                  request.onerror = () => reject(request.error);
                  request.onblocked = () =>
                    reject(new Error(`Database ${dbInfo.name} deletion is blocked`));
                });
                return dbInfo.name;
              })
            );

            for (const name of deletedNames) {
              if (name) await writeOutput(`  ✓ Deleted database: ${name}`);
            }
            await clearFilesystem();
            await writeOutput('  ✓ Cleared OPFS files and initialized Linux directories');

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

            // 4. Reload page to reinitialize
            await writeOutput('[4/4] Reloading application...');
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

      case 'debug-db': {
        const databases = await window.indexedDB.databases();
        await writeOutput('=== IndexedDB and OPFS ===');
        for (const database of databases) {
          if (database.name) await writeOutput(`${database.name} (v${database.version ?? 0})`);
        }
        const entries = await fsClient.walk('/');
        await writeOutput(`OPFS entries: ${entries.length}`);
        await writeOutput(`Workspace: ${rootPath}`);
        break;
      }

      case 'git tree':
      case 'git-tree': {
        const git = terminalCommandRegistry.getGitCommands(args.includes('--all') ? '/' : rootPath);
        await writeOutput(await git.tree());
        break;
      }

      case 'export':
      case 'export-page':
      case 'export--page':
      case 'export---page': {
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
        if (localArgs[0]?.toLowerCase() === '--page' && localArgs[1]) {
          const cwd = await unixInst.pwd();
          await exportPage(resolvePath(cwd, localArgs[1]), writeOutput);
        } else {
          await writeOutput('export: サポートされているのは "export --page <path>" のみです');
        }
        break;
      }

      case 'runtime-cache-clear':
      case 'runtime-cache':
      case 'cache-clear':
      case 'cache': {
        if ((cmd === 'runtime-cache' || cmd === 'cache') && args[0] !== 'clear') {
          await writeOutput('Usage: pyxis runtime-cache clear');
          break;
        }

        await fsClient.rm(`${RUNTIME_CACHE_PATH}/modules`, { recursive: true, force: true });
        await fsClient.rm(`${RUNTIME_CACHE_PATH}/meta`, { recursive: true, force: true });
        await fsClient.mkdir(`${RUNTIME_CACHE_PATH}/modules`, { recursive: true });
        await fsClient.mkdir(`${RUNTIME_CACHE_PATH}/meta`, { recursive: true });
        await writeOutput(`runtime-cache: ${RUNTIME_CACHE_PATH} を削除しました`);
        break;
      }

      case 'tmp-clear':
      case 'tmp': {
        if (cmd === 'tmp' && args[0] !== 'clear') {
          await writeOutput('Usage: pyxis tmp clear');
          break;
        }

        await clearDirectoryContents(TMP_PATH);
        await writeOutput('tmp: /tmp を削除しました');
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
            await writeOutput('i18n clear: 全ての翻訳キャッシュを削除しました');
          } else if (args.length >= 2) {
            const locale = args[0];
            const namespace = args[1];
            if (isSupportedLocale(locale)) {
              await deleteTranslationCache(locale, namespace);
              await writeOutput(
                `i18n clear: ${locale}-${namespace} の翻訳キャッシュを削除しました`
              );
            } else {
              await writeOutput(`i18n clear: サポートされていない言語です: ${locale}`);
            }
          } else {
            await writeOutput('i18n clear: 引数不正。使い方: pyxis i18n clear [locale namespace]');
          }
        } catch (e) {
          await writeOutput(`i18n clear: エラー: ${(e as Error).message}`);
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

            if (isStoreName(storeName)) {
              await storageService.clear(storeName);
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

      default:
        await writeOutput(`Unknown pyxis command: ${cmd}`);
    }
  } catch (error) {
    await writeOutput(`Error: ${(error as Error).message}`);
  }
}

export default handlePyxisCommand;
