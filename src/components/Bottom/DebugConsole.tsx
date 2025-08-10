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

  useEffect(() => {
    if (!xtermRef.current) return;
    if (!termRef.current) {
      // クライアントサイドのみrequire
      const { Terminal: XTerm } = require('@xterm/xterm');
      termRef.current = new XTerm({
        theme: {
          background: colors.cardBg,
          foreground: colors.fg,
        },
        fontSize: 13,
        fontFamily: 'monospace',
        cursorBlink: true,
        disableStdin: false,
        scrollback: 1000,
      });
      termRef.current.open(xtermRef.current);
      termRef.current.writeln('\x1b[1;36m[Debug Console]\x1b[0m デバッグ出力はこちらに表示されます。');
      // APIからの出力をxtermに流す
      DebugConsoleAPI.onLog((msg: string) => {
        termRef.current?.writeln(msg);
      });
      // xtermへの入力をAPIに流す
      termRef.current.onData((input: string) => {
        DebugConsoleAPI._emitInput(input);
      });
    }
    // アクティブ時にリサイズ
    if (isActive) {
      setTimeout(() => termRef.current?.resize(80, 24), 0);
    }
  }, [colors, isActive]);

  // DebugConsoleAPIのlog()で出力できるようにする
  useEffect(() => {
    const unsub = DebugConsoleAPI.onLog((msg: string) => {
      termRef.current?.writeln(msg);
    });
    return () => {
      unsub();
    };
  }, []);

  return (
    <div
      ref={xtermRef}
      style={{
        height: '100%',
        width: '100%',
        background: colors.cardBg,
        color: colors.fg,
        fontSize: 13,
        overflow: 'hidden',
      }}
    />
  );
}
