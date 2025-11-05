'use client';

import { useEffect, useRef, useState } from 'react';
import { useTheme } from '@/context/ThemeContext';
import { useTranslation } from '@/context/I18nContext';
import { UnixCommands } from '@/engine/cmd/unix';
import { GitCommands } from '@/engine/cmd/git';
import { NpmCommands } from '@/engine/cmd/npm';
import { gitFileSystem } from '@/engine/core/gitFileSystem';
import { fileRepository } from '@/engine/core/fileRepository';
import { pushMsgOutPanel } from '@/components/Bottom/BottomPanel';
import { handleGitCommand } from './TerminalGitCommands';
import { handleUnixCommand } from './TerminalUnixCommands';
import { handleNPMCommand } from './TerminalNPMCommands';
import { handlePyxisCommand } from './TerminalPyxisCommands';
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

    // Use shared registry to ensure singleton instances per project.
    // Use a named async function + mounted flag for readability and to avoid updating refs after unmount.
    let mounted = true;
    const loadRegistry = async () => {
      try {
        const { terminalCommandRegistry } = await import('@/engine/cmd/terminalRegistry');
        if (!mounted) return;
        unixCommandsRef.current = terminalCommandRegistry.getUnixCommands(
          currentProject,
          currentProjectId
        );
        gitCommandsRef.current = terminalCommandRegistry.getGitCommands(
          currentProject,
          currentProjectId
        );
        npmCommandsRef.current = terminalCommandRegistry.getNpmCommands(
          currentProject,
          currentProjectId,
          '/projects/' + currentProject
        );
      } catch (e) {
        // Fallback to direct construction if registry import fails (backwards compat)
        if (!mounted) return;
        console.warn(
          '[Terminal] terminal registry load failed, falling back to direct instances',
          e
        );
        unixCommandsRef.current = new UnixCommands(currentProject, currentProjectId);
        gitCommandsRef.current = new GitCommands(currentProject, currentProjectId);
        npmCommandsRef.current = new NpmCommands(
          currentProject,
          currentProjectId,
          '/projects/' + currentProject
        );
      }
    };

    loadRegistry();

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
    const pyxisVersion = process.env.NEXT_PUBLIC_PYXIS_VERSION || '(dev)';
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
              const { NodeRuntime } = await import('@/engine/runtime/nodeRuntime');

              // デバッグコンソールを設定
              const debugConsole = {
                log: (...args: unknown[]) => {
                  const output = args
                    .map(arg =>
                      typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
                    )
                    .join(' ');
                  captureWriteOutput(output);
                },
                error: (...args: unknown[]) => {
                  const output = args
                    .map(arg =>
                      typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
                    )
                    .join(' ');
                  captureWriteOutput(`\x1b[31m${output}\x1b[0m`);
                },
                warn: (...args: unknown[]) => {
                  const output = args
                    .map(arg =>
                      typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
                    )
                    .join(' ');
                  captureWriteOutput(`\x1b[33m${output}\x1b[0m`);
                },
                clear: () => {
                  // Terminal clear is handled separately
                },
              };

              // Terminalの入力インターフェースを設定
              const onInput = (promptText: string, callback: (input: string) => void) => {
                // プロンプトを表示
                term.write(promptText);

                // 一時的な入力バッファ
                let inputBuffer = '';

                // readline入力モードを有効化
                isReadlineMode = true;

                // 入力ハンドラ
                readlineHandler = (data: string) => {
                  if (data === '\r') {
                    // Enter押下
                    term.write('\r\n');
                    const result = inputBuffer;
                    inputBuffer = '';
                    // readline入力モードを解除
                    isReadlineMode = false;
                    readlineHandler = null;
                    callback(result);
                  } else if (data === '\u007F') {
                    // Backspace
                    if (inputBuffer.length > 0) {
                      inputBuffer = inputBuffer.slice(0, -1);
                      term.write('\b \b');
                    }
                  } else if (data === '\u0003') {
                    // Ctrl+C
                    term.write('^C\r\n');
                    inputBuffer = '';
                    // readline入力モードを解除
                    isReadlineMode = false;
                    readlineHandler = null;
                    callback('');
                  } else if (data >= ' ' || data === '\t') {
                    inputBuffer += data;
                    term.write(data);
                  }
                };
              };

              // Resolve file path relative to current working directory when a relative
              // path is provided so that `node ./src/index.js` behaves like a real shell.
              let entryPath = args[0];
              try {
                if (unixCommandsRef.current) {
                  // If path is not absolute, join with cwd and normalize
                  if (!entryPath.startsWith('/')) {
                    const cwd = await unixCommandsRef.current.pwd();
                    const combined = cwd.replace(/\/$/, '') + '/' + entryPath;
                    entryPath = unixCommandsRef.current.normalizePath(combined);
                  } else {
                    // absolute path — normalize to collapse ./ ../ if any
                    entryPath = unixCommandsRef.current.normalizePath(entryPath);
                  }
                }
              } catch (e) {
                // Fallback to original arg if any error occurs during resolution
                entryPath = args[0];
              }

              const runtime = new NodeRuntime({
                projectId: currentProjectId,
                projectName: currentProject,
                filePath: entryPath,
                debugConsole,
                onInput,
              });

              await runtime.execute(entryPath);
            } catch (e) {
              await captureWriteOutput(`\x1b[31mnode: エラー: ${(e as Error).message}\x1b[0m`);
            }
            break;

          // New namespaced form: pyxis <category> <action> [...]
          case 'pyxis': {
            if (args.length === 0) {
              await captureWriteOutput(
                'pyxis: missing subcommand. Usage: pyxis <category> <action> [args]'
              );
              break;
            }
            const category = args[0];
            const action = args[1];

            // If there is no action token, the category itself is required to have an action
            if (!action) {
              await captureWriteOutput(
                'pyxis: missing action. Usage: pyxis <category> <action> [args]'
              );
              break;
            }

            // If the action token looks like a flag (starts with '-'), do NOT merge it into the command name.
            // Treat it as an argument for the category command: `pyxis export --indexeddb` -> cmd: 'export', args: ['--indexeddb']
            let cmdToCall: string;
            let subArgs: string[];
            if (action.startsWith('-')) {
              cmdToCall = category;
              subArgs = args.slice(1); // include the flag and following args
            } else {
              cmdToCall = `${category}-${action}`;
              subArgs = args.slice(2);
            }

            await handlePyxisCommand(
              cmdToCall,
              subArgs,
              { unixCommandsRef, gitCommandsRef, npmCommandsRef },
              currentProject,
              currentProjectId,
              captureWriteOutput
            );
            break;
          }

          case 'clear':
            term.clear();
            break;

          case 'git':
            await handleGitCommand(args, gitCommandsRef, captureWriteOutput);
            break;

          case 'npm':
            await handleNPMCommand(args, npmCommandsRef, captureWriteOutput);
            break;

          default: {
            // カスタムコマンドをチェック
            const { commandRegistry } = await import('@/engine/extensions/commandRegistry');
            if (commandRegistry.hasCommand(cmd)) {
              try {
                const currentDir = unixCommandsRef.current
                  ? await unixCommandsRef.current.pwd()
                  : `/projects/${currentProject}`;

                // コマンド実行に必要な最小限の情報を渡す
                // ExtensionManagerのラッパーでExtensionContextがマージされる
                const result = await commandRegistry.executeCommand(cmd, args, {
                  projectName: currentProject,
                  projectId: currentProjectId,
                  currentDirectory: currentDir,
                } as any);

                await captureWriteOutput(result);
              } catch (error) {
                await captureWriteOutput(`Error: ${(error as Error).message}`);
              }
            } else {
              // 通常のUnixコマンドとして処理
              await handleUnixCommand(
                cmd,
                args,
                unixCommandsRef,
                currentProject,
                captureWriteOutput
              );
            }
            break;
          }
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

    // readline入力モードフラグ
    let isReadlineMode = false;
    let readlineHandler: ((data: string) => void) | null = null;

    // 通常のキー入力
    term.onData((data: string) => {
      if (isComposing) return;

      // readline入力モード中は専用ハンドラに委譲
      if (isReadlineMode && readlineHandler) {
        readlineHandler(data);
        return;
      }
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
      // prevent updates from async tasks after unmount
      mounted = false;
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
  const { t } = useTranslation();
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
          {t('bottom.terminalInitializing')}
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
