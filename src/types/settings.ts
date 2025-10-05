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
    followSymlinks: boolean;
  };

  // ファイル設定
  files: {
    exclude: string[]; // glob patterns
    watcherExclude: string[];
    autoSave: 'off' | 'afterDelay' | 'onFocusChange' | 'onWindowChange';
    autoSaveDelay: number;
  };

  // ターミナル設定
  terminal: {
    fontSize: number;
    cursorStyle: 'block' | 'underline' | 'bar';
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
      '**/.cache',
    ],
    useIgnoreFiles: true,
    followSymlinks: false,
  },
  files: {
    exclude: ['**/.git', '**/.DS_Store', '**/Thumbs.db'],
    watcherExclude: [
      '**/.git/objects/**',
      '**/.git/subtree-cache/**',
      '**/node_modules/**',
      '**/.hg/store/**',
    ],
    autoSave: 'off',
    autoSaveDelay: 1000,
  },
  terminal: {
    fontSize: 13,
    cursorStyle: 'block',
  },
};
