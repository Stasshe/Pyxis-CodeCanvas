'use client';

import { useEffect, useRef, useState } from 'react';
import { useTheme } from '@/context/ThemeContext';
import { UnixCommands, GitCommands, NpmCommands, initializeFileSystem, syncProjectFiles } from '@/utils/core/filesystem';
import { FileItem } from '@/types';
import { pushMsgOutPanel } from '@/components/Bottom/BottomPanel';
import { handleGitCommand } from './TerminalGitCommands';
import { handleUnixCommand } from './TerminalUnixCommands';
import { handleNPMCommand } from './TerminalNPMCommands';
import { projectDB } from '@/utils/core/database';
import { exportPage } from '@/utils/export/exportPage';

// FileItemの階層構造をフラットな配列に変換
const flattenFileItems = (items: FileItem[], basePath = ''): Array<{ path: string; content?: string; type: 'file' | 'folder' }> => {
  const result: Array<{ path: string; content?: string; type: 'file' | 'folder' }> = [];
  
  for (const item of items) {
    const fullPath = basePath === '' ? `/${item.name}` : `${basePath}/${item.name}`;
    
    result.push({
      path: fullPath,
      content: item.content,
      type: item.type
    });
    
    if (item.children && item.children.length > 0) {
      result.push(...flattenFileItems(item.children, fullPath));
    }
  }
  
  return result;
};

interface TerminalProps {
  height: number;
  currentProject?: string;
  currentProjectId?: string;
  projectFiles?: FileItem[];
  onFileOperation?: (path: string, type: 'file' | 'folder' | 'delete', content?: string, isNodeRuntime?: boolean, isBufferArray?: boolean, bufferContent?: ArrayBuffer) => Promise<void>;
  isActive?: boolean;
}

