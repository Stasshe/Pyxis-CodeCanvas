'use client';

import { useEffect, useRef, useState } from 'react';

interface TerminalProps {
  height: number;
}

// クライアントサイド専用のターミナルコンポーネント
function ClientTerminal({ height }: TerminalProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<any>(null);
  const fitAddonRef = useRef<any>(null);

  useEffect(() => {
    if (!terminalRef.current) return;

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
    term.writeln('Type "help" for available commands.');
    term.write('\r\n$ ');

    // コマンド処理
    let currentLine = '';
    
    const processCommand = (command: string) => {
      const cmd = command.trim().toLowerCase();
      
      switch (cmd) {
        case 'clear':
          term.clear();
          break;
        case 'help':
          term.writeln('\r\n利用可能なコマンド:');
          term.writeln('  clear  - 画面をクリア');
          term.writeln('  help   - このヘルプを表示');
          term.writeln('  echo   - テキストを出力');
          term.writeln('  pwd    - 現在のディレクトリを表示');
          term.writeln('  ls     - ファイル一覧を表示');
          term.writeln('  date   - 現在の日時を表示');
          term.writeln('  whoami - ユーザー名を表示');
          break;
        case 'pwd':
          term.writeln('\r\n/workspaces/current-project');
          break;
        case 'ls':
          term.writeln('\r\nsrc/     package.json     README.md');
          term.writeln('public/  tailwind.config.ts  tsconfig.json');
          break;
        case 'date':
          term.writeln(`\r\n${new Date().toLocaleString('ja-JP')}`);
          break;
        case 'whoami':
          term.writeln('\r\nuser');
          break;
        default:
          if (cmd.startsWith('echo ')) {
            const text = command.slice(5);
            term.writeln(`\r\n${text}`);
          } else if (cmd === '') {
            // 空のコマンドは何もしない
          } else {
            term.writeln(`\r\ncommand not found: ${command}`);
          }
          break;
      }
    };
    
    term.onData((data: string) => {
      switch (data) {
        case '\r': // Enter
          term.writeln('');
          if (currentLine.trim()) {
            processCommand(currentLine);
          }
          currentLine = '';
          term.write('$ ');
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
          term.write('$ ');
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
  }, []);

  // 高さが変更された時にサイズを再調整
  useEffect(() => {
    if (fitAddonRef.current) {
      setTimeout(() => {
        fitAddonRef.current?.fit();
      }, 100);
    }
  }, [height]);

  return (
    <div 
      ref={terminalRef}
      className="w-full h-full bg-[#1e1e1e]"
      style={{ height: `${height - 32}px` }}
    />
  );
}

// SSR対応のターミナルコンポーネント
export default function Terminal({ height }: TerminalProps) {
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
  return <ClientTerminal height={height} />;
}
