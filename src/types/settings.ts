/**
 * .pyxis/settings.json の型定義
 */

export interface PyxisSettings {
  // エディター設定
  editor: {
    fontSize: number;
    tabSize: number;
    insertSpaces: boolean;
    wordWrap: boolean;
  };

  // テーマ設定
  theme: {
    colorTheme: string;
    highlightTheme: string;
    customColors?: Record<string, string>;
  };

  // 検索設定
  search: {
    exclude: string[]; // glob patterns
    useIgnoreFiles: boolean;
  };

  // ファイル設定
  files: {
    exclude: string[]; // glob patterns
  };

  // Markdown固有の設定
  markdown: {
    // singleLineBreaks: 'default' -> 通常のMarkdown仕様（単一改行は無視される）
    // singleLineBreaks: 'breaks' -> remark-breaks のように単一改行を改行として扱う
    singleLineBreaks: 'default' | 'breaks';
    // math 設定: LaTeX 数式のデリミタ設定
    // 'dollar' -> $...$ (inline) / $$...$$ (display)
    // 'bracket' -> \(...\) (inline) / \[...\] (display)
    // 'both' -> accept both styles
    math: {
      delimiter: 'dollar' | 'bracket' | 'both';
    };
  };
}

/**
 * デフォルト設定
 */
export const DEFAULT_PYXIS_SETTINGS: PyxisSettings = {
  editor: {
    fontSize: 14,
    tabSize: 2,
    insertSpaces: true,
    wordWrap: false,
  },
  theme: {
    colorTheme: 'dark',
    highlightTheme: 'github-dark',
  },
  search: {
    exclude: [
      '**/node_modules',
      '**/bower_components',
      '**/*.code-search',
      '**/dist',
      '**/build',
      '**/.git',
      '**/.pyxis',
      '**/coverage',
      '**/.next',
      '**/.nuxt',
      '**/cache',
    ],
    useIgnoreFiles: true,
  },
  markdown: {
    singleLineBreaks: 'breaks',
    math: {
      delimiter: 'dollar',
    },
  },
  files: {
    exclude: ['**/.git', '**/.DS_Store', '**/Thumbs.db'],
  },
};