// クライアントサイド専用のターミナルコンポーネント
function ClientTerminal({ height, currentProject = 'default', currentProjectId = '', projectFiles = [], onFileOperation, isActive }: TerminalProps) {
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
    if (!currentProject) return;
    pushMsgOutPanel('Terminal initialing','info','Terminal');

    // ファイルシステムの初期化
    initializeFileSystem();
  unixCommandsRef.current = new UnixCommands(currentProject, onFileOperation, currentProjectId);
    gitCommandsRef.current = new GitCommands(currentProject, onFileOperation);
    npmCommandsRef.current = new NpmCommands(currentProject, '/projects/' + currentProject, onFileOperation);

    // プロジェクトファイルをターミナルファイルシステムに同期
    const syncFiles = async () => {
      if (projectFiles.length > 0) {
        console.log('[Terminal]Syncing project files:', projectFiles);
        const flatFiles = flattenFileItems(projectFiles);
        console.log('Flattened files:', flatFiles);
        await syncProjectFiles(currentProject, flatFiles);
        console.log('Files synced to terminal filesystem');
      }
    };
    syncFiles();

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
        brightWhite: '#e5e5e5'
      },
      fontSize: 13,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      cursorBlink: true,
      scrollback: 5000, // スクロールバッファを大幅に増加
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
        
        if (Math.abs(deltaY) > 10) { // 最小スクロール距離
          scrolling = true;
          const scrollAmount = Math.round(deltaY / 20); // スクロール量を調整
          
          if (scrollAmount > 0) {
            term.scrollLines(scrollAmount); // 上にスクロール
          } else {
            term.scrollLines(scrollAmount); // 下にスクロール
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
      const scrollAmount = Math.round(e.deltaY / 100); // スクロール量を調整
      term.scrollLines(scrollAmount);
    };
    
    // タッチイベントリスナーを追加
    if (terminalRef.current) {
      terminalRef.current.addEventListener('touchstart', handleTouchStart, { passive: true });
      terminalRef.current.addEventListener('touchmove', handleTouchMove, { passive: true });
      terminalRef.current.addEventListener('touchend', handleTouchEnd, { passive: true });
      terminalRef.current.addEventListener('wheel', handleWheel, { passive: false });
    }
    
    // サイズを調整（複数段階で確実に）
    setTimeout(() => {
      fitAddon.fit();
      
      // 初期フィット後にスクロール位置を確認
      setTimeout(() => {
        term.scrollToBottom();
        
        // さらに確実にするため追加のフィットとスクロール
        setTimeout(() => {
          fitAddon.fit();
          term.scrollToBottom();
        }, 100);
      }, 50);
    }, 100);

    // 初期メッセージ
  const pyxisVersion = process.env.PYXIS_VERSION || '(dev)';
  term.writeln(`Pyxis Terminal v${pyxisVersion}`);
  term.writeln('Type "help" for available commands.');

    // 確実な自動スクロール関数
    const scrollToBottom = (force = false) => {
      try {
        // まず標準的な方法でスクロール
        term.scrollToBottom();
        
        // 確実に最下段に行くため、少し余分にスクロール
        setTimeout(() => {
          try {
            const buffer = term.buffer.active;
            const viewportHeight = term.rows;
            const baseY = buffer.baseY;
            const cursorY = buffer.cursorY;
            
            // 実際のカーソル位置
            const absoluteCursorLine = baseY + cursorY;
            
            // 現在のスクロール位置
            const currentScrollTop = buffer.viewportY;
            
            // 確実に最下段に表示されるスクロール位置
            const targetScrollTop = Math.max(0, absoluteCursorLine - viewportHeight + 1);
            
            // 必要なスクロール量
            const scrollDelta = targetScrollTop - currentScrollTop;
            
            if (scrollDelta > 0) {
              // 余分にスクロールして確実に最下段へ
              term.scrollLines(scrollDelta);
            }
            
            // 最終確認として標準メソッドも実行
            term.scrollToBottom();
            
          } catch (error) {
            // エラー時は標準メソッドにフォールバック
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
          // ブランチ名の色をThemeContextから取得
          const branchColors = colors.gitBranchColors || [];
          // ブランチ名ごとに色を決定（例: ハッシュで色選択）
          const colorHex = branchColors.length > 0
            ? branchColors[
                Math.abs(
                  branch.split('').reduce((a: number, c: string) => a + c.charCodeAt(0), 0)
                ) % branchColors.length
              ]
            : colors.primary;
          // HEXをRGBに変換
          const rgb = colorHex.replace('#','').match(/.{2}/g)?.map(x => parseInt(x, 16)) || [0,0,0];
          branchDisplay = ` (\x1b[38;2;${rgb[0]};${rgb[1]};${rgb[2]}m${branch}\x1b[0m)`;
        }
        term.write(`\r/workspaces/${currentProject}${relativePath}${branchDisplay} $ `);
      } else {
        term.write('\r$ ');
      }
      // プロンプト表示後、1回だけスクロール
      scrollToBottom();
    };

    // 初期プロンプト表示
    showPrompt();


    let cmdOutputs = '';

    // コマンド履歴のlocalStorageキー
    const HISTORY_KEY = `pyxis_terminal_history_${currentProject}`;

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

    // 長い出力を段階的に処理する関数（シンプルで確実な処理）
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
      // 末尾の >> file.txt または > file.txt を検出し、コマンド本体とファイル名に分離
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
      const output = '';
      try {
        switch (cmd) {
          case 'debug-db':
            // IndexedDB と Lightning-FS の全データを出力
            try {
              await writeOutput('=== IndexedDB & Lightning-FS Debug Information ===\n');
              
              // IndexedDB databases の取得
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
                      
                      if (items.length === 0) {
                        await writeOutput('    (empty)');
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
                              const contentSize = typeof item.content === 'string' 
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
                        
                        if (items.length > 50) {
                          await writeOutput(`    ... and ${items.length - 50} more items`);
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
              
              // LocalStorage の Lightning-FS 関連データを出力
              await writeOutput('\n--- LocalStorage (Lightning-FS related) ---');
              const lightningFSKeys = [];
              for (let i = 0; i < window.localStorage.length; i++) {
                const key = window.localStorage.key(i);
                if (key && (key.startsWith('fs/') || key.includes('lightning'))) {
                  lightningFSKeys.push(key);
                }
              }
              
              if (lightningFSKeys.length === 0) {
                await writeOutput('No Lightning-FS related localStorage entries found.');
              } else {
                await writeOutput(`Found ${lightningFSKeys.length} Lightning-FS related entries:`);
                for (const key of lightningFSKeys.slice(0, 20)) {
                  const value = window.localStorage.getItem(key);
                  const size = value ? value.length : 0;
                  await writeOutput(`  ${key}: ${size} chars`);
                }
                if (lightningFSKeys.length > 20) {
                  await writeOutput(`  ... and ${lightningFSKeys.length - 20} more entries`);
                }
              }
              
              // ファイルシステム統計
              await writeOutput('\n--- File System Statistics ---');
              try {
                const { getFileSystem } = await import('@/utils/core/filesystem');
                const fs = getFileSystem();
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
                      
                      if (projectDirs.length > 10) {
                        await writeOutput(`  ... and ${projectDirs.length - 10} more projects`);
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
            // 全プロジェクトをスキャンして、DBに存在しないファイル・フォルダ（特に.git）を削除
            try {
              const { getFileSystem, initializeFileSystem } = await import('@/utils/core/filesystem');
              const { projectDB } = await import('@/utils/core/database');
              
              let fs = getFileSystem();
              if (!fs) fs = initializeFileSystem();
              if (!fs) {
                await writeOutput('memory-clean: ファイルシステムが初期化できませんでした');
                break;
              }

              await projectDB.init();
              
              // 全プロジェクトのファイル一覧を取得
              const allProjects = await projectDB.getProjects();
              const allDbPaths = new Map<string, Set<string>>(); // projectName -> Set of paths
              
              for (const project of allProjects) {
                const projectFiles = await projectDB.getProjectFiles(project.id);
                allDbPaths.set(project.name, new Set(projectFiles.map(f => f.path)));
              }
              
              // 再帰削除関数
              async function removeFileOrDirectory(fs: any, path: string): Promise<void> {
                try {
                  const stat = await fs.promises.stat(path);
                  if (stat.isDirectory()) {
                    const files = await fs.promises.readdir(path);
                    for (const file of files) {
                      await removeFileOrDirectory(fs, `${path}/${file}`);
                    }
                    await fs.promises.rmdir(path);
                  } else {
                    await fs.promises.unlink(path);
                  }
                } catch {
                  // エラーは無視（既に削除済みなど）
                }
              }

              // プロジェクトディレクトリを再帰的に探索して、DBに存在しないファイルを削除
              async function cleanProjectDirectory(fs: any, projectName: string, dirPath: string, cleaned: string[]): Promise<void> {
                const dbPaths = allDbPaths.get(projectName);
                if (!dbPaths) {
                  // プロジェクトがDBに存在しない場合は全て削除（.gitも含む）
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
                    
                    // .gitディレクトリの処理：DBに存在するプロジェクトの場合は削除しない
                    if (file === '.git') {
                      // DBに存在するプロジェクトの.gitは保持
                      continue;
                    }
                    
                    // DBに存在しないファイル・フォルダを削除
                    if (!dbPaths.has(relativePath)) {
                      await removeFileOrDirectory(fs, fullPath);
                      cleaned.push(`${projectName}${relativePath}`);
                    } else {
                      // ディレクトリの場合は再帰的にチェック
                      try {
                        const stat = await fs.promises.stat(fullPath);
                        if (stat.isDirectory()) {
                          await cleanProjectDirectory(fs, projectName, fullPath, cleaned);
                        }
                      } catch {
                        // アクセスできない場合は無視
                      }
                    }
                  }
                } catch {
                  // ディレクトリが存在しない場合は無視
                }
              }

              const cleaned: string[] = [];
              
              try {
                // /projectsディレクトリが存在するかチェック
                await fs.promises.stat('/projects');
                
                // /projects配下の全ディレクトリをスキャン
                const projectDirs = await fs.promises.readdir('/projects');
                
                for (const dir of projectDirs) {
                  if (dir === '.' || dir === '..') continue;
                  
                  const projectPath = `/projects/${dir}`;
                  try {
                    const stat = await fs.promises.stat(projectPath);
                    if (stat.isDirectory()) {
                      await cleanProjectDirectory(fs, dir, projectPath, cleaned);
                    }
                  } catch {
                    // アクセスできないディレクトリは無視
                  }
                }
                
              } catch (e) {
                // /projectsディレクトリが存在しない場合もOK
              }
              
              // IndexedDB とLightningFSの直接クリーンアップも試行
              try {
                // LightningFSのデータをクリア
                if (typeof window !== 'undefined' && window.localStorage) {
                  const lightningFSKeys = [];
                  for (let i = 0; i < window.localStorage.length; i++) {
                    const key = window.localStorage.key(i);
                    if (key && (key.startsWith('fs/') || key.includes('lightning'))) {
                      lightningFSKeys.push(key);
                    }
                  }
                  for (const key of lightningFSKeys) {
                    window.localStorage.removeItem(key);
                    cleaned.push(`LocalStorage: ${key}`);
                  }
                }
                
                // IndexedDBのオーファンエントリのクリーンアップ
                if (typeof window !== 'undefined' && window.indexedDB) {
                  const dbNames = ['PyxisProjectDB', 'LightningFS'];
                  for (const dbName of dbNames) {
                    try {
                      const req = window.indexedDB.open(dbName);
                      req.onsuccess = () => {
                        const db = req.result;
                        // データベースバージョンを確認してクリーンアップが必要かチェック
                        db.close();
                      };
                    } catch {}
                  }
                }
              } catch (e) {
                // IndexedDB/LightningFSのクリーンアップエラーは無視
              }
              
              if (cleaned.length > 0) {
                await writeOutput(`memory-clean: 以下のファイル・ディレクトリを削除しました:\n${cleaned.join('\n')}`);
              } else {
                await writeOutput('memory-clean: 削除対象のファイルは見つかりませんでした');
              }
            } catch (e) {
              await writeOutput(`memory-clean: エラー: ${(e as Error).message}`);
            }
            break;
          case 'export':
            if (args[0]?.toLowerCase() === '--page' && args[1]) {
              const targetPath = args[1].startsWith('/') ? args[1] : `${unixCommandsRef.current?.pwd()}/${args[1]}`;
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
              const mod = await import('@/utils/export/exportIndexeddb');
              mod.exportIndexeddbHtmlWithWindow(writeOutput, win);
            } else {
              await writeOutput('export: サポートされているのは "export --page <path>" または "export --indexeddb" のみです');
            }
            break;
          case 'clear':
            term.clear();
            break;
              
          case 'date':
            await writeOutput(new Date().toLocaleString('ja-JP'));
            break;
            
          case 'whoami':
            await writeOutput('user');
            break;

          // Git commands
          case 'git':
            // 分割したGitコマンド処理に委譲
            await handleGitCommand(args, gitCommandsRef, writeOutput);
            break;
            
          case 'npm':
            await handleNPMCommand(args, npmCommandsRef, writeOutput);
            break;

          case 'npm-size':
            if (args.length === 0) {
              await writeOutput('Usage: npm-size <package-name>');
            } else {
              const packageName = args[0];
              try {
                const { calculateDependencySize } = await import('@/utils/cmd/npmOperations/npmDependencySize');
                const size = await calculateDependencySize(packageName);
                await writeOutput(`Total size of ${packageName} and its dependencies: ${size.toFixed(2)} kB`);
              } catch (error) {
                await writeOutput(`Error calculating size: ${(error as Error).message}`);
              }
            }
            break;
            
          // Unix commands
          case 'unzip':
            if (args.length === 0) {
              await writeOutput('Usage: unzip <zipfile> [destdir]');
            } else if (!unixCommandsRef.current) {
              await writeOutput('unzip: internal error (filesystem not initialized)');
            } else {
              // 修正: パスを正規化して検索
              const normalizedPath = unixCommandsRef.current?.normalizePath(args[0]);
              console.log('[unzip] Normalized path:', normalizedPath);
              let fileToUnzip = projectFiles.find(file => file.path === normalizedPath);
              console.log('[unzip] fileToUnzip from projectFiles:', fileToUnzip);
              
              // projectFilesで見つからない場合は、DBから直接取得
              if (!fileToUnzip && currentProject) {
                console.log('[unzip] File not found in projectFiles, checking DB...');
                try {
                  const projects = await projectDB.getProjects();
                  const project = projects.find(p => p.name === currentProject);
                  if (project) {
                    const dbFiles = await projectDB.getProjectFiles(project.id);
                    const dbFile = dbFiles.find(f => f.path === normalizedPath);
                    if (dbFile && dbFile.isBufferArray && dbFile.bufferContent) {
                      fileToUnzip = {
                        id: dbFile.id,
                        name: dbFile.name,
                        type: dbFile.type,
                        path: dbFile.path,
                        content: dbFile.content,
                        isBufferArray: dbFile.isBufferArray,
                        bufferContent: dbFile.bufferContent
                      } as FileItem;
                      console.log('[unzip] Found file in DB:', fileToUnzip);
                    }
                  }
                } catch (dbError) {
                  console.error('[unzip] DB lookup error:', dbError);
                }
              }
              
              if (!fileToUnzip) return await writeOutput(`unzip: ファイルが見つかりません: ${args[0]}`);
              const bufferContent = fileToUnzip.bufferContent;
              if (!bufferContent) return await writeOutput(`unzip: バッファコンテンツが見つかりません: ${args[0]}`);
              try {
                const result = await unixCommandsRef.current.unzip(normalizedPath, args[1], bufferContent);
                await writeOutput(result);
              } catch (e) {
                await writeOutput((e as Error).message);
              }
            }
            break;
          default:
            await handleUnixCommand(cmd, args, unixCommandsRef, currentProject, writeOutput);
            break;
        }
        if (redirect && fileName && unixCommandsRef.current && cmdOutputs !== undefined && cmdOutputs !== null) {
          const targetPath = fileName.startsWith('/') ? fileName : `${unixCommandsRef.current.pwd()}/${fileName}`;
          const normalizedPath = unixCommandsRef.current.normalizePath(targetPath);
          let content = String(cmdOutputs);
          if (append) {
            try {
              const prev = await unixCommandsRef.current.fs.promises.readFile(normalizedPath, { encoding: 'utf8' });
              content = (typeof prev === 'string' ? prev : String(prev)) + String(cmdOutputs);
            } catch {
              content = String(cmdOutputs);
            }
          }
          // ファイル書き込みは try-catch でエラーを握りつぶさず通知
          try {
            await unixCommandsRef.current.fs.promises.writeFile(normalizedPath, content);
            if (onFileOperation) {
              const relativePath = unixCommandsRef.current.getRelativePathFromProject(normalizedPath);
              await onFileOperation(relativePath, 'file', content);
            }
            cmdOutputs = ''; // 書き込み後は出力をリセット
          } catch (e) {
            await writeOutput(`ファイル書き込みエラー: ${(e as Error).message}`);
          }
          // ファイル出力時は画面出力しない
          return;
        }
        if (output !== undefined && output !== null) {
          await writeOutput(output);
        }
      } catch (error) {
        cmdOutputs = (error as Error).message;
      }
      // コマンド実行後に確実な自動スクロール
      scrollToBottom();
      setTimeout(() => {
        scrollToBottom();
      }, 50);
      setTimeout(() => {
        scrollToBottom();
      }, 150);
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

    // ペースト対応（Ctrl+V/iPad）
    // ペーストイベントはe.preventDefault()のみ実行し、currentLineへの追加は行わない
    term.textarea?.addEventListener('paste', (e: ClipboardEvent) => {
      e.preventDefault();
    });

    // iPadタッチペースト対応（insertFromPasteは何もしない）
    term.textarea?.addEventListener('beforeinput', (e: InputEvent) => {
      if (e.inputType === 'insertFromPaste') {
        // 何もしない（pasteイベントのみで処理）
        // e.preventDefault(); を削除
      }
    });

    // xterm.jsのonKeyでCtrl/Shift判定
  term.onKey(({ key, domEvent }: { key: string; domEvent: KeyboardEvent }) => {
      if (isComposing) return; // IME中は無視
      // Ctrl+←/→ 単語単位移動
      if (domEvent.ctrlKey && !domEvent.shiftKey && !domEvent.altKey) {
        if (key === '\u001b[D') { // Ctrl+←
          // 左の単語先頭へ
          if (cursorPos > 0) {
            let pos = cursorPos - 1;
            while (pos > 0 && currentLine[pos - 1] !== ' ') pos--;
            for (let i = 0; i < cursorPos - pos; i++) term.write('\b');
            cursorPos = pos;
          }
          domEvent.preventDefault();
        } else if (key === '\u001b[C') { // Ctrl+→
          // 右の単語末尾へ
          let pos = cursorPos;
          while (pos < currentLine.length && currentLine[pos] !== ' ') pos++;
          while (pos < currentLine.length && currentLine[pos] === ' ') pos++;
          term.write(currentLine.slice(cursorPos, pos));
          cursorPos = pos;
          domEvent.preventDefault();
        }
      }
      // Shift+←/→ 選択範囲
      if (domEvent.shiftKey && !domEvent.ctrlKey && !domEvent.altKey) {
        if (key === '\u001b[D') { // Shift+←
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
        } else if (key === '\u001b[C') { // Shift+→
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
      // Ctrl+Cで選択範囲コピー
      if (domEvent.ctrlKey && key === '\u0003' && isSelecting && selectionStart !== null && selectionEnd !== null) {
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

    // 通常のキー入力（既存処理）
    term.onData((data: string) => {
      if (isComposing) return; // IME中は無視
      switch (data) {
        case '\r': // Enter
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
        case '\u007F': // Backspace
          if (cursorPos > 0) {
            currentLine = currentLine.slice(0, cursorPos - 1) + currentLine.slice(cursorPos);
            cursorPos--;
            term.write('\b');
            term.write(currentLine.slice(cursorPos) + ' ');
            for (let i = 0; i < currentLine.length - cursorPos + 1; i++) term.write('\b');
          }
          break;
        case '\u0003': // Ctrl+C
          term.writeln('^C');
          currentLine = '';
          cursorPos = 0;
          historyIndex = -1;
          isSelecting = false;
          selectionStart = null;
          selectionEnd = null;
          showPrompt();
          break;
        case '\u001b[A': // 上矢印キー
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
        case '\u001b[B': // 下矢印キー
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
        case '\u001b[D': // ← 左
          if (cursorPos > 0) {
            term.write('\b');
            cursorPos--;
            if (isSelecting) selectionEnd = cursorPos;
          }
          break;
        case '\u001b[C': // → 右
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
      // イベントリスナーを削除
      if (terminalRef.current) {
        terminalRef.current.removeEventListener('touchstart', handleTouchStart);
        terminalRef.current.removeEventListener('touchmove', handleTouchMove);
        terminalRef.current.removeEventListener('touchend', handleTouchEnd);
        terminalRef.current.removeEventListener('wheel', handleWheel);
      }
      term.dispose();
    };
  // タブがアクティブになった時にfit/scrollToBottomを呼ぶ
  useEffect(() => {
    if (isActive && fitAddonRef.current && xtermRef.current) {
      setTimeout(() => {
        fitAddonRef.current?.fit();
        xtermRef.current?.scrollToBottom();
      }, 50);
    }
  }, [isActive]);
  }, [currentProject]);

  // 高さが変更された時にサイズを再調整
  useEffect(() => {
    if (fitAddonRef.current && xtermRef.current) {
      // まずサイズを調整
      setTimeout(() => {
        fitAddonRef.current?.fit();
        
        // リサイズ後の正確なスクロール（1回のみ）
        setTimeout(() => {
          xtermRef.current?.scrollToBottom();
        }, 100);
      }, 100);
    }
  }, [height, currentProject, projectFiles]);

  // プロジェクトファイルが変更されたときの同期
  useEffect(() => {
    const syncFiles = async () => {
      if (projectFiles.length > 0) {
        //console.log('Project files changed, syncing:', projectFiles);
        const flatFiles = flattenFileItems(projectFiles);
        await syncProjectFiles(currentProject, flatFiles);
      }
    };
    syncFiles();
  }, [projectFiles, currentProject]);

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
        contain: 'layout style paint'
      }}
    />
  );
}

// SSR対応のターミナルコンポーネント
export default function Terminal({ height, currentProject, currentProjectId, projectFiles, onFileOperation, isActive }: TerminalProps) {
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  // サーバーサイドまたはマウント前はローディング表示
  const { colors } = useTheme();
  if (!isMounted) {
    return (
      <div 
        className="w-full h-full flex items-center justify-center"
        style={{ height: `${height - 32}px`, background: colors.editorBg }}
      >
        <div className="text-sm" style={{ color: colors.mutedFg }}>ターミナルを初期化中...</div>
      </div>
    );
  }

  // クライアントサイドでマウント後のみ実際のターミナルを表示
  return <ClientTerminal height={height} currentProject={currentProject} currentProjectId={currentProjectId} projectFiles={projectFiles} onFileOperation={onFileOperation} isActive={isActive} />;
}
