'use client';

import { useEffect, useRef, useState } from 'react';

interface TerminalProps {
  height: number;
}

export default function Terminal({ height }: TerminalProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<any>(null);
  const fitAddonRef = useRef<any>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  // シンプルなコマンド処理機能
  const processCommand = (command: string, term: any): void => {
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

  useEffect(() => {
    // クライアントサイドでのみ実行
    if (typeof window === 'undefined') return;

    const initializeTerminal = async () => {
      try {
        // Dynamic importでxtermライブラリを読み込み
        const [
          { Terminal: XTerm },
          { FitAddon },
          { WebLinksAddon }
        ] = await Promise.all([
          import('@xterm/xterm'),
          import('@xterm/addon-fit'),
          import('@xterm/addon-web-links')
        ]);

        // xtermのCSSを動的に追加
        const addXtermStyles = () => {
          if (document.getElementById('xterm-styles')) return;
          
          const style = document.createElement('style');
          style.id = 'xterm-styles';
          style.textContent = `
            .xterm {
              position: relative;
              user-select: none;
              -ms-user-select: none;
              -webkit-user-select: none;
            }
            .xterm.focus,
            .xterm:focus {
              outline: none;
            }
            .xterm .xterm-helpers {
              position: absolute;
              top: 0;
              z-index: 5;
            }
            .xterm .xterm-helper-textarea {
              position: absolute;
              opacity: 0;
              left: -9999em;
              top: 0;
              width: 0;
              height: 0;
              z-index: -5;
              white-space: nowrap;
              overflow: hidden;
              resize: none;
            }
            .xterm .composition-view {
              background: #000;
              color: #FFF;
              display: none;
              position: absolute;
              white-space: nowrap;
              z-index: 1;
            }
            .xterm .composition-view.active {
              display: block;
            }
            .xterm .xterm-viewport {
              background-color: #000;
              overflow-y: scroll;
              cursor: default;
              position: absolute;
              right: 0;
              left: 0;
              top: 0;
              bottom: 0;
            }
            .xterm .xterm-screen {
              position: relative;
            }
            .xterm .xterm-screen canvas {
              position: absolute;
              left: 0;
              top: 0;
            }
            .xterm .xterm-scroll-area {
              visibility: hidden;
            }
            .xterm-char-measure-element {
              display: inline-block;
              visibility: hidden;
              position: absolute;
              top: 0;
              left: -9999em;
              line-height: normal;
            }
            .xterm.enable-mouse-events {
              cursor: default;
            }
            .xterm.xterm-cursor-pointer {
              cursor: pointer;
            }
            .xterm.column-select.focus {
              cursor: crosshair;
            }
            .xterm .xterm-accessibility,
            .xterm .xterm-message {
              position: absolute;
              left: 0;
              top: 0;
              bottom: 0;
              right: 0;
              z-index: 10;
              color: transparent;
            }
            .xterm .live-region {
              position: absolute;
              left: -9999px;
              width: 1px;
              height: 1px;
              overflow: hidden;
            }
            .xterm-dim {
              opacity: 0.5;
            }
            .xterm-underline-1 { text-decoration: underline; }
            .xterm-underline-2 { text-decoration: double underline; }
            .xterm-underline-3 { text-decoration: wavy underline; }
            .xterm-underline-4 { text-decoration: dotted underline; }
            .xterm-underline-5 { text-decoration: dashed underline; }
            .xterm-strikethrough {
              text-decoration: line-through;
            }
            .xterm-screen .xterm-decoration-container .xterm-decoration {
              z-index: 6;
              position: absolute;
            }
            .xterm-decoration-overview-ruler {
              z-index: 7;
              position: absolute;
              top: 0;
              right: 0;
              pointer-events: none;
            }
            .xterm-decoration-top {
              z-index: 2;
              position: relative;
            }
          `;
          document.head.appendChild(style);
        };
        
        addXtermStyles();

        if (!terminalRef.current) return;

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
        fitAddon.fit();

        // 初期メッセージ
        term.writeln('Pyxis Terminal v1.0.0');
        term.writeln('Type "help" for available commands.');
        term.write('\r\n$ ');

        // コマンド処理
        let currentLine = '';
        
        term.onData((data: string) => {
          switch (data) {
            case '\r': // Enter
              term.writeln('');
              if (currentLine.trim()) {
                processCommand(currentLine, term);
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
        setIsLoaded(true);

      } catch (error) {
        console.error('Failed to initialize terminal:', error);
      }
    };

    initializeTerminal();

    // クリーンアップ
    return () => {
      if (xtermRef.current) {
        xtermRef.current.dispose();
      }
    };
  }, []);

  // 高さが変更された時にサイズを再調整
  useEffect(() => {
    if (fitAddonRef.current && isLoaded) {
      setTimeout(() => {
        fitAddonRef.current?.fit();
      }, 100);
    }
  }, [height, isLoaded]);

  if (!isLoaded) {
    return (
      <div 
        className="w-full h-full bg-[#1e1e1e] flex items-center justify-center"
        style={{ height: `${height - 32}px` }}
      >
        <div className="text-muted-foreground text-sm">ターミナルを読み込み中...</div>
      </div>
    );
  }

  return (
    <div 
      ref={terminalRef}
      className="w-full h-full bg-[#1e1e1e]"
      style={{ height: `${height - 32}px` }} // ヘッダー分を除く
    />
  );
}
