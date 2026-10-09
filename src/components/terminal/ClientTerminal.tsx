import type { FitAddon } from '@xterm/addon-fit';
import type { Terminal as XTerm } from '@xterm/xterm';
import { Buffer } from 'buffer';
import { useEffect, useRef, useState } from 'react';

import { useTranslation } from '@/context/I18nContext';
import { useTheme } from '@/context/ThemeContext';
import { fsClient } from '@/engine/core/fs/index';
import type { CommandRegistry } from '@/engine/ide/extensions/commandRegistry';
import type { NpmCommands } from '@/engine/system/commands/npm/index';
import type { UnixCommands } from '@/engine/system/commands/unix/index';
import { handleVimCommand } from '@/engine/system/commands/vim/handler';
import type { VimEditor } from '@/engine/system/commands/vim/VimEditor';
import { parseCommandLine } from '@/engine/system/shell';
import type StreamShell from '@/engine/system/shell/streamShell';
import type { Redirection } from '@/engine/system/shell/types';
import { TerminalOutputManager } from '@/engine/system/terminal/terminalOutputManager';
import { terminalProcessBridge } from '@/engine/system/terminal/terminalProcessBridge';
import { terminalCommandRegistry } from '@/engine/system/terminal/terminalRegistry';
import TerminalUI from '@/engine/system/terminal/terminalUI';
import { pyxisEnv } from '@/env';
import { pushLogMessage } from '@/stores/loggerStore';
import {
  clearCanonicalCommandState,
  resolveCanonicalCommand,
} from '../../engine/system/terminal/canonicalCommandState';
import {
  editLine,
  insertLineText,
  isPrintableLineInput,
  lineAction,
} from '../../engine/system/terminal/lineEditor';
import { createTerminalCompletionSource } from '../../engine/system/terminal/terminalCompletionSource';
import {
  navigateTerminalHistory,
  TerminalHistory,
} from '../../engine/system/terminal/terminalHistory';
import {
  cookedControlDAction,
  createTerminalInputController,
} from '../../engine/system/terminal/terminalInputController';
import { finishTerminalInterrupt } from '../../engine/system/terminal/terminalInterrupt';
import { TerminalLineEditor } from '../../engine/system/terminal/terminalLineEditor';
import { showTerminalPrompt } from '../../engine/system/terminal/terminalPrompt';
import { clearTerminalScreen } from '../../engine/system/terminal/terminalScreenControl';
import {
  createShellOutputCallbacks,
  runTerminalShellCommand,
} from '../../engine/system/terminal/terminalShellLifecycle';
import { createTerminalTouchScrollHandler } from '../../engine/system/terminal/terminalTouchScroll';
import { TerminalTypeahead } from '../../engine/system/terminal/terminalTypeahead';
import {
  createTerminalInstance,
  createTerminalTheme,
} from '../../lib/xterm/createTerminalInstance';
import { createTerminalInputState } from '../../lib/xterm/terminalInput';
import { createTerminalScrollHandler } from '../../lib/xterm/terminalViewport';

export interface TerminalProps {
  height: number;
  currentProject?: string;
  currentRootPath?: string;
  isActive?: boolean;
  onVimModeChange?: (vimEditor: VimEditor | null) => void;
}

