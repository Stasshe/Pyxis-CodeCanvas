import type { Monaco } from '@monaco-editor/react';

import type { ThemeColors } from '@/context/ThemeContext';

// キャッシュキー: colorsのエディタ関連プロパティのハッシュ
let lastColorsCacheKey: string | null = null;

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

// colorsからキャッシュキーを生成（エディタ関連プロパティのみ）
function getColorsCacheKey(colors: ThemeColors): string {
  return [
    colors.editorBg,
    colors.editorFg,
    colors.editorLineHighlight,
    colors.editorSelection,
    colors.editorCursor,
    colors.background,
  ].join('|');
}

export function defineAndSetMonacoThemes(mon: Monaco, colors: ThemeColors) {
  try {
    const currentCacheKey = getColorsCacheKey(colors);
    const needsRedefine = lastColorsCacheKey !== currentCacheKey;
    
    if (needsRedefine) {
      const bg = colors?.editorBg || (colors as any)?.background || '#1e1e1e';
      const useLight = isHexLight(bg) || (typeof (colors as any).background === 'string' && /white|fff/i.test((colors as any).background));
      
      // pyxis-custom テーマを定義（EditorとDiffEditorの両方で使用）
      // 現在のcolorsに基づいて適切なbaseを選択し、colorsを反映
      mon.editor.defineTheme('pyxis-custom', {
        base: useLight ? 'vs' : 'vs-dark',
        inherit: true,
        rules: useLight
          ? [
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
          ]
          : [
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
            { token: 'type', foreground: '4EC9B0' },
            { token: 'type.identifier', foreground: '4EC9B0' },
            { token: 'namespace', foreground: '4EC9B0' },
            { token: 'struct', foreground: '4EC9B0' },
            { token: 'class', foreground: '4EC9B0' },
            { token: 'interface', foreground: '4EC9B0' },
            { token: 'parameter', foreground: '9CDCFE' },
            { token: 'variable', foreground: '9CDCFE' },
            { token: 'property', foreground: 'D4D4D4' },
            { token: 'identifier', foreground: '9CDCFE' },
            { token: 'function', foreground: 'DCDCAA' },
            { token: 'function.call', foreground: 'DCDCAA' },
            { token: 'method', foreground: 'DCDCAA' },
            { token: 'tag', foreground: '4EC9B0', fontStyle: 'bold' },
            { token: 'tag.jsx', foreground: '4EC9B0', fontStyle: 'bold' },
            { token: 'attribute.name', foreground: '9CDCFE', fontStyle: 'italic' },
            { token: 'attribute.name.jsx', foreground: '9CDCFE', fontStyle: 'italic' },
            { token: 'attribute.value', foreground: 'CE9178' },
            { token: 'jsx.text', foreground: 'D4D4D4' },
            { token: 'delimiter.html', foreground: 'FFD700' },
            { token: 'attribute.name.html', foreground: '9CDCFE' },
            { token: 'tag.tsx', foreground: '4EC9B0', fontStyle: 'bold' },
            { token: 'text', foreground: 'D4D4D4' },
          ],
        colors: useLight
          ? {
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
          }
          : {
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

      lastColorsCacheKey = currentCacheKey;
    }
    
    // テーマを適用（pyxis-custom は常に同じ名前なので、定義が更新されれば自動的に反映される）
    mon.editor.setTheme('pyxis-custom');
  } catch (e) {
    // keep MonacoEditor resilient
     
    console.warn('[monaco-themes] Failed to define/set themes:', e);
  }
}
