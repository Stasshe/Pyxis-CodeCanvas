'use client';

import { useEffect, useRef, useState } from 'react';

import { useTranslation } from '@/context/I18nContext';
import { useTheme } from '@/context/ThemeContext';
import type { VimEditor } from '@/engine/cmd/app/vim/VimEditor';
import type { GitCommands } from '@/engine/cmd/global/git';
import type { NpmCommands } from '@/engine/cmd/global/npm';
import type { UnixCommands } from '@/engine/cmd/global/unix';
import { handleVimCommand } from '@/engine/cmd/handlers/vimHandler';
import { TerminalOutputManager } from '@/engine/cmd/terminalOutputManager';
import { terminalProcessBridge } from '@/engine/cmd/terminalProcessBridge';
import { terminalCommandRegistry } from '@/engine/cmd/terminalRegistry';
import TerminalUI from '@/engine/cmd/terminalUI';
import { fileRepository } from '@/engine/core/fileRepository';
import { gitFileSystem } from '@/engine/core/gitFileSystem';
import { pushLogMessage } from '@/stores/loggerStore';
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
  onVimModeChange?: (vimEditor: VimEditor | null) => void; // Callback for Vim mode changes
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
  const outputManagerRef = useRef<TerminalOutputManager | null>(null);
  const terminalUIRef = useRef<any | null>(null);
  const unixCommandsRef = useRef<UnixCommands | null>(null);
  const gitCommandsRef = useRef<GitCommands | null>(null);
  const npmCommandsRef = useRef<NpmCommands | null>(null);
  const shellRef = useRef<any>(null);
  const vimEditorRef = useRef<VimEditor | null>(null); // Track active Vim editor instance

  // xterm/fitAddonをrefで保持
  useEffect(() => {
    if (!terminalRef.current) return;
    if (!currentProject || !currentProjectId) return;
    pushLogMessage('Terminal initializing', 'info', 'Terminal');

    const initializeTerminal = async () => {
      try {
        // FileRepositoryを初期化
        await fileRepository.init();

        // GitFileSystemを初期化
        gitFileSystem.init();

        // fileRepositoryが自動的にlightning-fsに同期するため、
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
        npmCommandsRef.current = await terminalCommandRegistry.getNpmCommands(
          currentProject,
          currentProjectId
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
        pushLogMessage(
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

    // Initialize output manager for centralized output handling
    const outputManager = new TerminalOutputManager(term);
    outputManagerRef.current = outputManager;

    // Initialize TerminalUI
    const terminalUI = new TerminalUI(outputManager);
    terminalUIRef.current = terminalUI;

    // Register UI with the shared terminal registry so command classes can access it
    try {
      terminalCommandRegistry.setTerminalUI(currentProjectId, terminalUI);
    } catch (e) {
      console.warn('[Terminal] failed to register TerminalUI with registry', e);
    }

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

    // サイズ調整 — rAFで順次実行。timeoutでDOM安定を祈らない
    const fitAndSync = () => {
      fitAddon.fit();
      terminalCommandRegistry.updateShellSize(currentProjectId, term.cols, term.rows);
    };
    const nextFrame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    (async () => {
      await nextFrame();
      if (!mounted) return;
      fitAndSync();
      await nextFrame();
      if (!mounted) return;
      term.scrollToBottom();
      await nextFrame();
      if (!mounted) return;
      fitAndSync();
      term.scrollToBottom();
    })();

    // 初期化処理を非同期で実行
    const initializeMessages = async () => {
      // 初期メッセージ via TerminalUI
      const pyxisVersion = process.env.NEXT_PUBLIC_PYXIS_VERSION || '(dev)';
      await terminalUI.info(`Pyxis Terminal v${pyxisVersion}`);
      await terminalUI.println('Type "help" for available commands.');
      // 初期プロンプト表示
      await showPrompt();
    };

    // 確実な自動スクロール関数
    const scrollToBottom = () => {
      if (!mounted) return;
      term.scrollToBottom();
      // rAFで次フレームに補正スクロール（カーソル位置確定後）
      requestAnimationFrame(() => {
        if (!mounted) return;
        const buffer = term.buffer.active;
        const viewportHeight = term.rows;
        const absoluteCursorLine = buffer.baseY + buffer.cursorY;
        const scrollDelta = absoluteCursorLine - buffer.viewportY - viewportHeight + 1;
        if (scrollDelta > 0) {
          term.scrollLines(scrollDelta);
        }
        term.scrollToBottom();
      });
    };

    // プロンプトを表示する関数
    const showPrompt = async () => {
      // CRITICAL: Wait for all pending output to complete before checking cursor position
      // This ensures cursor position is accurate
      await outputManager.flush();

      // Ensure we're on a new line - this is the key to preventing prompt overlap
      // Linux/Windows terminals always ensure prompts start on a new line
      await outputManager.ensureNewline();

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
        await outputManager.writeRaw(
          `/workspaces/${currentProject}${relativePath}${branchDisplay} $ `
        );
      } else {
        await outputManager.writeRaw('$ ');
      }

      // CRITICAL: Wait for prompt to be written before scrolling
      await outputManager.flush();

      // Scroll to bottom after all output and prompt are complete
      scrollToBottom();
      // Additional scrolls with delay to ensure proper positioning
      setTimeout(() => scrollToBottom(), 50);
      setTimeout(() => scrollToBottom(), 150);
    };

    // 履歴の初期化・復元（storageServiceへ）
    let commandHistory: string[] = [];
    let historyIndex = -1;
    let currentLine = '';
    let cursorPos = 0;

    // 履歴をロードする（非同期）
    const loadHistory = async () => {
      try {
        const saved = await getTerminalHistory(currentProject);
        if (Array.isArray(saved)) {
          commandHistory = saved;
          historyIndex = commandHistory.length;
        }
      } catch (e) {
        console.warn('[Terminal] Failed to load terminal history:', e);
      }
    };
    // 起動時にロード（非同期で問題なし）
    loadHistory();

    // 履歴保存関数（storageServiceへ）
    const saveHistory = async () => {
      await saveTerminalHistory(currentProject, commandHistory);
    };

    // 統一された出力関数 - すべての出力はこれを通る
    const writeOutput = async (output: string) => {
      await outputManagerRef.current?.write(output);
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
        const normalizedOutput = isInPlaceUpdate || output.endsWith('\n') ? output : `${output}\n`;
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
                await saveHistory();
                // storageServiceから明示的に削除
                await clearTerminalHistory(currentProject);
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

            const vimEditor =
              (await handleVimCommand(
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
              )) ?? null;

            // Store Vim editor instance for ESC button
            vimEditorRef.current = vimEditor;
            if (onVimModeChange) onVimModeChange(vimEditor);

            break;
          }

          default: {
            // All commands (including git, npm, pyxis) are delegated to StreamShell
            // This enables POSIX-compliant pipelines like: git status && ls
            if (shellRef.current) {
              // Track all async writeOutput promises to ensure they complete before showing prompt
              const outputPromises: Promise<void>[] = [];

              // delegate entire command to StreamShell which handles pipes/redirection/subst
              // リアルタイム出力コールバックを渡す
              await shellRef.current.run(command, {
                stdout: (data: string) => {
                  // 即座にTerminalに表示（リアルタイム出力）
                  if (!redirect) {
                    const promise = writeOutput(data).catch(() => {});
                    outputPromises.push(promise);
                  }
                },
                stderr: (data: string) => {
                  if (!redirect) {
                    // Warning detection (case-insensitive)
                    const trimmed = data.trim();
                    let promise: Promise<void>;
                    if (/^warning:/i.test(trimmed)) {
                      promise =
                        outputManagerRef.current?.writeWarning(`${trimmed}\n`)?.catch(() => {}) ??
                        Promise.resolve();
                    } else {
                      promise =
                        outputManagerRef.current?.writeError(`${trimmed}\n`)?.catch(() => {}) ??
                        Promise.resolve();
                    }
                    outputPromises.push(promise as Promise<void>);
                  }
                },
              });

              // CRITICAL: Wait for all output to complete before returning
              // This ensures cursor position is correct before showPrompt() is called
              await Promise.all(outputPromises);

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
                if (existingFile?.content) {
                  content = existingFile.content + content;
                }
              } catch (e) {
                console.warn('[Terminal.tsx] caught non-fatal error', e);
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

    // ペースト対応 (Ctrl+V は attachCustomKeyEventHandler で処理、Ctrl+Shift+V などブラウザネイティブ経由はここで処理)
    term.textarea?.addEventListener('paste', (e: ClipboardEvent) => {
      e.preventDefault();
      handlePasteText(e.clipboardData?.getData('text/plain') ?? '');
    });

    const copyTextToClipboard = (text: string) => {
      const fallbackCopy = () => {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.left = '-9999px';
        textarea.style.top = '0';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        try {
          document.execCommand('copy');
        } finally {
          textarea.remove();
          term.focus();
        }
      };

      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(text).catch(fallbackCopy);
      } else {
        fallbackCopy();
      }
    };

    const copyTerminalSelection = () => {
      const selection = typeof term.getSelection === 'function' ? term.getSelection() : '';
      if (!selection) return false;
      copyTextToClipboard(selection);
      return true;
    };

    // カーソル位置にテキスト挿入し画面を更新する共通処理
    const insertAtCursor = (
      line: string,
      pos: number,
      text: string
    ): { line: string; pos: number } => {
      const next = line.slice(0, pos) + text + line.slice(pos);
      term.write(next.slice(pos));
      const newPos = pos + text.length;
      const back = next.length - newPos;
      for (let i = 0; i < back; i++) term.write('\b');
      return { line: next, pos: newPos };
    };

    const handlePasteText = (text: string) => {
      if (!text || vimModeActive) return;

      if (terminalProcessBridge.isActive()) {
        ({ line: interactiveLine, pos: interactivePos } = insertAtCursor(
          interactiveLine,
          interactivePos,
          text
        ));
        return;
      }

      ({ line: currentLine, pos: cursorPos } = insertAtCursor(currentLine, cursorPos, text));
    };

    term.attachCustomKeyEventHandler((event: KeyboardEvent) => {
      if (event.type !== 'keydown') return true;

      const ctrl = event.ctrlKey || event.metaKey;

      // Ctrl+C: copy selection
      if (ctrl && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'c') {
        if (copyTerminalSelection()) {
          event.preventDefault();
          event.stopPropagation();
          return false;
        }
      }

      // Ctrl+V / Ctrl+Shift+V: paste (両方横取りしてClipboard API経由に統一)
      if (ctrl && !event.altKey && event.key.toLowerCase() === 'v') {
        event.preventDefault();
        navigator.clipboard
          .readText()
          .then(handlePasteText)
          .catch(() => {});
        return false;
      }

      return true;
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
        }
        ignoreNextOnData = true;
        domEvent.preventDefault();
        return;
      }

      if (domEvent.key === 'End' || (domEvent.metaKey && domEvent.key === 'ArrowRight')) {
        if (cursorPos < currentLine.length) {
          term.write(currentLine.slice(cursorPos));
          cursorPos = currentLine.length;
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
            isSelecting = true;
          }
          if (cursorPos > 0) {
            cursorPos--;
            term.write('\b');
          }
          domEvent.preventDefault();
        } else if (key === '\u001b[C') {
          if (!isSelecting) {
            isSelecting = true;
          }
          if (cursorPos < currentLine.length) {
            term.write(currentLine[cursorPos]);
            cursorPos++;
          }
          domEvent.preventDefault();
        }
      }
    });

    // 通常のキー入力
    let vimModeActive = false; // Flag to disable normal input during vim mode

    // インタラクティブ入力モード（readline等で使用）
    // interactiveModeはterminalProcessBridge.isActive()で判定
    let interactiveLine = '';
    let interactivePos = 0;

    // When process exits, reset interactive line state
    terminalProcessBridge.setDeactivateCallback(() => {
      interactiveLine = '';
      interactivePos = 0;
    });

    term.onData((data: string) => {
      if (ignoreNextOnData) {
        // clear and ignore a single following onData payload
        ignoreNextOnData = false;
        return;
      }
      if (isComposing || vimModeActive) return; // Skip if vim is active

      // インタラクティブ入力モード（Node.jsプロセスがstdinを読んでいる場合）
      if (terminalProcessBridge.isActive()) {
        switch (data) {
          case '\r': {
            term.write('\r\n');
            const line = interactiveLine;
            interactiveLine = '';
            interactivePos = 0;
            terminalProcessBridge.submitLine(line);
            break;
          }
          case '\x7F': {
            if (interactivePos > 0) {
              interactiveLine =
                interactiveLine.slice(0, interactivePos - 1) +
                interactiveLine.slice(interactivePos);
              interactivePos--;
              term.write('\b');
              term.write(`${interactiveLine.slice(interactivePos)} `);
              for (let i = 0; i < interactiveLine.length - interactivePos + 1; i++)
                term.write('\b');
            }
            break;
          }
          case '\x1b[D': {
            if (interactivePos > 0) {
              term.write('\b');
              interactivePos--;
            }
            break;
          }
          case '\x1b[C': {
            if (interactivePos < interactiveLine.length) {
              term.write(interactiveLine[interactivePos]);
              interactivePos++;
            }
            break;
          }
          default: {
            if (data >= ' ' || data === '\t') {
              interactiveLine =
                interactiveLine.slice(0, interactivePos) +
                data +
                interactiveLine.slice(interactivePos);
              term.write(interactiveLine.slice(interactivePos));
              interactivePos++;
              for (let i = 0; i < interactiveLine.length - interactivePos; i++) term.write('\b');
            }
            break;
          }
        }
        return;
      }

      switch (data) {
        case '\r':
          scrollToBottom();
          if (currentLine.trim()) {
            // Command entered - add newline and execute
            outputManagerRef.current?.writeln('');
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
            // Empty command - just show prompt
            // ensureNewline() in showPrompt() will handle the newline if needed
            showPrompt();
          }
          currentLine = '';
          cursorPos = 0;
          isSelecting = false;
          break;
        case '\u007F':
          if (cursorPos > 0) {
            currentLine = currentLine.slice(0, cursorPos - 1) + currentLine.slice(cursorPos);
            cursorPos--;
            term.write('\b');
            term.write(`${currentLine.slice(cursorPos)} `);
            for (let i = 0; i < currentLine.length - cursorPos + 1; i++) term.write('\b');
          }
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
            } else {
              historyIndex = -1;
              for (let i = 0; i < cursorPos; i++) term.write('\b');
              for (let i = 0; i < currentLine.length; i++) term.write(' ');
              for (let i = 0; i < currentLine.length; i++) term.write('\b');
              currentLine = '';
              cursorPos = 0;
              isSelecting = false;
            }
          }
          break;
        case '\u001b[D':
          if (cursorPos > 0) {
            term.write('\b');
            cursorPos--;
          }
          break;
        case '\u001b[C':
          if (cursorPos < currentLine.length) {
            term.write(currentLine[cursorPos]);
            cursorPos++;
          }
          break;
        default:
          if (data >= ' ' || data === '\t') {
            currentLine = currentLine.slice(0, cursorPos) + data + currentLine.slice(cursorPos);
            term.write(currentLine.slice(cursorPos));
            cursorPos++;
            for (let i = 0; i < currentLine.length - cursorPos; i++) term.write('\b');
            isSelecting = false;
          }
          break;
      }
    });

    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    // Initialize terminal messages and prompt asynchronously
    initializeMessages().catch(err => {
      console.error('[Terminal] Failed to initialize messages:', err);
    });

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
      xtermRef.current = null;
      term.dispose();
    };
  }, [currentProject, currentProjectId, colors, onVimModeChange]);

  // Resize handling: run a fit on height/currentProjectId changes and observe DOM resizes
  // This consolidates previous separate effects into a single, debounced handler.
  useEffect(() => {
    if (!isActive || !terminalRef.current || !fitAddonRef.current) return;

    const runFit = () => {
      try {
        fitAddonRef.current?.fit();
        if (currentProjectId && xtermRef.current) {
          terminalCommandRegistry.updateShellSize(
            currentProjectId,
            xtermRef.current.cols,
            xtermRef.current.rows
          );
        }
        xtermRef.current?.scrollToBottom();
      } catch (e) {
        console.warn('[Terminal.tsx] caught non-fatal error', e);
      }
    };

    // 初回 fit は次フレームで実行（レイアウト確定後）
    const rafId = requestAnimationFrame(runFit);

    const resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(runFit);
    });

    resizeObserver.observe(terminalRef.current);

    return () => {
      cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
    };
  }, [currentProjectId, isActive]);

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
        // height is handled by parent container now due to flex/absolute positioning in BottomPanel
        // but we keep minHeight. Explicit height style might fight with direct DOM manipulation
        // if we are not careful, but BottomPanel actually sets height on the container, not here.
        // The container in BottomPanel has the fixed height.
        // This inner div takes full width/height of that container.
        height: '100%',
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
