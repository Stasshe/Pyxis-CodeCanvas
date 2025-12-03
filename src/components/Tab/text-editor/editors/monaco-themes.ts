import type { Monaco } from '@monaco-editor/react';
import type { ThemeColors } from '@/context/ThemeContext';

let themesDefined = false;
let currentThemeName: string | null = null;

const isHexLight = (hex?: string) => {
  if (!hex) return false;
  try {
    const h = hex.replace('#', '').trim();
    if (h.length === 3) {
      const r = parseInt(h[0] + h[0], 16);
      const g = parseInt(h[1] + h[1], 16);
      const b = parseInt(h[2] + h[2], 16);
      const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      return lum > 0.7;
    }
    if (h.length === 6) {
      const r = parseInt(h.substring(0, 2), 16);
      const g = parseInt(h.substring(2, 4), 16);
      const b = parseInt(h.substring(4, 6), 16);
      const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      return lum > 0.7;
    }
  } catch (e) {
    // ignore
  }
  return false;
};

export function defineAndSetMonacoThemes(mon: Monaco, colors: ThemeColors) {
  try {
    if (!themesDefined) {
      // dark
      mon.editor.defineTheme('pyxis-dark', {
        base: 'vs-dark',
        inherit: true,
        rules: [
          { token: 'comment', foreground: '6A9955', fontStyle: 'italic' },
            { token: 'comment.doc', foreground: '6A9955', fontStyle: 'italic' },
            { token: 'keyword', foreground: '569CD6', fontStyle: 'bold' },
            { token: 'string', foreground: 'CE9178' },
            { token: 'string.escape', foreground: 'D7BA7D' },
            { token: 'number', foreground: 'B5CEA8' },
            { token: 'number.hex', foreground: 'B5CEA8' },
            { token: 'number.octal', foreground: 'B5CEA8' },
            { token: 'number.binary', foreground: 'B5CEA8' },
            { token: 'number.float', foreground: 'B5CEA8' },
            { token: 'regexp', foreground: 'D16969' },
            { token: 'regexp.escape', foreground: 'D7BA7D' },
            { token: 'operator', foreground: 'D4D4D4' },
            { token: 'delimiter', foreground: 'D4D4D4' },
            { token: 'delimiter.bracket', foreground: 'FFD700' },
            
            // 型・クラス系
            { token: 'type', foreground: '4EC9B0' },
            { token: 'type.identifier', foreground: '4EC9B0' },
            { token: 'namespace', foreground: '4EC9B0' },
            { token: 'struct', foreground: '4EC9B0' },
            { token: 'class', foreground: '4EC9B0' },
            { token: 'interface', foreground: '4EC9B0' },
            
            // 変数・パラメータ系
            { token: 'parameter', foreground: '9CDCFE' },
            { token: 'variable', foreground: '9CDCFE' },
            { token: 'property', foreground: 'D4D4D4' }, // プロパティは白系に
            { token: 'identifier', foreground: '9CDCFE' },
            
            // 関数・メソッド系
            { token: 'function', foreground: 'DCDCAA' },
            { token: 'function.call', foreground: 'DCDCAA' },
            { token: 'method', foreground: 'DCDCAA' },
            
            // JSX専用トークン（強調表示）
            { token: 'tag', foreground: '4EC9B0', fontStyle: 'bold' },
            { token: 'tag.jsx', foreground: '4EC9B0', fontStyle: 'bold' },
            { token: 'attribute.name', foreground: '9CDCFE', fontStyle: 'italic' },
            { token: 'attribute.name.jsx', foreground: '9CDCFE', fontStyle: 'italic' },
            { token: 'attribute.value', foreground: 'CE9178' },
            { token: 'jsx.text', foreground: 'D4D4D4' }, // JSX本文テキストは白色
            { token: 'delimiter.html', foreground: 'FFD700' },
            { token: 'attribute.name.html', foreground: '9CDCFE' },
            { token: 'tag.tsx', foreground: '4EC9B0', fontStyle: 'bold' },
            { token: 'tag.jsx', foreground: '4EC9B0', fontStyle: 'bold' },
            { token: 'text', foreground: 'D4D4D4' },
        ],
        colors: {
          'editor.background': colors.editorBg || '#1e1e1e',
          'editor.foreground': colors.editorFg || '#d4d4d4',
          'editor.lineHighlightBackground': colors.editorLineHighlight || '#2d2d30',
          'editor.selectionBackground': colors.editorSelection || '#264f78',
          'editor.inactiveSelectionBackground': '#3a3d41',
          'editorCursor.foreground': colors.editorCursor || '#aeafad',
          'editorWhitespace.foreground': '#404040',
          'editorIndentGuide.background': '#404040',
          'editorIndentGuide.activeBackground': '#707070',
          'editorBracketMatch.background': '#0064001a',
          'editorBracketMatch.border': '#888888',
        },
      });

      // light
      mon.editor.defineTheme('pyxis-light', {
        base: 'vs',
        inherit: true,
        rules: [
          { token: 'comment', foreground: '6B737A', fontStyle: 'italic' },
          { token: 'keyword', foreground: '0b63c6', fontStyle: 'bold' },
          { token: 'string', foreground: 'a31515' },
          { token: 'number', foreground: '005cc5' },
          { token: 'regexp', foreground: 'b31b1b' },
          { token: 'operator', foreground: '333333' },
          { token: 'delimiter', foreground: '333333' },
          { token: 'type', foreground: '0b7a65' },
          { token: 'parameter', foreground: '1750a0' },
          { token: 'function', foreground: '795e26' },
          { token: 'tag', foreground: '0b7a65', fontStyle: 'bold' },
          { token: 'attribute.name', foreground: '1750a0', fontStyle: 'italic' },
          { token: 'attribute.value', foreground: 'a31515' },
          { token: 'jsx.text', foreground: '2d2d2d' },
        ],
        colors: {
          'editor.background': colors.editorBg || '#ffffff',
          'editor.foreground': colors.editorFg || '#222222',
          'editor.lineHighlightBackground': colors.editorLineHighlight || '#f0f0f0',
          'editor.selectionBackground': colors.editorSelection || '#cce7ff',
          'editor.inactiveSelectionBackground': '#f3f3f3',
          'editorCursor.foreground': colors.editorCursor || '#0070f3',
          'editorWhitespace.foreground': '#d0d0d0',
          'editorIndentGuide.background': '#e0e0e0',
          'editorIndentGuide.activeBackground': '#c0c0c0',
          'editorBracketMatch.background': '#00000005',
          'editorBracketMatch.border': '#88888822',
        },
      });

      themesDefined = true;
    }

    const bg = colors?.editorBg || (colors as any)?.background || '#1e1e1e';
    const useLight = isHexLight(bg) || (typeof (colors as any).background === 'string' && /white|fff/i.test((colors as any).background));
    const targetTheme = useLight ? 'pyxis-light' : 'pyxis-dark';
    
    // テーマが既に同じ場合はsetThemeを呼び出さない（パフォーマンス最適化）
    if (currentThemeName !== targetTheme) {
      mon.editor.setTheme(targetTheme);
      currentThemeName = targetTheme;
    }
  } catch (e) {
    // keep MonacoEditor resilient
    // eslint-disable-next-line no-console
    console.warn('[monaco-themes] Failed to define/set themes:', e);
  }
}
