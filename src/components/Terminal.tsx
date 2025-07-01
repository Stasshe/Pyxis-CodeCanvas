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
}

// クライアントサイド専用のターミナルコンポーネント
function ClientTerminal({ height, currentProject = 'default', projectFiles = [] }: TerminalProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<any>(null);
  const fitAddonRef = useRef<any>(null);
  const unixCommandsRef = useRef<UnixCommands | null>(null);
  const gitCommandsRef = useRef<GitCommands | null>(null);

  useEffect(() => {
    if (!terminalRef.current) return;

    // ファイルシステムの初期化
    initializeFileSystem();
    unixCommandsRef.current = new UnixCommands(currentProject);
    gitCommandsRef.current = new GitCommands(currentProject);

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
      scrollback: 1000,
    });

    // アドオンの追加
    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();
    
    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);

    // DOMに接続
    term.open(terminalRef.current);
    
    // サイズを調整
    setTimeout(() => {
      fitAddon.fit();
    }, 100);

    // 初期メッセージ
    term.writeln('Pyxis Terminal v1.0.0');
    term.writeln('UNIX-like commands and Git are available.');
    term.writeln('Type "help" for available commands.');

    // プロンプトを表示する関数
    const showPrompt = async () => {
      if (unixCommandsRef.current && gitCommandsRef.current) {
        const relativePath = unixCommandsRef.current.getRelativePath();
        const branch = await gitCommandsRef.current.getCurrentBranch();
        const branchDisplay = branch !== '(no git)' ? ` (${branch})` : '';
        term.write(`\r\n/workspaces/${currentProject}${relativePath}${branchDisplay} $ `);
      } else {
        term.write('\r\n$ ');
      }
    };

    // 初期プロンプト表示
    showPrompt();

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
            term.writeln('  ls [path] - ファイル一覧を表示');
            term.writeln('  cd <path> - ディレクトリを変更');
            term.writeln('  mkdir <name> [-p] - ディレクトリを作成');
            term.writeln('  touch <file> - ファイルを作成');
            term.writeln('  rm <file> [-r] - ファイルを削除');
            term.writeln('  cat <file> - ファイル内容を表示');
            term.writeln('  echo <text> [> file] - テキストを出力/ファイルに書き込み');
            term.writeln('');
            term.writeln('Git Commands:');
            term.writeln('  git init    - Gitリポジトリを初期化');
            term.writeln('  git status  - ステータスを確認');
            term.writeln('  git add <file|.|*> - ファイルをステージング');
            term.writeln('    git add .     - 全ファイルを追加');
            term.writeln('    git add *     - カレントディレクトリのファイルを追加');
            term.writeln('  git commit -m "message" - コミット');
            term.writeln('  git log     - コミット履歴を表示');
            break;
            
          case 'date':
            term.writeln(`\r\n${new Date().toLocaleString('ja-JP')}`);
            break;
            
          case 'whoami':
            term.writeln('\r\nuser');
            break;
            
          // Unix commands
          case 'pwd':
            if (unixCommandsRef.current) {
              const result = unixCommandsRef.current.pwd();
              term.writeln(`\r\n${result}`);
            }
            break;
            
          case 'ls':
            if (unixCommandsRef.current) {
              const result = await unixCommandsRef.current.ls(args[0]);
              term.writeln(`\r\n${result}`);
            }
            break;
            
          case 'cd':
            if (unixCommandsRef.current && args[0]) {
              const result = await unixCommandsRef.current.cd(args[0]);
              term.writeln(`\r\n${result}`);
            } else if (unixCommandsRef.current && !args[0]) {
              // cdのみの場合はプロジェクトルートに移動
              const projectRoot = `/projects/${currentProject}`;
              unixCommandsRef.current.setCurrentDir(projectRoot);
              term.writeln(`\r\nChanged directory to ${projectRoot}`);
            } else {
              term.writeln('\r\ncd: missing argument');
            }
            break;
            
          case 'mkdir':
            if (unixCommandsRef.current && args[0]) {
              const recursive = args.includes('-p');
              const dirName = args.find(arg => !arg.startsWith('-')) || args[0];
              const result = await unixCommandsRef.current.mkdir(dirName, recursive);
              term.writeln(`\r\n${result}`);
            } else {
              term.writeln('\r\nmkdir: missing argument');
            }
            break;
            
          case 'touch':
            if (unixCommandsRef.current && args[0]) {
              const result = await unixCommandsRef.current.touch(args[0]);
              term.writeln(`\r\n${result}`);
            } else {
              term.writeln('\r\ntouch: missing argument');
            }
            break;
            
          case 'rm':
            if (unixCommandsRef.current && args[0]) {
              const recursive = args.includes('-r') || args.includes('-rf');
              const fileName = args.find(arg => !arg.startsWith('-')) || args[args.length - 1];
              const result = await unixCommandsRef.current.rm(fileName, recursive);
              term.writeln(`\r\n${result}`);
            } else {
              term.writeln('\r\nrm: missing argument');
            }
            break;
            
          case 'cat':
            if (unixCommandsRef.current && args[0]) {
              const result = await unixCommandsRef.current.cat(args[0]);
              term.writeln(`\r\n${result}`);
            } else {
              term.writeln('\r\ncat: missing argument');
            }
            break;
            
          case 'echo':
            if (unixCommandsRef.current) {
              const redirectIndex = args.indexOf('>');
              if (redirectIndex !== -1 && args[redirectIndex + 1]) {
                const text = args.slice(0, redirectIndex).join(' ');
                const fileName = args[redirectIndex + 1];
                const result = await unixCommandsRef.current.echo(text, fileName);
                term.writeln(`\r\n${result}`);
              } else {
                const text = args.join(' ');
                const result = await unixCommandsRef.current.echo(text);
                term.writeln(`\r\n${result}`);
              }
            }
            break;
            
          // Git commands
          case 'git':
            if (gitCommandsRef.current && args[0]) {
              const gitCmd = args[0];
              switch (gitCmd) {
                case 'init':
                  const initResult = await gitCommandsRef.current.init();
                  term.writeln(`\r\n${initResult}`);
                  break;
                  
                case 'status':
                  const statusResult = await gitCommandsRef.current.status();
                  term.writeln(`\r\n${statusResult}`);
                  break;
                  
                case 'add':
                  if (args[1]) {
                    const addResult = await gitCommandsRef.current.add(args[1]);
                    term.writeln(`\r\n${addResult}`);
                  } else {
                    term.writeln('\r\ngit add: missing file argument');
                  }
                  break;
                  
                case 'commit':
                  const messageIndex = args.indexOf('-m');
                  if (messageIndex !== -1 && args[messageIndex + 1]) {
                    const message = args.slice(messageIndex + 1).join(' ').replace(/['"]/g, '');
                    const commitResult = await gitCommandsRef.current.commit(message);
                    term.writeln(`\r\n${commitResult}`);
                  } else {
                    term.writeln('\r\ngit commit: missing -m flag and message');
                  }
                  break;
                  
                case 'log':
                  const logResult = await gitCommandsRef.current.log();
                  term.writeln(`\r\n${logResult}`);
                  break;
                  
                default:
                  term.writeln(`\r\ngit: '${gitCmd}' is not a git command`);
                  break;
              }
            } else {
              term.writeln('\r\ngit: missing command');
            }
            break;
            
          default:
            if (cmd === '') {
              // 空のコマンドは何もしない
            } else {
              term.writeln(`\r\ncommand not found: ${command}`);
            }
            break;
        }
      } catch (error) {
        term.writeln(`\r\n${(error as Error).message}`);
      }
    };
    
    term.onData((data: string) => {
      switch (data) {
        case '\r': // Enter
          term.writeln('');
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
      term.dispose();
    };
  }, [currentProject]);

  // 高さが変更された時にサイズを再調整
  useEffect(() => {
    if (fitAddonRef.current) {
      setTimeout(() => {
        fitAddonRef.current?.fit();
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
      className="w-full h-full bg-[#1e1e1e]"
      style={{ height: `${height - 32}px` }}
    />
  );
}

// SSR対応のターミナルコンポーネント
export default function Terminal({ height, currentProject }: TerminalProps) {
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
  return <ClientTerminal height={height} currentProject={currentProject} />;
}