export function ClientTerminal({
  height,
  currentProject = 'default',
  currentRootPath = '',
  isActive,
  onVimModeChange,
}: TerminalProps) {
  const { colors } = useTheme();
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const outputManagerRef = useRef<TerminalOutputManager | null>(null);
  const unixCommandsRef = useRef<UnixCommands | null>(null);
  const npmCommandsRef = useRef<NpmCommands | null>(null);
  const shellRef = useRef<StreamShell | null>(null);
  const commandRegistryRef = useRef<
    Pick<CommandRegistry, 'hasCommand' | 'executeCommand' | 'getRegisteredCommands'> | undefined
  >(undefined);
  const vimEditorRef = useRef<VimEditor | null>(null);
  const colorsRef = useRef(colors);
  colorsRef.current = colors;
  const onVimModeChangeRef = useRef(onVimModeChange);
  onVimModeChangeRef.current = onVimModeChange;

  useEffect(() => {
    if (!terminalRef.current) return;
    if (!currentRootPath) return;
    pushLogMessage('Terminal initializing', 'info', 'Terminal');

    let mounted = true;
    const loadRegistry = async () => {
      try {
        await fsClient.init();
        const { terminalCommandRegistry } = await import(
          '@/engine/system/terminal/terminalRegistry'
        );
        if (!mounted) return;
        unixCommandsRef.current = terminalCommandRegistry.getUnixCommands(currentRootPath);
        npmCommandsRef.current = await terminalCommandRegistry.getNpmCommands(currentRootPath);
        if (!mounted) return;
        const { commandRegistry } = await import('@/engine/ide/extensions/commandRegistry');
        commandRegistryRef.current = commandRegistry;
        const shell = await terminalCommandRegistry.getShell(currentRootPath, {
          unix: unixCommandsRef.current,
          commandRegistry,
          fsClient,
        });
        if (!shell) throw new Error('StreamShell could not be initialized.');
        if (!mounted) return;
        shellRef.current = shell;
      } catch (e) {
        if (!mounted) return;
        const message = `Terminal registry initialization failed: ${String(e)}`;
        console.error(`[Terminal] ${message}`);
        pushLogMessage(message, 'error', 'Terminal');
        throw e;
      }
    };

    const registryReadyPromise = loadRegistry().catch(error => error);

    const { terminal: term, fitAddon } = createTerminalInstance(colorsRef.current);

    term.open(terminalRef.current);

    const outputManager = new TerminalOutputManager(term);
    outputManagerRef.current = outputManager;

    const terminalUI = new TerminalUI(outputManager);

    try {
      terminalCommandRegistry.setTerminalUI(currentRootPath, terminalUI);
    } catch (e) {
      console.warn('[Terminal] failed to register TerminalUI with registry', e);
    }

    const touchScroll = createTerminalTouchScrollHandler(amount => term.scrollLines(amount));

    const handleTouchStart = (e: TouchEvent) => {
      touchScroll.start(e.touches[0].clientY);
    };

    const handleTouchMove = (e: TouchEvent) => {
      touchScroll.move(e.touches[0].clientY);
    };

    if (terminalRef.current) {
      terminalRef.current.addEventListener('touchstart', handleTouchStart, { passive: true });
      terminalRef.current.addEventListener('touchmove', handleTouchMove, { passive: true });
    }

    const fitAndSync = () => {
      fitAddon.fit();
      terminalCommandRegistry.updateShellSize(currentRootPath, term.cols, term.rows);
    };
    requestAnimationFrame(() => {
      if (!mounted) return;
      fitAndSync();
      term.scrollToBottom();
    });

    const initializeMessages = async () => {
      const pyxisVersion = pyxisEnv.version || '(dev)';
      await terminalUI.info(`Pyxis Terminal v${pyxisVersion}`);
      await terminalUI.println('Type "help" for available commands.');
      const registryError = await registryReadyPromise;
      if (registryError !== undefined) {
        if (mounted) {
          await outputManager.writeError(
            `Terminal initialization failed: ${String(registryError)}\r\n`
          );
        }
        return;
      }
      if (!mounted) return;
      await showPrompt();
      isProcessingCommand = false;
    };

    const scrollToBottom = createTerminalScrollHandler(term, () => mounted);

    const showPrompt = async () => {
      const unix = unixCommandsRef.current;
      if (!unix) throw new Error('Terminal commands are not initialized.');
      await showTerminalPrompt(outputManager, unix, fsClient, colorsRef.current, scrollToBottom);
    };

    const commandHistory = new TerminalHistory(currentRootPath);
    let isProcessingCommand = true;
    let isShellCommandRunning = false;
    const canonicalCommandState = { queued: false, cancelled: false };
    const inputState = createTerminalInputState();

    const historyReady = commandHistory.load();

    const writeOutput = async (output: string) => {
      await outputManagerRef.current?.write(output);
    };

    const processCommand = async (command: string): Promise<boolean> => {
      let parsed: ReturnType<typeof parseCommandLine>;
      try {
        parsed = parseCommandLine(command);
      } catch (error) {
        await writeOutput(`Syntax error: ${(error as Error).message}\n`);
        return true;
      }
      const candidate = parsed.length === 1 ? parsed[0] : undefined;
      const isSimpleCommand =
        candidate !== undefined &&
        candidate.compound === undefined &&
        candidate.functionDefinition === undefined &&
        candidate.separator === undefined;
      const segment = isSimpleCommand ? candidate : undefined;
      const literalCommand = segment?.tokens[0]?.text ?? '';
      const isTerminalCommand =
        literalCommand === 'clear' || literalCommand === 'history' || literalCommand === 'vim';
      let parts = segment?.tokens.map(token => token.text) ?? [];
      if (isTerminalCommand && segment && shellRef.current) {
        try {
          parts = await shellRef.current.expandWords(segment.raw);
        } catch (error) {
          await outputManager.writeError(`${(error as Error).message}\n`);
          return true;
        }
      }
      const cmd = isTerminalCommand ? (parts[0] ?? literalCommand) : '';
      const args = parts.slice(1);
      const outputRedirect = segment?.redirections?.find(
        (redirection): redirection is Extract<Redirection, { kind: 'output' }> =>
          redirection.kind === 'output' && redirection.fd === 1
      );
      let redirect: string | null = null;
      if (isTerminalCommand && outputRedirect) {
        if (outputRedirect.raw !== undefined && shellRef.current) {
          try {
            const paths = await shellRef.current.expandWords(outputRedirect.raw);
            if (paths.length !== 1) throw new Error('Ambiguous redirect');
            redirect = paths[0];
          } catch (error) {
            await outputManager.writeError(`${(error as Error).message}\n`);
            return true;
          }
        } else {
          redirect = outputRedirect.path;
        }
      }
      const fileName = redirect;
      const append = outputRedirect?.append ?? false;

      let capturedOutput = '';
      const captureWriteOutput = async (output: string, preserve = false) => {
        const isInPlaceUpdate = output.startsWith('\r') || output.startsWith('\x1b[?');

        let normalizedOutput = output;
        if (!preserve && !isInPlaceUpdate && !output.endsWith('\n')) normalizedOutput += '\n';
        capturedOutput += normalizedOutput;

        if (!redirect) {
          await writeOutput(normalizedOutput);
        }
      };

      let skipTerminalRedirect = false;
      try {
        switch (cmd) {
          case 'clear':
            await captureWriteOutput('\x1b[H\x1b[2J', true);
            break;

          case 'history': {
            const sub = args[0];
            if (sub === 'clear' || sub === 'reset' || sub === '--clear') {
              try {
                await commandHistory.clear();
                await captureWriteOutput('ターミナル履歴を削除しました');
              } catch (e) {
                await captureWriteOutput(`履歴削除エラー: ${(e as Error).message}`);
              }
            } else {
              if (commandHistory.entries.length === 0) {
                await captureWriteOutput('履歴はありません');
              } else {
                for (let i = 0; i < commandHistory.entries.length; i++) {
                  await captureWriteOutput(`${i + 1}: ${commandHistory.entries[i]}`);
                }
              }
            }
            break;
          }

          case 'vim': {
            vimModeActive = true;

            const vimEditor =
              (await handleVimCommand(
                args,
                unixCommandsRef,
                captureWriteOutput,
                currentRootPath,
                term,
                () => {
                  vimModeActive = false;
                  vimEditorRef.current = null;
                  onVimModeChangeRef.current?.(null);
                  void showPrompt().finally(() => {
                    isProcessingCommand = false;
                    typeahead.drain(handleTerminalData);
                  });
                }
              )) ?? null;

            if (!vimEditor) vimModeActive = false;
            vimEditorRef.current = vimEditor;
            onVimModeChangeRef.current?.(vimEditor);

            break;
          }

          default: {
            if (shellRef.current) {
              const { callbacks, pendingWrites } = createShellOutputCallbacks(
                Boolean(redirect),
                writeOutput,
                data => outputManagerRef.current?.write(data)
              );

              isShellCommandRunning = true;
              try {
                const shell = shellRef.current;
                shellRef.current = await runTerminalShellCommand(
                  currentRootPath,
                  shell,
                  command,
                  callbacks,
                  unixCommandsRef.current,
                  commandRegistryRef.current
                );
              } finally {
                isShellCommandRunning = false;
              }

              await Promise.all(pendingWrites);

              if (redirect && fileName && unixCommandsRef.current) {
                skipTerminalRedirect = true;
              }
            } else {
              await captureWriteOutput(`${cmd}: shell not initialized`);
            }
            break;
          }
        }

        if (!skipTerminalRedirect && redirect && fileName && unixCommandsRef.current) {
          const outputContent = capturedOutput || '';

          const fullPath = fileName.startsWith('/')
            ? fileName
            : `${await unixCommandsRef.current.pwd()}/${fileName}`;
          const normalizedPath = unixCommandsRef.current.normalizePath(fullPath);
          try {
            let content = Buffer.from(outputContent);
            if (append && (await fsClient.exists(normalizedPath))) {
              content = Buffer.concat([await fsClient.readFile(normalizedPath), content]);
            }

            await fsClient.writeFile(normalizedPath, content);
          } catch (e) {
            await writeOutput(`ファイル書き込みエラー: ${(e as Error).message}`);
          }
          return true;
        }
      } catch (error) {
        await outputManager.writeError(`${(error as Error).message}\n`);
      }

      scrollToBottom();
      setTimeout(() => scrollToBottom(), 50);
      setTimeout(() => scrollToBottom(), 150);
      return !vimModeActive;
    };

    let vimModeActive = false;
    let interactiveSubmitting = false;
    let canonicalSubmitting = false;
    let interruptPending = false;
    let completionListing = false;
    let inputOutputPending = false;
    const typeahead = new TerminalTypeahead(
      () =>
        interruptPending ||
        inputOutputPending ||
        vimModeActive ||
        completionListing ||
        interactiveSubmitting ||
        canonicalSubmitting,
      () => terminalProcessBridge.isActive(),
      () => isProcessingCommand
    );
    const lineEditor = new TerminalLineEditor(
      term,
      outputManager,
      inputState,
      interactive => {
        if (vimModeActive) return false;
        if (interactive) {
          return terminalProcessBridge.isActive() && !terminalProcessBridge.stdin.isRaw;
        }
        return !terminalProcessBridge.isActive() && (!isProcessingCommand || canonicalSubmitting);
      },
      () => terminalProcessBridge.sessionVersion
    );
    const canReportInputError = () =>
      !interruptPending &&
      !interactiveSubmitting &&
      !completionListing &&
      !(isProcessingCommand && !terminalProcessBridge.isActive());
    let drainTypeahead = () => {};
    const setInputOutputPending = (pending: boolean) => {
      inputOutputPending = pending;
      if (!pending) drainTypeahead();
    };

    const inputController = createTerminalInputController({
      term,
      inputState,
      outputManager,
      renderQueue: lineEditor.renderQueue,
      getAnchor: interactive => lineEditor.getAnchor(interactive),
      setAnchor: (interactive, anchor) => lineEditor.setAnchor(interactive, anchor),
      getLineState: interactive => lineEditor.getState(interactive),
      setLineState: (interactive, state) => lineEditor.setState(interactive, state),
      renderEditedLine: lineEditor.render.bind(lineEditor),
      getGeneration: () => lineEditor.currentGeneration,
      advanceGeneration: () => lineEditor.bumpGeneration(),
      getSessionKey: () => terminalProcessBridge.sessionVersion,
      isSessionActive: () => terminalProcessBridge.isActive(),
      isRaw: () => terminalProcessBridge.stdin.isRaw,
      isVimModeActive: () => vimModeActive,
      isInputLocked: () => inputOutputPending || !canReportInputError(),
      canReportInputError,
      setInputOutputPending,
      setCompletionListing: listing => {
        completionListing = listing;
        if (!listing) drainTypeahead();
      },
      getCompletionSource: () =>
        createTerminalCompletionSource(unixCommandsRef.current, shellRef.current),
      writeOutput,
      showPrompt,
      onError: message => pushLogMessage(message, 'error', 'Terminal'),
    });
    const { completeLine, reportInputError } = inputController;

    const inputResizeSubscription = lineEditor.registerLifecycle(term);

    const handleTerminalData = (data: string) => {
      if (inputState.isComposing || vimModeActive) return;
      if (interruptPending) return;
      if (inputOutputPending) return;
      if (completionListing && data !== '\x03') return;

      if (terminalProcessBridge.isActive()) {
        if (terminalProcessBridge.stdin.isRaw) {
          lineEditor.bumpGeneration();
          terminalProcessBridge.submitData(data);
          return;
        }
      }

      if (data === '\x03') {
        lineEditor.bumpGeneration();
        const shellWasRunning = isShellCommandRunning;
        const commandWasProcessing = isProcessingCommand;
        const activeShell = shellRef.current;
        const activeStdin = terminalProcessBridge.isActive() ? terminalProcessBridge.stdin : null;
        const activeSession = terminalProcessBridge.sessionVersion;
        typeahead.begin();
        interruptPending = true;
        void finishTerminalInterrupt(lineEditor, outputManager, inputState, {
          shellWasRunning,
          isShellCommandRunning: () => isShellCommandRunning,
          shell: activeShell,
          stdin: activeStdin,
          sessionKey: activeSession,
          getSessionKey: () => terminalProcessBridge.sessionVersion,
          commandWasProcessing,
          isCommandQueued: () => canonicalCommandState.queued,
          cancelQueuedCommand: () => {
            canonicalCommandState.cancelled = true;
          },
          isProcessingCommand: () => isProcessingCommand,
          showPrompt,
        }).finally(() => {
          interruptPending = false;
          typeahead.drain(handleTerminalData);
        });
        return;
      }

      if (terminalProcessBridge.isActive()) {
        if (interactiveSubmitting) return;
        const line = inputState.interactiveLine;
        const cursor = inputState.interactivePos;
        if (data === '\r') {
          const submitGeneration = lineEditor.bumpGeneration();
          interactiveSubmitting = true;
          lineEditor.render(true);
          void lineEditor.renderQueue
            .flush()
            .then(
              () =>
                new Promise<void>(resolve => {
                  term.write('\r\n', resolve);
                })
            )
            .then(() => {
              if (
                submitGeneration !== lineEditor.currentGeneration ||
                !terminalProcessBridge.isActive() ||
                terminalProcessBridge.stdin.isRaw
              ) {
                return;
              }
              lineEditor.clearAnchor(true);
              inputState.interactiveLine = '';
              inputState.interactivePos = 0;
              terminalProcessBridge.submitLine(line);
            })
            .finally(() => {
              interactiveSubmitting = false;
              typeahead.drain(handleTerminalData);
            });
          return;
        }
        if (data === '\x04') {
          const controlDAction = cookedControlDAction(line, cursor);
          if (controlDAction === 'eof') {
            lineEditor.bumpGeneration();
            terminalProcessBridge.stdin.eof();
            return;
          }
          if (controlDAction === 'flush') {
            const submitGeneration = lineEditor.bumpGeneration();
            interactiveSubmitting = true;
            lineEditor.render(true);
            void lineEditor.renderQueue
              .flush()
              .then(() => {
                if (
                  submitGeneration !== lineEditor.currentGeneration ||
                  !terminalProcessBridge.isActive() ||
                  terminalProcessBridge.stdin.isRaw
                ) {
                  return;
                }
                lineEditor.clearAnchor(true);
                inputState.interactiveLine = '';
                inputState.interactivePos = 0;
                terminalProcessBridge.submitData(line);
              })
              .finally(() => {
                interactiveSubmitting = false;
                typeahead.drain(handleTerminalData);
              });
            return;
          }
          const next = editLine({ text: line, cursor }, 'delete');
          lineEditor.setState(true, next);
          return;
        }
        if (data === '\x09') {
          void completeLine(true).catch(error => reportInputError(String(error)));
          return;
        }
        const action = lineAction(data);
        if (action) {
          const next = editLine({ text: line, cursor }, action);
          lineEditor.setState(true, next);
          return;
        }
        if (isPrintableLineInput(data)) {
          const next = insertLineText({ text: line, cursor }, data);
          lineEditor.setState(true, next);
        }
        return;
      }

      if (isProcessingCommand) return;

      if (data === '\r') {
        lineEditor.bumpGeneration();
        canonicalSubmitting = true;
        canonicalCommandState.queued = Boolean(inputState.currentLine.trim());
        lineEditor.render(false);
        scrollToBottom();
        isProcessingCommand = true;
        void lineEditor.renderQueue
          .flush()
          .then(async () => {
            canonicalSubmitting = false;
            lineEditor.clearAnchor(false);
            if (inputState.currentLine.trim()) {
              const command = inputState.currentLine;
              isProcessingCommand = true;
              inputState.currentLine = '';
              inputState.cursorPos = 0;
              await outputManager.writeln('');
              await historyReady;
              await commandHistory.add(command);
              const commandAction = resolveCanonicalCommand(canonicalCommandState, command);
              if (commandAction === 'cancel') {
                await showPrompt();
              } else {
                const shouldShowPrompt = await processCommand(command);
                if (shouldShowPrompt) await showPrompt();
              }
            } else {
              resolveCanonicalCommand(canonicalCommandState, inputState.currentLine);
              inputState.currentLine = '';
              inputState.cursorPos = 0;
              isProcessingCommand = true;
              await showPrompt();
            }
            isShellCommandRunning = false;
            if (!vimModeActive) isProcessingCommand = false;
            typeahead.drain(handleTerminalData);
          })
          .catch(error => {
            canonicalSubmitting = false;
            clearCanonicalCommandState(canonicalCommandState);
            void outputManager.writeError(`${(error as Error).message}\r\n`);
            isShellCommandRunning = false;
            isProcessingCommand = false;
            typeahead.drain(handleTerminalData);
          });
        return;
      }
      if (data === '\x09') {
        void completeLine(false).catch(error => reportInputError(String(error)));
        return;
      }
      if (data === '\x0c') {
        const sessionKey = terminalProcessBridge.sessionVersion;
        lineEditor.bumpGeneration();
        inputOutputPending = true;
        void clearTerminalScreen(
          outputManager,
          lineEditor,
          showPrompt,
          () => terminalProcessBridge.sessionVersion,
          sessionKey
        )
          .catch(error => pushLogMessage(String(error), 'error', 'Terminal'))
          .finally(() => {
            setInputOutputPending(false);
          });
        return;
      }
      if (navigateTerminalHistory(data, commandHistory, inputState, lineEditor)) return;
      const action = lineAction(data);
      if (action) {
        const next = editLine(
          { text: inputState.currentLine, cursor: inputState.cursorPos },
          action
        );
        lineEditor.setState(false, next);
        return;
      }
      if (isPrintableLineInput(data)) {
        const next = insertLineText(
          { text: inputState.currentLine, cursor: inputState.cursorPos },
          data
        );
        lineEditor.setState(false, next);
      }
    };
    drainTypeahead = () => typeahead.drain(handleTerminalData);
    term.onData((data: string) => typeahead.route(data, handleTerminalData));

    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    void initializeMessages().catch(async error => {
      console.error('[Terminal] Failed to initialize messages:', error);
      if (mounted) {
        await outputManager.writeError(`Terminal initialization failed: ${String(error)}\r\n`);
      }
    });

    return () => {
      mounted = false;
      typeahead.dispose();
      clearCanonicalCommandState(canonicalCommandState);
      inputResizeSubscription.dispose();
      vimEditorRef.current?.dispose();
      vimEditorRef.current = null;
      onVimModeChangeRef.current?.(null);
      if (terminalRef.current) {
        terminalRef.current.removeEventListener('touchstart', handleTouchStart);
        terminalRef.current.removeEventListener('touchmove', handleTouchMove);
      }
      xtermRef.current = null;
      term.dispose();
    };
  }, [currentRootPath]);

  useEffect(() => {
    if (xtermRef.current) xtermRef.current.options.theme = createTerminalTheme(colors);
  }, [colors]);

  useEffect(() => {
    if (!isActive || !terminalRef.current || !fitAddonRef.current) return;

    const runFit = () => {
      try {
        fitAddonRef.current?.fit();
        if (currentRootPath && xtermRef.current) {
          terminalCommandRegistry.updateShellSize(
            currentRootPath,
            xtermRef.current.cols,
            xtermRef.current.rows
          );
        }
        xtermRef.current?.scrollToBottom();
      } catch (e) {
        console.warn('[Terminal.tsx] caught non-fatal error', e);
      }
    };

    const rafId = requestAnimationFrame(runFit);

    const resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(runFit);
    });

    resizeObserver.observe(terminalRef.current);

    return () => {
      cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
    };
  }, [currentRootPath, isActive]);

  useEffect(() => {
    if (isActive && xtermRef.current) {
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
        height: '100%',
        minHeight: '100px',
        touchAction: 'none',
        contain: 'layout style paint',
      }}
    />
  );
}
