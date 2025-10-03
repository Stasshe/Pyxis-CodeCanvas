'use client';

import { useEffect, useRef, useState } from 'react';
import { useTheme } from '@/context/ThemeContext';
import { UnixCommands } from '@/engine/cmd/unix';
import { GitCommands } from '@/engine/cmd/git';
import { NpmCommands } from '@/engine/cmd/npm';
import { gitFileSystem } from '@/engine/core/gitFileSystem';
import { syncManager } from '@/engine/core/syncManager';
import { fileRepository } from '@/engine/core/fileRepository';
import { pushMsgOutPanel } from '@/components/Bottom/BottomPanel';
import { handleGitCommand } from './TerminalGitCommands';
import { handleUnixCommand } from './TerminalUnixCommands';
import { handleNPMCommand } from './TerminalNPMCommands';
import { exportPage } from '@/engine/export/exportPage';
import { LOCALSTORAGE_KEY } from '@/context/config';

interface TerminalProps {
  height: number;
  currentProject?: string;
  currentProjectId?: string;
  isActive?: boolean;
}

// クライアントサイド専用のターミナルコンポーネント
function ClientTerminal({
  height,
  currentProject = 'default',
  currentProjectId = '',
  isActive,
}: TerminalProps) {
  const { colors } = useTheme();
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<any>(null);
  const fitAddonRef = useRef<any>(null);
  const unixCommandsRef = useRef<UnixCommands | null>(null);
  const gitCommandsRef = useRef<GitCommands | null>(null);
  const npmCommandsRef = useRef<NpmCommands | null>(null);

  // xterm/fitAddonをrefで保持
  useEffect(() => {
    if (!terminalRef.current) return;
    if (!currentProject || !currentProjectId) return;
    pushMsgOutPanel('Terminal initializing', 'info', 'Terminal');

    // ファイルシステムとFileRepositoryの初期化
    const initializeTerminal = async () => {
      try {
        // FileRepositoryを初期化
        await fileRepository.init();

        // GitFileSystemを初期化
        gitFileSystem.init();

        // [NEW ARCHITECTURE] fileRepositoryが自動的にlightning-fsに同期するため、
        // ここでの明示的な同期は不要（むしろ有害：ディレクトリクリアで新規ファイルが消える）
        // 初期化時の同期は、プロジェクト作成時のみsyncManager.initializeProjectで実行される
      } catch (error) {
        console.error('[Terminal] Initialization error:', error);
      }
    };

    initializeTerminal();
    unixCommandsRef.current = new UnixCommands(currentProject, currentProjectId);
    gitCommandsRef.current = new GitCommands(currentProject, currentProjectId);
    npmCommandsRef.current = new NpmCommands(
      currentProject,
      currentProjectId,
      '/projects/' + currentProject
    );

    // xterm関連のモジュールをrequire（クライアントサイドでのみ実行）
    const { Terminal: XTerm } = require('@xterm/xterm');
    const { FitAddon } = require('@xterm/addon-fit');
    const { WebLinksAddon } = require('@xterm/addon-web-links');

    // ターミナルの初期化
    const term = new XTerm({
      theme: {
        background: colors.editorBg,
        foreground: colors.editorFg,
        cursor: colors.editorCursor,
        black: '#000000',
        red: colors.red,
        green: '#0dbc79',
        yellow: '#e5e510',
        blue: colors.primary,
        magenta: '#bc3fbc',
        cyan: '#11a8cd',
        white: '#e5e5e5',
        brightBlack: '#666666',
        brightRed: '#f14c4c',
        brightGreen: '#23d18b',
        brightYellow: '#f5f543',
        brightBlue: '#3b8eea',
        brightMagenta: '#d670d6',
        brightCyan: '#29b8db',
        brightWhite: '#e5e5e5',
      },
      fontSize: 13,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      cursorBlink: true,
      scrollback: 5000,
      allowTransparency: false,
      bellStyle: 'none',
    });

    // アドオンの追加
    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();

    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);

    // DOMに接続
    term.open(terminalRef.current);

    // タッチスクロール機能を追加
    let startY = 0;
    let scrolling = false;

    const handleTouchStart = (e: TouchEvent) => {
      startY = e.touches[0].clientY;
      scrolling = false;
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!scrolling) {
        const currentY = e.touches[0].clientY;
        const deltaY = startY - currentY;

        if (Math.abs(deltaY) > 10) {
          scrolling = true;
          const scrollAmount = Math.round(deltaY / 20);

          if (scrollAmount > 0) {
            term.scrollLines(scrollAmount);
          } else {
            term.scrollLines(scrollAmount);
          }

          startY = currentY;
        }
      }
    };

    const handleTouchEnd = () => {
      scrolling = false;
    };

    // ホイールスクロール機能
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const scrollAmount = Math.round(e.deltaY / 100);
      term.scrollLines(scrollAmount);
    };

    // タッチイベントリスナーを追加
    if (terminalRef.current) {
      terminalRef.current.addEventListener('touchstart', handleTouchStart, { passive: true });
      terminalRef.current.addEventListener('touchmove', handleTouchMove, { passive: true });
      terminalRef.current.addEventListener('touchend', handleTouchEnd, { passive: true });
      terminalRef.current.addEventListener('wheel', handleWheel, { passive: false });
    }

    // サイズを調整
    setTimeout(() => {
      fitAddon.fit();
      setTimeout(() => {
        term.scrollToBottom();
        setTimeout(() => {
          fitAddon.fit();
          term.scrollToBottom();
        }, 100);
      }, 50);
    }, 100);

    // 初期メッセージ
    const pyxisVersion = process.env.PYXIS_VERSION || '(dev)';
    term.writeln(`Pyxis Terminal v${pyxisVersion} [NEW ARCHITECTURE]`);
    term.writeln('Type "help" for available commands.');

    // 確実な自動スクロール関数
    const scrollToBottom = () => {
      try {
        term.scrollToBottom();
        setTimeout(() => {
          try {
            const buffer = term.buffer.active;
            const viewportHeight = term.rows;
            const baseY = buffer.baseY;
            const cursorY = buffer.cursorY;
            const absoluteCursorLine = baseY + cursorY;
            const currentScrollTop = buffer.viewportY;
            const targetScrollTop = Math.max(0, absoluteCursorLine - viewportHeight + 1);
            const scrollDelta = targetScrollTop - currentScrollTop;

            if (scrollDelta > 0) {
              term.scrollLines(scrollDelta);
            }
            term.scrollToBottom();
          } catch (error) {
            term.scrollToBottom();
          }
        }, 50);
      } catch (error) {
        term.scrollToBottom();
      }
    };

    // プロンプトを表示する関数
    const showPrompt = async () => {
      if (unixCommandsRef.current && gitCommandsRef.current) {
        const relativePath = unixCommandsRef.current.getRelativePath();
        const branch = await gitCommandsRef.current.getCurrentBranch();
        let branchDisplay = '';
        if (branch !== '(no git)') {
          const branchColors = colors.gitBranchColors || [];
          const colorHex =
            branchColors.length > 0
              ? branchColors[
                  Math.abs(
                    branch.split('').reduce((a: number, c: string) => a + c.charCodeAt(0), 0)
                  ) % branchColors.length
                ]
              : colors.primary;
          const rgb = colorHex
            .replace('#', '')
            .match(/.{2}/g)
            ?.map(x => parseInt(x, 16)) || [0, 0, 0];
          branchDisplay = ` (\x1b[38;2;${rgb[0]};${rgb[1]};${rgb[2]}m${branch}\x1b[0m)`;
        }
        term.write(`\r/workspaces/${currentProject}${relativePath}${branchDisplay} $ `);
      } else {
        term.write('\r$ ');
      }
      scrollToBottom();
    };

    // 初期プロンプト表示
    showPrompt();

    let cmdOutputs = '';

    // コマンド履歴のlocalStorageキー
    const HISTORY_KEY = `${LOCALSTORAGE_KEY.TERMINAL_HISTORY}${currentProject}`;

    // 履歴の初期化・復元
    let commandHistory: string[] = [];
    try {
      const saved = localStorage.getItem(HISTORY_KEY);
      if (saved) {
        commandHistory = JSON.parse(saved);
      }
    } catch {}
    let historyIndex = -1;
    let currentLine = '';
    let cursorPos = 0;

    // 履歴保存関数
    const saveHistory = () => {
      try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(commandHistory));
      } catch {}
    };

    // 長い出力を段階的に処理する関数
    const writeOutput = async (output: string) => {
      const lines = output.split('\n');
      const batchSize = 20;
      for (let i = 0; i < lines.length; i += batchSize) {
        const batch = lines.slice(i, i + batchSize);
        cmdOutputs += batch.join('\n');
        for (const line of batch) {
          if (line === '' && i === 0) {
            term.writeln('\r');
          } else if (line !== '' || i > 0) {
            term.writeln(`\r${line}`);
          }
        }
      }
    };

    const processCommand = async (command: string) => {
      // リダイレクト演算子のパース
      let redirect = null;
      let fileName = null;
      let append = false;
      let baseCommand = command;
      const redirectMatch = command.match(/(.+?)\s*(>>|>)\s*([^>\s]+)\s*$/);
      if (redirectMatch) {
        baseCommand = redirectMatch[1].trim();
        redirect = redirectMatch[2];
        fileName = redirectMatch[3];
        append = redirect === '>>';
      }
      const parts = baseCommand.trim().split(/\s+/);
      const cmd = parts[0].toLowerCase();
      const args = parts.slice(1);

      // リダイレクト時にコマンド出力をキャプチャ
      let capturedOutput = '';
      const captureWriteOutput = async (output: string) => {
        capturedOutput += output + '\n';
        if (!redirect) {
          await writeOutput(output);
        }
      };

      try {
        switch (cmd) {
          case 'node':
            if (args.length === 0) {
              await captureWriteOutput('Usage: node <file.js>');
              break;
            }
            try {
              const { NodeJSRuntime } = await import('@/engine/runtime/nodeRuntime');
              const runtime = new NodeJSRuntime(
                currentProject,
                currentProjectId,
                (out: string, type: 'log' | 'error') => {
                  if (type === 'error') {
                    captureWriteOutput(`\x1b[31m${out}\x1b[0m`);
                  } else {
                    captureWriteOutput(out);
                  }
                }
              );
              const result = await runtime.executeFile(args[0]);
              if (result.success && result.output) {
                await captureWriteOutput(result.output);
              } else if (!result.success && result.error) {
                await captureWriteOutput(`\x1b[31m${result.error}\x1b[0m`);
              }
            } catch (e) {
              await captureWriteOutput(`node: エラー: ${(e as Error).message}`);
            }
            break;

          case 'debug-db':
            try {
              await captureWriteOutput('=== IndexedDB & Lightning-FS Debug Information ===\n');

              const dbs = await (window.indexedDB.databases ? window.indexedDB.databases() : []);

              for (const dbInfo of dbs) {
                const dbName = dbInfo.name;
                if (!dbName) continue;

                await captureWriteOutput(`\n--- Database: ${dbName} (v${dbInfo.version}) ---`);

                try {
                  const req = window.indexedDB.open(dbName);
                  const db = await new Promise<IDBDatabase>((resolve, reject) => {
                    req.onsuccess = () => resolve(req.result);
                    req.onerror = () => reject(req.error);
                  });

                  const objectStoreNames = Array.from(db.objectStoreNames);
                  await captureWriteOutput(`Object Stores: ${objectStoreNames.join(', ')}`);

                  for (const storeName of objectStoreNames) {
                    try {
                      const tx = db.transaction(storeName, 'readonly');
                      const store = tx.objectStore(storeName);
                      const getAllReq = store.getAll();
                      const items = await new Promise<any[]>((resolve, reject) => {
                        getAllReq.onsuccess = () => resolve(getAllReq.result);
                        getAllReq.onerror = () => reject(getAllReq.error);
                      });

                      await captureWriteOutput(`\n  Store: ${storeName} (${items.length} items)`);

                      if (items.length === 0) {
                        await captureWriteOutput('    (empty)');
                      } else {
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

                          await captureWriteOutput(`    [${i}] ${summary}`);
                        }

                        if (items.length > 10) {
                          await captureWriteOutput(`    ... and ${items.length - 10} more items`);
                        }
                      }
                    } catch (storeError) {
                      await captureWriteOutput(`    Error accessing store ${storeName}: ${storeError}`);
                    }
                  }

                  db.close();
                } catch (dbError) {
                  await captureWriteOutput(`  Error opening database ${dbName}: ${dbError}`);
                }
              }

              await captureWriteOutput('\n--- LocalStorage (Lightning-FS/pyxis-fs related) ---');
              const otherLightningFSKeys = [];
              for (let i = 0; i < window.localStorage.length; i++) {
                const key = window.localStorage.key(i);
                if (!key) continue;
                if (key.startsWith('fs/') || key.includes('lightning')) {
                  otherLightningFSKeys.push(key);
                }
              }

              if (otherLightningFSKeys.length === 0) {
                await captureWriteOutput('No Lightning-FS related localStorage entries found.');
              } else {
                await captureWriteOutput(`Lightning-FS related entries (${otherLightningFSKeys.length}):`);
                for (const key of otherLightningFSKeys.slice(0, 10)) {
                  const value = window.localStorage.getItem(key);
                  const size = value ? value.length : 0;
                  await captureWriteOutput(`  ${key}: ${size} chars`);
                }
              }

              await captureWriteOutput('\n--- File System Statistics ---');
              try {
                const fs = gitFileSystem.getFS();
                if (fs) {
                  try {
                    const projectsExists = await fs.promises.stat('/projects').catch(() => null);
                    if (projectsExists) {
                      const projectDirs = await fs.promises.readdir('/projects');
                      await captureWriteOutput(`Projects in filesystem: ${projectDirs.length}`);

                      for (const dir of projectDirs.slice(0, 10)) {
                        if (dir === '.' || dir === '..') continue;
                        try {
                          const projectPath = `/projects/${dir}`;
                          const files = await fs.promises.readdir(projectPath);
                          await captureWriteOutput(`  ${dir}: ${files.length} files/dirs`);
                        } catch {
                          await captureWriteOutput(`  ${dir}: (inaccessible)`);
                        }
                      }
                    } else {
                      await captureWriteOutput('No /projects directory found in filesystem');
                    }
                  } catch (fsError) {
                    await captureWriteOutput(`Error reading filesystem: ${fsError}`);
                  }
                } else {
                  await captureWriteOutput('Filesystem not initialized');
                }
              } catch (importError) {
                await captureWriteOutput(`Error importing filesystem: ${importError}`);
              }

              await captureWriteOutput('\n=== Debug Information Complete ===');
            } catch (e) {
              await captureWriteOutput(`debug-db: エラー: ${(e as Error).message}`);
            }
            break;

          case 'memory-clean':
            try {
              const fs = gitFileSystem.getFS();
              if (!fs) {
                await captureWriteOutput('memory-clean: ファイルシステムが初期化できませんでした');
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
                await captureWriteOutput(
                  `memory-clean: 以下のファイル・ディレクトリを削除しました:\n${cleaned.join('\n')}`
                );
              } else {
                await captureWriteOutput('memory-clean: 削除対象のファイルは見つかりませんでした');
              }
            } catch (e) {
              await captureWriteOutput(`memory-clean: エラー: ${(e as Error).message}`);
            }
            break;

          case 'fs-clean':
            try {
              const fs = gitFileSystem.getFS();
              if (!fs) {
                await captureWriteOutput('fs-clean: ファイルシステムが初期化できませんでした');
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
                await captureWriteOutput('fs-clean: /projects配下を全て削除しました');
              } catch (e) {
                await captureWriteOutput(`fs-clean: /projects削除エラー: ${(e as Error).message}`);
              }
              await captureWriteOutput('fs-clean: 完了');
            } catch (e) {
              await captureWriteOutput(`fs-clean: エラー: ${(e as Error).message}`);
            }
            break;

          case 'export':
            if (args[0]?.toLowerCase() === '--page' && args[1]) {
              const targetPath = args[1].startsWith('/')
                ? args[1]
                : `${unixCommandsRef.current?.pwd()}/${args[1]}`;
              const normalizedPath = unixCommandsRef.current?.normalizePath(targetPath);
              if (normalizedPath) {
                await exportPage(normalizedPath, writeOutput, unixCommandsRef);
              } else {
                await writeOutput('無効なパスが指定されました。');
              }
            } else if (args[0]?.toLowerCase() === '--indexeddb') {
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

          case 'clear':
            term.clear();
            break;

          case 'date':
            await captureWriteOutput(new Date().toLocaleString('ja-JP'));
            break;

          case 'whoami':
            await captureWriteOutput('user');
            break;

          case 'git':
            await handleGitCommand(args, gitCommandsRef, captureWriteOutput);
            break;

          case 'npm':
            await handleNPMCommand(args, npmCommandsRef, captureWriteOutput);
            break;

          case 'npm-size':
            if (args.length === 0) {
              await captureWriteOutput('Usage: npm-size <package-name>');
            } else {
              const packageName = args[0];
              try {
                const { calculateDependencySize } = await import(
                  '@/engine/cmd/npmOperations/npmDependencySize'
                );
                const size = await calculateDependencySize(packageName);
                await captureWriteOutput(
                  `Total size of ${packageName} and its dependencies: ${size.toFixed(2)} kB`
                );
              } catch (error) {
                await captureWriteOutput(`Error calculating size: ${(error as Error).message}`);
              }
            }
            break;

          case 'unzip':
            if (args.length === 0) {
              await captureWriteOutput('Usage: unzip <zipfile> [destdir]');
            } else if (!unixCommandsRef.current) {
              await captureWriteOutput('unzip: internal error (filesystem not initialized)');
            } else {
              const normalizedPath = unixCommandsRef.current?.normalizePath(args[0]);

              // FileRepositoryから直接取得
              try {
                const projects = await fileRepository.getProjects();
                const project = projects.find(p => p.name === currentProject);
                if (project) {
                  const dbFiles = await fileRepository.getProjectFiles(project.id);
                  const dbFile = dbFiles.find(f => f.path === normalizedPath);
                  if (dbFile && dbFile.isBufferArray && dbFile.bufferContent) {
                    const result = await unixCommandsRef.current.unzip(
                      normalizedPath,
                      args[1],
                      dbFile.bufferContent
                    );
                    await captureWriteOutput(result);
                  } else {
                    await captureWriteOutput(`unzip: ファイルが見つかりません: ${args[0]}`);
                  }
                } else {
                  await captureWriteOutput(
                    `unzip: プロジェクトが見つかりません: ${currentProject}`
                  );
                }
              } catch (dbError) {
                await captureWriteOutput(`unzip: エラー: ${(dbError as Error).message}`);
              }
            }
            break;

          case 'tree':
            if (!unixCommandsRef.current) {
              await captureWriteOutput('tree: internal error (filesystem not initialized)');
            } else {
              try {
                const result = await unixCommandsRef.current.tree(args[0], args.slice(1));
                await captureWriteOutput(result);
              } catch (e) {
                await captureWriteOutput(`tree: エラー: ${(e as Error).message}`);
              }
            }
            break;

          default:
            await handleUnixCommand(cmd, args, unixCommandsRef, currentProject, captureWriteOutput);
            break;
        }

        // リダイレクト処理
        if (redirect && fileName && unixCommandsRef.current) {
          // コマンド出力がない場合は空文字列として扱う
          const outputContent = capturedOutput || '';
          
          // ファイルパスを解決
          const fullPath = fileName.startsWith('/')
            ? fileName
            : `${await unixCommandsRef.current.pwd()}/${fileName}`;
          const normalizedPath = unixCommandsRef.current.normalizePath(fullPath);
          const relativePath = unixCommandsRef.current.getRelativePathFromProject(normalizedPath);

          try {
            let content = outputContent;

            // 追記モードの場合、既存のコンテンツを先頭に追加
            if (append) {
              const files = await fileRepository.getProjectFiles(currentProjectId);
              const existingFile = files.find(f => f.path === relativePath);
              if (existingFile && existingFile.content) {
                content = existingFile.content + content;
              }
            }

            // ファイルを保存または更新
            const files = await fileRepository.getProjectFiles(currentProjectId);
            const existingFile = files.find(f => f.path === relativePath);

            if (existingFile) {
              await fileRepository.saveFile({
                ...existingFile,
                content,
                updatedAt: new Date(),
              });
            } else {
              await fileRepository.createFile(currentProjectId, relativePath, content, 'file');
            }
          } catch (e) {
            await writeOutput(`ファイル書き込みエラー: ${(e as Error).message}`);
          }
          return;
        }
      } catch (error) {
        if (!redirect) {
          await writeOutput(`エラー: ${(error as Error).message}`);
        }
      }

      scrollToBottom();
      setTimeout(() => scrollToBottom(), 50);
      setTimeout(() => scrollToBottom(), 150);
    };

    // 選択範囲管理
    let selectionStart: number | null = null;
    let selectionEnd: number | null = null;
    let isSelecting = false;
    let isComposing = false;

    // IME入力対応
    term.textarea?.addEventListener('compositionstart', () => {
      isComposing = true;
    });
    term.textarea?.addEventListener('compositionend', () => {
      isComposing = false;
    });

    // ペースト対応
    term.textarea?.addEventListener('paste', (e: ClipboardEvent) => {
      e.preventDefault();
    });

    term.textarea?.addEventListener('beforeinput', (e: InputEvent) => {
      if (e.inputType === 'insertFromPaste') {
        // pasteイベントのみで処理
      }
    });

    // キーボードショートカット
    term.onKey(({ key, domEvent }: { key: string; domEvent: KeyboardEvent }) => {
      if (isComposing) return;

      if (domEvent.ctrlKey && !domEvent.shiftKey && !domEvent.altKey) {
        if (key === '\u001b[D') {
          if (cursorPos > 0) {
            let pos = cursorPos - 1;
            while (pos > 0 && currentLine[pos - 1] !== ' ') pos--;
            for (let i = 0; i < cursorPos - pos; i++) term.write('\b');
            cursorPos = pos;
          }
          domEvent.preventDefault();
        } else if (key === '\u001b[C') {
          let pos = cursorPos;
          while (pos < currentLine.length && currentLine[pos] !== ' ') pos++;
          while (pos < currentLine.length && currentLine[pos] === ' ') pos++;
          term.write(currentLine.slice(cursorPos, pos));
          cursorPos = pos;
          domEvent.preventDefault();
        }
      }

      if (domEvent.shiftKey && !domEvent.ctrlKey && !domEvent.altKey) {
        if (key === '\u001b[D') {
          if (!isSelecting) {
            selectionStart = cursorPos;
            isSelecting = true;
          }
          if (cursorPos > 0) {
            cursorPos--;
            selectionEnd = cursorPos;
            term.write('\b');
          }
          domEvent.preventDefault();
        } else if (key === '\u001b[C') {
          if (!isSelecting) {
            selectionStart = cursorPos;
            isSelecting = true;
          }
          if (cursorPos < currentLine.length) {
            term.write(currentLine[cursorPos]);
            cursorPos++;
            selectionEnd = cursorPos;
          }
          domEvent.preventDefault();
        }
      }

      if (
        domEvent.ctrlKey &&
        key === '\u0003' &&
        isSelecting &&
        selectionStart !== null &&
        selectionEnd !== null
      ) {
        const selStart = Math.min(selectionStart, selectionEnd);
        const selEnd = Math.max(selectionStart, selectionEnd);
        const selectedText = currentLine.slice(selStart, selEnd);
        navigator.clipboard.writeText(selectedText);
        isSelecting = false;
        selectionStart = null;
        selectionEnd = null;
        domEvent.preventDefault();
      }
    });

    // 通常のキー入力
    term.onData((data: string) => {
      if (isComposing) return;
      switch (data) {
        case '\r':
          term.writeln('');
          scrollToBottom();
          if (currentLine.trim()) {
            const command = currentLine.trim();
            const existingIndex = commandHistory.indexOf(command);
            if (existingIndex !== -1) {
              commandHistory.splice(existingIndex, 1);
            }
            commandHistory.push(command);
            if (commandHistory.length > 100) {
              commandHistory.shift();
            }
            saveHistory();
            historyIndex = -1;
            processCommand(currentLine).then(() => {
              showPrompt();
            });
          } else {
            showPrompt();
          }
          currentLine = '';
          cursorPos = 0;
          isSelecting = false;
          selectionStart = null;
          selectionEnd = null;
          break;
        case '\u007F':
          if (cursorPos > 0) {
            currentLine = currentLine.slice(0, cursorPos - 1) + currentLine.slice(cursorPos);
            cursorPos--;
            term.write('\b');
            term.write(currentLine.slice(cursorPos) + ' ');
            for (let i = 0; i < currentLine.length - cursorPos + 1; i++) term.write('\b');
          }
          break;
        case '\u0003':
          term.writeln('^C');
          currentLine = '';
          cursorPos = 0;
          historyIndex = -1;
          isSelecting = false;
          selectionStart = null;
          selectionEnd = null;
          showPrompt();
          break;
        case '\u001b[A':
          if (commandHistory.length > 0) {
            if (historyIndex === -1) {
              historyIndex = commandHistory.length - 1;
            } else if (historyIndex > 0) {
              historyIndex--;
            }
            for (let i = 0; i < cursorPos; i++) term.write('\b');
            for (let i = 0; i < currentLine.length; i++) term.write(' ');
            for (let i = 0; i < currentLine.length; i++) term.write('\b');
            currentLine = commandHistory[historyIndex];
            cursorPos = currentLine.length;
            term.write(currentLine);
            isSelecting = false;
            selectionStart = null;
            selectionEnd = null;
          }
          break;
        case '\u001b[B':
          if (commandHistory.length > 0 && historyIndex !== -1) {
            if (historyIndex < commandHistory.length - 1) {
              historyIndex++;
              for (let i = 0; i < cursorPos; i++) term.write('\b');
              for (let i = 0; i < currentLine.length; i++) term.write(' ');
              for (let i = 0; i < currentLine.length; i++) term.write('\b');
              currentLine = commandHistory[historyIndex];
              cursorPos = currentLine.length;
              term.write(currentLine);
              isSelecting = false;
              selectionStart = null;
              selectionEnd = null;
            } else {
              historyIndex = -1;
              for (let i = 0; i < cursorPos; i++) term.write('\b');
              for (let i = 0; i < currentLine.length; i++) term.write(' ');
              for (let i = 0; i < currentLine.length; i++) term.write('\b');
              currentLine = '';
              cursorPos = 0;
              isSelecting = false;
              selectionStart = null;
              selectionEnd = null;
            }
          }
          break;
        case '\u001b[D':
          if (cursorPos > 0) {
            term.write('\b');
            cursorPos--;
            if (isSelecting) selectionEnd = cursorPos;
          }
          break;
        case '\u001b[C':
          if (cursorPos < currentLine.length) {
            term.write(currentLine[cursorPos]);
            cursorPos++;
            if (isSelecting) selectionEnd = cursorPos;
          }
          break;
        default:
          if (data >= ' ' || data === '\t') {
            currentLine = currentLine.slice(0, cursorPos) + data + currentLine.slice(cursorPos);
            term.write(currentLine.slice(cursorPos));
            cursorPos++;
            for (let i = 0; i < currentLine.length - cursorPos; i++) term.write('\b');
            isSelecting = false;
            selectionStart = null;
            selectionEnd = null;
          }
          break;
      }
    });

    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    // クリーンアップ
    return () => {
      if (terminalRef.current) {
        terminalRef.current.removeEventListener('touchstart', handleTouchStart);
        terminalRef.current.removeEventListener('touchmove', handleTouchMove);
        terminalRef.current.removeEventListener('touchend', handleTouchEnd);
        terminalRef.current.removeEventListener('wheel', handleWheel);
      }
      term.dispose();
    };
  }, [currentProject, currentProjectId, colors]);

  // 高さが変更された時にサイズを再調整
  useEffect(() => {
    if (fitAddonRef.current && xtermRef.current) {
      setTimeout(() => {
        fitAddonRef.current?.fit();
        setTimeout(() => {
          xtermRef.current?.scrollToBottom();
        }, 100);
      }, 100);
    }
  }, [height]);

  return (
    <div
      ref={terminalRef}
      className="w-full h-full overflow-hidden relative terminal-container"
      style={{
        background: colors.editorBg,
        height: `${height - 32}px`,
        maxHeight: `${height - 32}px`,
        minHeight: '100px',
        touchAction: 'none',
        contain: 'layout style paint',
      }}
    />
  );
}

// SSR対応のターミナルコンポーネント
export default function Terminal({
  height,
  currentProject,
  currentProjectId,
  isActive,
}: TerminalProps) {
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const { colors } = useTheme();
  if (!isMounted) {
    return (
      <div
        className="w-full h-full flex items-center justify-center"
        style={{ height: `${height - 32}px`, background: colors.editorBg }}
      >
        <div
          className="text-sm"
          style={{ color: colors.mutedFg }}
        >
          ターミナルを初期化中...
        </div>
      </div>
    );
  }

  return (
    <ClientTerminal
      height={height}
      currentProject={currentProject}
      currentProjectId={currentProjectId}
      isActive={isActive}
    />
  );
}
