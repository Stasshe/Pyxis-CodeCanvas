'use client';

import { useEffect, useRef, useState } from 'react';

import { pushMsgOutPanel } from '@/components/Bottom/BottomPanel';
import { useTranslation } from '@/context/I18nContext';
import { useTheme } from '@/context/ThemeContext';
import type { GitCommands } from '@/engine/cmd/global/git';
import type { NpmCommands } from '@/engine/cmd/global/npm';
import type { UnixCommands } from '@/engine/cmd/global/unix';
import { terminalCommandRegistry } from '@/engine/cmd/terminalRegistry';
import { handleVimCommand } from '@/engine/cmd/vim';
import { fileRepository } from '@/engine/core/fileRepository';
import { gitFileSystem } from '@/engine/core/gitFileSystem';
import {
  clearTerminalHistory,
  getTerminalHistory,
  saveTerminalHistory,
} from '@/stores/terminalHistoryStorage';

interface TerminalProps {
  height: number;
  currentProject?: string;
  currentProjectId?: string;
  isActive?: boolean;
  onVimModeChange?: (vimEditor: any | null) => void; // Callback for Vim mode changes
}

// クライアントサイド専用のターミナルコンポーネント
function ClientTerminal({
  height,
  currentProject = 'default',
  currentProjectId = '',
  isActive,
  onVimModeChange,
}: TerminalProps) {
  const { colors } = useTheme();
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<any>(null);
  const fitAddonRef = useRef<any>(null);
  const unixCommandsRef = useRef<UnixCommands | null>(null);
  const gitCommandsRef = useRef<GitCommands | null>(null);
  const npmCommandsRef = useRef<NpmCommands | null>(null);
  const shellRef = useRef<any>(null);
  const spinnerInterval = useRef<NodeJS.Timeout | null>(null);
  const vimEditorRef = useRef<any>(null); // Track active Vim editor instance

  // xterm/fitAddonをrefで保持
  useEffect(() => {
    if (!terminalRef.current) return;
    if (!currentProject || !currentProjectId) return;
    pushMsgOutPanel('Terminal initializing', 'info', 'Terminal');

    // ファイルシステムとFileRepositoryの初期化
    const startSpinner = () => {
      if (spinnerInterval.current) return;
      const term = xtermRef.current;
      if (!term) return;

      // npm-like braille spinner (matches modern npm CLI appearance)
      const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
      let i = 0;

      // Hide cursor
      term.write('\x1b[?25l');

      // Write initial frame in cyan, then reset color
      term.write('\x1b[36m' + frames[0] + '\x1b[0m');

      spinnerInterval.current = setInterval(() => {
        const next = frames[++i % frames.length];
        term.write('\b' + '\x1b[36m' + next + '\x1b[0m');
      }, 80);
    };

    const stopSpinner = () => {
      if (spinnerInterval.current) {
        clearInterval(spinnerInterval.current);
        spinnerInterval.current = null;
        const term = xtermRef.current;
        if (term) {
          // Clear spinner char, reset color and show cursor
          term.write('\b \b');
          term.write('\x1b[0m');
          term.write('\x1b[?25h');
        }
      }
    };

    const setLoading = (isLoading: boolean) => {
      if (isLoading) startSpinner();
      else stopSpinner();
    };

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
        // create or obtain a StreamShell instance from the shared registry so it's a per-project singleton
        try {
          let extRegistry: any = null;
          try {
            const mod = await import('@/engine/extensions/commandRegistry');
            extRegistry = mod.commandRegistry;
          } catch {}
          const shellInst = await terminalCommandRegistry.getShell(
            currentProject,
            currentProjectId,
            {
              unix: unixCommandsRef.current,
              commandRegistry: extRegistry,
              fileRepository,
            }
          );
          if (shellInst) shellRef.current = shellInst;
        } catch (e) {
          // non-fatal — Terminal will fallback to existing handlers
          console.error('[Terminal] failed to initialize StreamShell via registry', e);
        }
      } catch (e) {
        // Do NOT fallback to direct construction here — enforce single responsibility:
        // Terminal must rely on the terminalCommandRegistry to provide instances.
        if (!mounted) return;
        console.error(
          '[Terminal] terminal registry load failed — builtin commands not initialized',
          e
        );
        pushMsgOutPanel(
          'Terminal: failed to load terminalCommandRegistry — builtin commands unavailable',
          'error',
          'Terminal'
        );
        // Leave refs null so callers can handle the absence explicitly.
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
      // Update shell terminal size after fit
      terminalCommandRegistry.updateShellSize(currentProjectId, term.cols, term.rows);
      setTimeout(() => {
        term.scrollToBottom();
        setTimeout(() => {
          fitAddon.fit();
          term.scrollToBottom();
          // Update shell terminal size again after second fit
          terminalCommandRegistry.updateShellSize(currentProjectId, term.cols, term.rows);
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
            ?.map(x => Number.parseInt(x, 16)) || [0, 0, 0];
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

    // 履歴の初期化・復元（sessionStorageから）
    let commandHistory: string[] = getTerminalHistory(currentProject);
    let historyIndex = -1;
    let currentLine = '';
    let cursorPos = 0;

    // 履歴保存関数（sessionStorageへ）
    const saveHistory = () => {
      saveTerminalHistory(currentProject, commandHistory);
    };

    // Write lock to prevent concurrent writes causing newlines
    let isTermWriting = false;
    const writeQueue: string[] = [];

    const flushWriteQueue = () => {
      if (isTermWriting || writeQueue.length === 0) return;
      isTermWriting = true;
      const output = writeQueue.shift()!;
      term.write(output, () => {
        isTermWriting = false;
        flushWriteQueue(); // Process next in queue
      });
    };

    // 長い出力を段階的に処理する関数
    const writeOutput = async (output: string) => {
      // \nを\r\nに変換（xtermは\r\nが必要）
      const normalized = output.replace(/\r?\n/g, '\r\n');
      cmdOutputs += output;
      writeQueue.push(normalized);
      flushWriteQueue();
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
        // Don't add newlines to in-place updates (starts with \r for carriage return)
        // or cursor control sequences (starts with \x1b[)
        const isInPlaceUpdate = output.startsWith('\r') || output.startsWith('\x1b[?');

        // 末尾に改行がない場合は追加（すべてのコマンド出力を統一的に処理）
        // But skip for in-place updates which need to stay on the same line
        const normalizedOutput = isInPlaceUpdate || output.endsWith('\n') ? output : output + '\n';
        capturedOutput += normalizedOutput;

        if (!redirect) {
          await writeOutput(normalizedOutput);
        }
      };

      let skipTerminalRedirect = false;
      try {
        switch (cmd) {
          case 'clear':
            term.clear();
            term.write('\x1b[H\x1b[2J\x1b[3J');
            break;

          // 履歴表示・削除コマンド
          case 'history': {
            // args: ['clear'] -> clear history
            const sub = args[0];
            if (sub === 'clear' || sub === 'reset' || sub === '--clear') {
              try {
                commandHistory = [];
                saveHistory();
                // sessionStorageから明示的に削除
                clearTerminalHistory(currentProject);
                await captureWriteOutput('ターミナル履歴を削除しました');
              } catch (e) {
                await captureWriteOutput(`履歴削除エラー: ${(e as Error).message}`);
              }
            } else {
              if (commandHistory.length === 0) {
                await captureWriteOutput('履歴はありません');
              } else {
                for (let i = 0; i < commandHistory.length; i++) {
                  await captureWriteOutput(`${i + 1}: ${commandHistory[i]}`);
                }
              }
            }
            break;
          }

          case 'vim': {
            // Disable normal terminal input during vim mode
            vimModeActive = true;

            const vimEditor = await handleVimCommand(
              args,
              unixCommandsRef,
              captureWriteOutput,
              currentProject,
              currentProjectId,
              term, // Pass xterm instance
              () => {
                // On vim exit callback
                vimModeActive = false; // Re-enable normal terminal input
                vimEditorRef.current = null;
                if (onVimModeChange) onVimModeChange(null);
                term.clear();
                showPrompt();
              }
            );

            // Store Vim editor instance for ESC button
            vimEditorRef.current = vimEditor;
            if (onVimModeChange) onVimModeChange(vimEditor);

            break;
          }

          default: {
            // All commands (including git, npm, pyxis) are delegated to StreamShell
            // This enables POSIX-compliant pipelines like: git status && ls
            if (shellRef.current) {
              // delegate entire command to StreamShell which handles pipes/redirection/subst
              // リアルタイム出力コールバックを渡す
              const res = await shellRef.current.run(command, {
                stdout: (data: string) => {
                  // 即座にTerminalに表示（リアルタイム出力）
                  if (!redirect) {
                    writeOutput(data).catch(() => {});
                  }
                },
                stderr: (data: string) => {
                  // stderrも即座に表示
                  if (!redirect) {
                    writeOutput(data).catch(() => {});
                  }
                },
              });
              // 完了後は何もしない（既にコールバックで出力済み）
              // StreamShell (shellRef) はリダイレクトを内部で処理しているため
              // Terminal側でのファイル書き込みは行わないようにする。
              if (redirect && fileName && unixCommandsRef.current) {
                skipTerminalRedirect = true;
              }
            } else {
              await captureWriteOutput(`${cmd}: shell not initialized`);
            }
            break;
          }
        }

        // リダイレクト処理
        if (!skipTerminalRedirect && redirect && fileName && unixCommandsRef.current) {
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
              // Use indexed single-file lookup for append
              try {
                const existingFile = await fileRepository.getFileByPath(
                  currentProjectId,
                  relativePath
                );
                if (existingFile && existingFile.content) {
                  content = existingFile.content + content;
                }
              } catch (e) {
                // ignore and proceed with content as-is
              }
            }

            // ファイルを保存または更新
            const existingFile = await fileRepository.getFileByPath(currentProjectId, relativePath);

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
    // フラグ: onKey で処理した直後に onData の二重処理を抑止する
    let ignoreNextOnData = false;

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

      // Home / End / Meta(Command) + Arrow のサポート
      // - Home / Meta+Left: 行頭へ移動
      // - End  / Meta+Right: 行末へ移動
      // これらは DOM の key を優先して扱う（Mac の Cmd などを正しく検出するため）
      if (domEvent.key === 'Home' || (domEvent.metaKey && domEvent.key === 'ArrowLeft')) {
        if (cursorPos > 0) {
          for (let i = 0; i < cursorPos; i++) term.write('\b');
          cursorPos = 0;
          if (isSelecting) selectionEnd = cursorPos;
        }
        ignoreNextOnData = true;
        domEvent.preventDefault();
        return;
      }

      if (domEvent.key === 'End' || (domEvent.metaKey && domEvent.key === 'ArrowRight')) {
        if (cursorPos < currentLine.length) {
          term.write(currentLine.slice(cursorPos));
          cursorPos = currentLine.length;
          if (isSelecting) selectionEnd = cursorPos;
        }
        ignoreNextOnData = true;
        domEvent.preventDefault();
        return;
      }

      // Ctrl + ←/→ : 単語単位移動（既存の実装を DOM の key 名でも扱う）
      if (domEvent.ctrlKey && !domEvent.shiftKey && !domEvent.altKey) {
        if (domEvent.key === 'ArrowLeft' || key === '\u001b[D') {
          if (cursorPos > 0) {
            let pos = cursorPos - 1;
            while (pos > 0 && currentLine[pos - 1] !== ' ') pos--;
            for (let i = 0; i < cursorPos - pos; i++) term.write('\b');
            cursorPos = pos;
          }
          ignoreNextOnData = true;
          domEvent.preventDefault();
        } else if (domEvent.key === 'ArrowRight' || key === '\u001b[C') {
          let pos = cursorPos;
          while (pos < currentLine.length && currentLine[pos] !== ' ') pos++;
          while (pos < currentLine.length && currentLine[pos] === ' ') pos++;
          term.write(currentLine.slice(cursorPos, pos));
          cursorPos = pos;
          ignoreNextOnData = true;
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
    let vimModeActive = false; // Flag to disable normal input during vim mode

    term.onData((data: string) => {
      if (ignoreNextOnData) {
        // clear and ignore a single following onData payload
        ignoreNextOnData = false;
        return;
      }
      if (isComposing || vimModeActive) return; // Skip if vim is active

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
          // send SIGINT to foreground process if available
          try {
            if (shellRef.current && typeof shellRef.current.killForeground === 'function') {
              console.log('[Terminal] Ctrl+C detected, killing foreground process');
              shellRef.current.killForeground();
            } else {
              console.warn('[Terminal] Ctrl+C detected but no shell or killForeground method available');
            }
          } catch (e) {
            console.error('[Terminal] Error killing foreground process:', e);
          }
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
        // Update shell terminal size after resize
        if (currentProjectId && xtermRef.current) {
          terminalCommandRegistry.updateShellSize(
            currentProjectId,
            xtermRef.current?.cols ?? 80,
            xtermRef.current?.rows ?? 24
          );
        }
        setTimeout(() => {
          xtermRef.current?.scrollToBottom();
        }, 100);
      }, 100);
    }
  }, [height]);

  // ターミナルがアクティブになった時にフォーカスを当てる
  useEffect(() => {
    if (isActive && xtermRef.current) {
      // 少し遅延を入れてフォーカスを当てる（DOMの更新を待つ）
      const timeoutId = setTimeout(() => {
        if (xtermRef.current) {
          try {
            xtermRef.current.focus();
          } catch (e) {
            console.warn('[Terminal] Failed to focus:', e);
          }
        }
      }, 50);

      return () => clearTimeout(timeoutId);
    }
  }, [isActive]);

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
  onVimModeChange,
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
        <div className="text-sm" style={{ color: colors.mutedFg }}>
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
      onVimModeChange={onVimModeChange}
    />
  );
}
