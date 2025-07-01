'use client';

import { useEffect, useRef, useState } from 'react';
import { UnixCommands, GitCommands, initializeFileSystem, syncProjectFiles } from '@/utils/filesystem';
import { FileItem } from '@/types';

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
  projectFiles?: FileItem[];
  onFileOperation?: (path: string, type: 'file' | 'folder' | 'delete', content?: string) => Promise<void>;
}

// クライアントサイド専用のターミナルコンポーネント
function ClientTerminal({ height, currentProject = 'default', projectFiles = [], onFileOperation }: TerminalProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<any>(null);
  const fitAddonRef = useRef<any>(null);
  const unixCommandsRef = useRef<UnixCommands | null>(null);
  const gitCommandsRef = useRef<GitCommands | null>(null);

  useEffect(() => {
    if (!terminalRef.current) return;

    // ファイルシステムの初期化
    initializeFileSystem();
    unixCommandsRef.current = new UnixCommands(currentProject, onFileOperation);
    gitCommandsRef.current = new GitCommands(currentProject, onFileOperation);

    // プロジェクトファイルをターミナルファイルシステムに同期
    const syncFiles = async () => {
      if (projectFiles.length > 0) {
        console.log('Syncing project files:', projectFiles);
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
        background: '#1e1e1e',
        foreground: '#d4d4d4',
        cursor: '#ffffff',
        black: '#000000',
        red: '#cd3131',
        green: '#0dbc79',
        yellow: '#e5e510',
        blue: '#2472c8',
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
    term.writeln('Pyxis Terminal v1.0.0');
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
        const branchDisplay = branch !== '(no git)' ? ` (${branch})` : '';
        term.write(`\r/workspaces/${currentProject}${relativePath}${branchDisplay} $ `);
      } else {
        term.write('\r$ ');
      }
      
      // プロンプト表示後、1回だけスクロール
      scrollToBottom();
    };

    // 初期プロンプト表示
    showPrompt();

    // 長い出力を段階的に処理する関数（シンプルで確実な処理）
    const writeOutput = async (output: string) => {
      const lines = output.split('\n');
      const batchSize = 20; // バッチサイズを適度に戻す
      
      for (let i = 0; i < lines.length; i += batchSize) {
        const batch = lines.slice(i, i + batchSize);
        
        for (const line of batch) {
          if (line === '' && i === 0) {
            // 最初の空行はスキップしない
            term.writeln('\r');
          } else if (line !== '' || i > 0) {
            term.writeln(`\r${line}`);
          }
        }
        
        // バッチ処理の合間に短時間待機
        if (i + batchSize < lines.length) {
          await new Promise(resolve => setTimeout(resolve, 10));
        }
      }
      
      // 全出力完了後、1〜2回の確実なスクロール
      scrollToBottom(true);
      
      // 最終確認のみ
      setTimeout(() => {
        scrollToBottom(true);
      }, 100);
    };

    // コマンド処理
    let currentLine = '';
    
    const processCommand = async (command: string) => {
      const parts = command.trim().split(/\s+/);
      const cmd = parts[0].toLowerCase();
      const args = parts.slice(1);
      
      try {
        switch (cmd) {
          case 'clear':
            term.clear();
            break;
            
          case 'help':
            term.writeln('\r\n=== 利用可能なコマンド ===');
            term.writeln('Basic Commands:');
            term.writeln('  clear     - 画面をクリア');
            term.writeln('  help      - このヘルプを表示');
            term.writeln('  date      - 現在の日時を表示');
            term.writeln('  whoami    - ユーザー名を表示');
            term.writeln('');
            term.writeln('File System Commands:');
            term.writeln('  pwd       - 現在のディレクトリを表示');
            term.writeln('  ls [path] - ワークスペースファイルをツリー形式で表示');
            term.writeln('  cd <path> - ディレクトリを変更 (プロジェクト内のみ)');
            term.writeln('  cd        - プロジェクトルートに戻る');
            term.writeln('  mkdir <name> [-p] - ディレクトリを作成');
            term.writeln('  touch <file> - ファイルを作成');
            term.writeln('  rm <file> [-r] - ファイルを削除 (ワイルドカード対応: rm *.txt)');
            term.writeln('  cat <file> - ファイル内容を表示');
            term.writeln('  echo <text> [> file] - テキストを出力/ファイルに書き込み');
            term.writeln('');
            term.writeln('Git Commands:');
            term.writeln('  git status  - ステータスを確認');
            term.writeln('  git add <file|.|*> - ファイルをステージング');
            term.writeln('    git add .     - 全ファイルを追加');
            term.writeln('    git add *     - カレントディレクトリのファイルを追加');
            term.writeln('  git commit -m "message" - コミット');
            term.writeln('  git log     - コミット履歴を表示');
            term.writeln('  git branch [name] [-d] - ブランチ操作');
            term.writeln('    git branch        - ブランチ一覧');
            term.writeln('    git branch <name> - ブランチ作成');
            term.writeln('    git branch -d <name> - ブランチ削除');
            term.writeln('  git checkout <branch> [-b] - ブランチ切り替え');
            term.writeln('    git checkout <name>   - ブランチ切り替え');
            term.writeln('    git checkout -b <name> - ブランチ作成&切り替え');
            term.writeln('  git revert <commit> - コミットを取り消し');
            term.writeln('  git reset [file] - ファイルのアンステージング');
            term.writeln('  git reset --hard <commit> - 指定コミットまでハードリセット');
            term.writeln('    git reset         - 全ファイルをアンステージング');
            term.writeln('    git reset <file>  - 特定ファイルをアンステージング');
            term.writeln('    git reset --hard <hash> - 危険！すべて破棄してコミットに戻る');
            term.writeln('  git diff [options] [file] - 変更差分を表示');
            term.writeln('    git diff          - ワーキングディレクトリの変更');
            term.writeln('    git diff --staged - ステージされた変更');
            term.writeln('    git diff <commit1> <commit2> - コミット間の差分');
            term.writeln('');
            term.writeln('Note: Gitリポジトリの初期化は左下の「プロジェクト管理」から');
            term.writeln('新規プロジェクトを作成することで自動的に行われます。');
            break;
            
          case 'date':
            await writeOutput(new Date().toLocaleString('ja-JP'));
            break;
            
          case 'whoami':
            await writeOutput('user');
            break;
            
          // Unix commands
          case 'pwd':
            if (unixCommandsRef.current) {
              const result = unixCommandsRef.current.pwd();
              await writeOutput(result);
            }
            break;
            
          case 'ls':
            if (unixCommandsRef.current) {
              const result = await unixCommandsRef.current.ls(args[0]);
              await writeOutput(result);
            }
            break;
            
          case 'cd':
            if (unixCommandsRef.current && args[0]) {
              const result = await unixCommandsRef.current.cd(args[0]);
              await writeOutput(result);
            } else if (unixCommandsRef.current && !args[0]) {
              // cdのみの場合はプロジェクトルートに移動
              const projectRoot = `/projects/${currentProject}`;
              unixCommandsRef.current.setCurrentDir(projectRoot);
              await writeOutput(`Changed directory to ${projectRoot}`);
            } else {
              await writeOutput('cd: missing argument');
            }
            break;
            
          case 'mkdir':
            if (unixCommandsRef.current && args[0]) {
              const recursive = args.includes('-p');
              const dirName = args.find(arg => !arg.startsWith('-')) || args[0];
              const result = await unixCommandsRef.current.mkdir(dirName, recursive);
              await writeOutput(result);
            } else {
              await writeOutput('mkdir: missing argument');
            }
            break;
            
          case 'touch':
            if (unixCommandsRef.current && args[0]) {
              const result = await unixCommandsRef.current.touch(args[0]);
              await writeOutput(result);
            } else {
              await writeOutput('touch: missing argument');
            }
            break;
            
          case 'rm':
            if (unixCommandsRef.current && args[0]) {
              const recursive = args.includes('-r') || args.includes('-rf');
              const fileName = args.find(arg => !arg.startsWith('-')) || args[args.length - 1];
              const result = await unixCommandsRef.current.rm(fileName, recursive);
              await writeOutput(result);
            } else {
              await writeOutput('rm: missing argument');
            }
            break;
            
          case 'cat':
            if (unixCommandsRef.current && args[0]) {
              const result = await unixCommandsRef.current.cat(args[0]);
              await writeOutput(result);
            } else {
              await writeOutput('cat: missing argument');
            }
            break;
            
          case 'echo':
            if (unixCommandsRef.current) {
              const redirectIndex = args.indexOf('>');
              if (redirectIndex !== -1 && args[redirectIndex + 1]) {
                const text = args.slice(0, redirectIndex).join(' ');
                const fileName = args[redirectIndex + 1];
                const result = await unixCommandsRef.current.echo(text, fileName);
                await writeOutput(result);
              } else {
                const text = args.join(' ');
                const result = await unixCommandsRef.current.echo(text);
                await writeOutput(result);
              }
            }
            break;
            
          // Git commands
          case 'git':
            if (gitCommandsRef.current && args[0]) {
              const gitCmd = args[0];
              switch (gitCmd) {
                case 'init':
                  const initMessage = `git init: Command not available from terminal
プロジェクトの初期化は左下の「プロジェクト管理」ボタンから
新規プロジェクトを作成してください。
新規プロジェクトには自動でGitリポジトリが設定されます。`;
                  await writeOutput(initMessage);
                  break;
                  
                case 'status':
                  const statusResult = await gitCommandsRef.current.status();
                  await writeOutput(statusResult);
                  break;
                  
                case 'add':
                  if (args[1]) {
                    const addResult = await gitCommandsRef.current.add(args[1]);
                    await writeOutput(addResult);
                  } else {
                    await writeOutput('git add: missing file argument');
                  }
                  break;
                  
                case 'commit':
                  const messageIndex = args.indexOf('-m');
                  if (messageIndex !== -1 && args[messageIndex + 1]) {
                    const message = args.slice(messageIndex + 1).join(' ').replace(/['"]/g, '');
                    const commitResult = await gitCommandsRef.current.commit(message);
                    await writeOutput(commitResult);
                  } else {
                    await writeOutput('git commit: missing -m flag and message');
                  }
                  break;
                  
                case 'log':
                  const logResult = await gitCommandsRef.current.log();
                  await writeOutput(logResult);
                  break;
                  
                case 'checkout':
                  if (args[1]) {
                    const createNew = args.includes('-b');
                    const branchName = args[args.indexOf('-b') + 1] || args[1];
                    const checkoutResult = await gitCommandsRef.current.checkout(branchName, createNew);
                    await writeOutput(checkoutResult);
                  } else {
                    await writeOutput('git checkout: missing branch name');
                  }
                  break;
                  
                case 'branch':
                  if (args[1]) {
                    const deleteFlag = args.includes('-d') || args.includes('-D');
                    const branchName = args.find(arg => !arg.startsWith('-'));
                    if (branchName) {
                      const branchResult = await gitCommandsRef.current.branch(branchName, deleteFlag);
                      await writeOutput(branchResult);
                    } else {
                      await writeOutput('git branch: missing branch name');
                    }
                  } else {
                    const branchResult = await gitCommandsRef.current.branch();
                    await writeOutput(branchResult);
                  }
                  break;
                  
                case 'revert':
                  if (args[1]) {
                    const revertResult = await gitCommandsRef.current.revert(args[1]);
                    await writeOutput(revertResult);
                  } else {
                    await writeOutput('git revert: missing commit hash');
                  }
                  break;
                  
                case 'reset':
                  if (args.includes('--hard') && args[args.indexOf('--hard') + 1]) {
                    // git reset --hard <commit>
                    const commitHash = args[args.indexOf('--hard') + 1];
                    const resetResult = await gitCommandsRef.current.reset({ hard: true, commit: commitHash });
                    await writeOutput(resetResult);
                  } else if (args[1]) {
                    // git reset <filepath>
                    const resetResult = await gitCommandsRef.current.reset({ filepath: args[1] });
                    await writeOutput(resetResult);
                  } else {
                    // git reset (全ファイルをアンステージング)
                    const resetResult = await gitCommandsRef.current.reset();
                    await writeOutput(resetResult);
                  }
                  break;
                  
                case 'diff':
                  if (args.includes('--staged') || args.includes('--cached')) {
                    // git diff --staged
                    const filepath = args.find(arg => !arg.startsWith('--'));
                    const diffResult = await gitCommandsRef.current.diff({ staged: true, filepath });
                    await writeOutput(diffResult);
                  } else if (args.length >= 2 && !args[0].startsWith('-') && !args[1].startsWith('-')) {
                    // git diff <commit1> <commit2>
                    const filepath = args[2];
                    const diffResult = await gitCommandsRef.current.diff({ 
                      commit1: args[0], 
                      commit2: args[1], 
                      filepath 
                    });
                    await writeOutput(diffResult);
                  } else {
                    // git diff [filepath]
                    const filepath = args.find(arg => !arg.startsWith('-'));
                    const diffResult = await gitCommandsRef.current.diff({ filepath });
                    await writeOutput(diffResult);
                  }
                  break;
                  
                default:
                  await writeOutput(`git: '${gitCmd}' is not a git command`);
                  break;
              }
            } else {
              await writeOutput('git: missing command');
            }
            break;
            
          default:
            if (cmd === '') {
              // 空のコマンドは何もしない
            } else {
              await writeOutput(`command not found: ${command}`);
            }
            break;
        }
      } catch (error) {
        await writeOutput((error as Error).message);
      }
      
      // コマンド実行後に確実な自動スクロール
      scrollToBottom();
      
      // 追加の安全策として複数回スクロールを実行
      setTimeout(() => {
        scrollToBottom();
      }, 50);
      
      setTimeout(() => {
        scrollToBottom();
      }, 150);
    };
    
    term.onData((data: string) => {
      switch (data) {
        case '\r': // Enter
          term.writeln('');
          // Enter押下時に1回スクロール
          scrollToBottom();
          
          if (currentLine.trim()) {
            processCommand(currentLine).then(() => {
              showPrompt();
            });
          } else {
            showPrompt();
          }
          currentLine = '';
          break;
        case '\u007F': // Backspace
          if (currentLine.length > 0) {
            currentLine = currentLine.slice(0, -1);
            term.write('\b \b');
          }
          break;
        case '\u0003': // Ctrl+C
          term.writeln('^C');
          currentLine = '';
          showPrompt();
          break;
        default:
          if (data >= ' ' || data === '\t') {
            currentLine += data;
            term.write(data);
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
        console.log('Project files changed, syncing:', projectFiles);
        const flatFiles = flattenFileItems(projectFiles);
        await syncProjectFiles(currentProject, flatFiles);
      }
    };
    syncFiles();
  }, [projectFiles, currentProject]);

  return (
    <div 
      ref={terminalRef}
      className="w-full h-full bg-[#1e1e1e] overflow-hidden relative terminal-container"
      style={{ 
        height: `${height - 32}px`,
        maxHeight: `${height - 32}px`,
        minHeight: '100px',
        touchAction: 'none',
        contain: 'layout style paint' // CSS containment でレイアウトを制限
      }}
    />
  );
}

// SSR対応のターミナルコンポーネント
export default function Terminal({ height, currentProject, projectFiles, onFileOperation }: TerminalProps) {
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  // サーバーサイドまたはマウント前はローディング表示
  if (!isMounted) {
    return (
      <div 
        className="w-full h-full bg-[#1e1e1e] flex items-center justify-center"
        style={{ height: `${height - 32}px` }}
      >
        <div className="text-gray-400 text-sm">ターミナルを初期化中...</div>
      </div>
    );
  }

  // クライアントサイドでマウント後のみ実際のターミナルを表示
  return <ClientTerminal height={height} currentProject={currentProject} projectFiles={projectFiles} onFileOperation={onFileOperation} />;
}
