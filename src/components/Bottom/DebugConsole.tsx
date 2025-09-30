// DebugConsole.tsx
'use client';

import { useEffect, useRef } from 'react';
import { DebugConsoleAPI, TerminalAction } from './DebugConsoleAPI';
import { useTheme } from '@/context/ThemeContext';

interface DebugConsoleProps {
  height: number;
  isActive: boolean;
}

export default function DebugConsole({ height, isActive }: DebugConsoleProps) {
  const { colors } = useTheme();
  const xtermRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<any>(null);
  const fitAddonRef = useRef<any>(null);

  useEffect(() => {
    if (!xtermRef.current) return;
    if (!termRef.current) {
      // クライアントサイドのみrequire
      const { Terminal: XTerm } = require('@xterm/xterm');
      const { FitAddon } = require('@xterm/addon-fit');

      const term = new XTerm({
        theme: {
          background: colors.cardBg,
          foreground: colors.fg,
        },
        fontSize: 13,
        fontFamily: 'Menlo, Monaco, "Courier New", monospace',
        cursorBlink: true,
        disableStdin: false,
        scrollback: 5000,
        allowTransparency: false,
        bellStyle: 'none',
      });

      // FitAddonを追加
      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);

      term.open(xtermRef.current);

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

      // サイズを調整（複数段階で確実に）
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

      term.writeln('\x1b[1;36m[Debug Console]\x1b[0m デバッグ出力はこちらに表示されます。');
      scrollToBottom();

      // 後方互換性のためのログリスナー（従来のlog()メソッド用）
      DebugConsoleAPI.onLog((msg: string) => {
        termRef.current?.writeln(msg);
        scrollToBottom();
      });

      // 新しいアクション型リスナー（高度なターミナル制御用）
      DebugConsoleAPI.onAction((action: TerminalAction) => {
        if (!termRef.current) return;

        switch (action.type) {
          case 'log':
            termRef.current.writeln(action.data);
            scrollToBottom();
            break;

          case 'clear':
            termRef.current.clear();
            break;

          case 'clearLine':
            termRef.current.write('\r\x1b[K'); // カーソルを行頭に移動して行をクリア
            break;

          case 'write':
            termRef.current.write(action.data);
            break;

          case 'writeln':
            termRef.current.writeln(action.data);
            scrollToBottom();
            break;

          case 'moveCursor':
            if (action.data.absolute) {
              // 絶対位置への移動
              termRef.current.write(`\x1b[${action.data.y + 1};${action.data.x + 1}H`);
            } else {
              // 相対移動
              const { deltaX, deltaY } = action.data;
              if (deltaY !== 0) {
                const direction = deltaY > 0 ? 'B' : 'A';
                termRef.current.write(`\x1b[${Math.abs(deltaY)}${direction}`);
              }
              if (deltaX !== 0) {
                const direction = deltaX > 0 ? 'C' : 'D';
                termRef.current.write(`\x1b[${Math.abs(deltaX)}${direction}`);
              }
            }
            break;

          case 'deleteLines':
            // 指定行数を削除
            termRef.current.write(`\x1b[${action.data}M`);
            break;

          case 'insertLines':
            // 指定行数を挿入
            termRef.current.write(`\x1b[${action.data}L`);
            break;

          case 'setTitle':
            // ターミナルタイトルを設定
            termRef.current.write(`\x1b]0;${action.data}\x07`);
            break;

          case 'bell':
            // ベル音（xtermでは画面の点滅など）
            termRef.current.write('\x07');
            break;

          default:
            console.warn('Unknown terminal action:', action.type);
        }
      });

      // $プロンプト表示関数
      const showPrompt = () => {
        term.write('\x1b[1;32m$\x1b[0m ');
      };

      let currentLine = '';
      // 初回プロンプト
      showPrompt();

      term.onData((data: string) => {
        switch (data) {
          case '\r': // Enter
            term.writeln('');
            if (currentLine.trim()) {
              // clearコマンド対応
              if (currentLine.trim() === 'clear') {
                term.clear();
                showPrompt();
                currentLine = '';
                return;
              }
              DebugConsoleAPI._emitInput(currentLine.trim());
            }
            currentLine = '';
            showPrompt();
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

      termRef.current = term;
      fitAddonRef.current = fitAddon;
    }

    // アクティブ時にリサイズとスクロール
    if (isActive && fitAddonRef.current && termRef.current) {
      setTimeout(() => {
        fitAddonRef.current?.fit();
        termRef.current?.scrollToBottom();
      }, 50);
    }
  }, [colors, isActive]);

  // 高さが変更された時にサイズを再調整
  useEffect(() => {
    if (fitAddonRef.current && termRef.current) {
      setTimeout(() => {
        fitAddonRef.current?.fit();

        setTimeout(() => {
          termRef.current?.scrollToBottom();
        }, 100);
      }, 100);
    }
  }, [height]);

  return (
    <div
      ref={xtermRef}
      className="w-full h-full overflow-hidden relative debug-console-container"
      style={{
        height: `${height - 32}px`,
        maxHeight: `${height - 32}px`,
        minHeight: '100px',
        width: '100%',
        background: colors.cardBg,
        color: colors.fg,
        fontSize: 13,
        overflow: 'hidden',
        touchAction: 'none',
        contain: 'layout style paint',
      }}
    />
  );
}
