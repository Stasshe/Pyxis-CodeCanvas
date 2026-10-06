import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Terminal as XTerm } from '@xterm/xterm';
import type { ThemeColors } from '@/context/ThemeContext';

export function createTerminalInstance(colors: ThemeColors) {
  const terminal = new XTerm({
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
  });
  const fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);
  terminal.loadAddon(new WebLinksAddon());
  return { terminal, fitAddon };
}
