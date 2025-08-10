// DebugConsole.tsx
'use client';

import { useEffect, useRef } from 'react';
import { DebugConsoleAPI } from './DebugConsoleAPI';
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
      
      // APIからの出力をxtermに流す（自動スクロール付き）
      DebugConsoleAPI.onLog((msg: string) => {
        termRef.current?.writeln(msg);
        scrollToBottom();
      });
      
      // xtermへの入力をAPIに流す
      term.onData((input: string) => {
        DebugConsoleAPI._emitInput(input);
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

  // DebugConsoleAPIのlog()で出力できるようにする（重複登録を避ける）
  useEffect(() => {
    const unsub = DebugConsoleAPI.onLog((msg: string) => {
      if (termRef.current) {
        termRef.current.writeln(msg);
        // 出力時に自動スクロール
        setTimeout(() => {
          termRef.current?.scrollToBottom();
        }, 10);
      }
    });
    return () => {
      unsub();
    };
  }, []);

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
        contain: 'layout style paint'
      }}
    />
  );
}
