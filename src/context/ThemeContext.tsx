'use client';

import React, { createContext, useContext, useState, ReactNode, useEffect } from 'react';

export type ThemeColors = {
  background: string;
  foreground: string;
  accent: string;
  primary: string;
  mermaidBg: string;
  editorBg: string;
  editorFg: string;
  editorLineHighlight: string;
  editorSelection: string;
  editorCursor: string;
  cardBg: string;
  border: string;
  mutedBg: string;
  mutedFg: string;
  accentBg: string;
  accentFg: string;
  red: string;
  sidebarTitleFg: string;
  sidebarIconFg: string;
  sidebarResizerBg: string;
  gitBranchColors?: string[];
  gitCommitStroke?: string;
  gitMergeDot?: string;
  gitCommitChevron?: string;
  gitCommitMsg?: string;
  gitCommitMeta?: string;
  gitCommitExpandedBg?: string;
  gitCommitExpandedBorder?: string;
  gitCommitFile?: string;
  gitMergeIcon?: string;
  gitBranchCurrentBg?: string;
  gitBranchCurrentFg?: string;
  gitBranchCurrentBorder?: string;
  gitBranchOtherBg?: string;
  gitBranchOtherFg?: string;
  gitBranchOtherBorder?: string;
  [key: string]: any;
};

const themes: { [key: string]: ThemeColors } = {
  dark: {
    background: '#18181b',
    foreground: '#d4d4d4',
    accent: '#363a4f',
    primary: '#4ea1ff',
    mermaidBg: '#eaffea',
    editorBg: '#1e1e1e',
    editorFg: '#d4d4d4',
    editorLineHighlight: '#2d2d30',
    editorSelection: '#264f78',
    editorCursor: '#aeafad',
    cardBg: '#23232a',
    border: '#2d2d30',
    mutedBg: '#22222a',
    mutedFg: '#a1a1aa',
    accentBg: '#363a4f',
    accentFg: '#4ea1ff',
    red: '#ef4444',
    sidebarTitleFg: '#a1a1aa',
    sidebarIconFg: '#d4d4d4',
    sidebarResizerBg: '#363a4f',
      gitBranchColors: [
        '#3b82f6', // blue
        '#10b981', // emerald
        '#f59e0b', // amber
        '#ef4444', // red
        '#8b5cf6', // violet
        '#06b6d4', // cyan
        '#f97316', // orange
        '#84cc16', // lime
      ],
      gitCommitStroke: '#fff',
      gitMergeDot: '#fff',
      gitCommitChevron: '#a1a1aa',
      gitCommitMsg: '#d4d4d4',
      gitCommitMeta: '#a1a1aa',
      gitCommitExpandedBg: '#23232a',
      gitCommitExpandedBorder: '#363a4f',
      gitCommitFile: '#d4d4d4',
      gitMergeIcon: '#a855f7',
      gitBranchCurrentBg: 'rgba(59,130,246,0.2)',
      gitBranchCurrentFg: '#3b82f6',
      gitBranchCurrentBorder: 'rgba(59,130,246,0.3)',
      gitBranchOtherBg: 'rgba(249,115,22,0.2)',
      gitBranchOtherFg: '#f97316',
      gitBranchOtherBorder: 'rgba(249,115,22,0.3)',
  },
  light: {
    background: '#fff',
    foreground: '#222',
    accent: '#e0e0e0',
    primary: '#0070f3',
    mermaidBg: '#fffbe6',
    editorBg: '#ffffff',
    editorFg: '#222222',
    editorLineHighlight: '#f0f0f0',
    editorSelection: '#cce7ff',
    editorCursor: '#0070f3',
    cardBg: '#f5f5f5',
    border: '#e0e0e0',
    mutedBg: '#f0f0f0',
    mutedFg: '#888888',
    accentBg: '#e0e0e0',
    accentFg: '#0070f3',
    red: '#ef4444',
    sidebarTitleFg: '#888888',
    sidebarIconFg: '#222222',
    sidebarResizerBg: '#e0e0e0',
      gitBranchColors: [
        '#0070f3', // blue
        '#10b981', // emerald
        '#f59e0b', // amber
        '#ef4444', // red
        '#8b5cf6', // violet
        '#06b6d4', // cyan
        '#f97316', // orange
        '#84cc16', // lime
      ],
      gitCommitStroke: '#222',
      gitMergeDot: '#fff',
      gitCommitChevron: '#888888',
      gitCommitMsg: '#222',
      gitCommitMeta: '#888888',
      gitCommitExpandedBg: '#f5f5f5',
      gitCommitExpandedBorder: '#e0e0e0',
      gitCommitFile: '#222',
      gitMergeIcon: '#a855f7',
      gitBranchCurrentBg: 'rgba(0,112,243,0.15)',
      gitBranchCurrentFg: '#0070f3',
      gitBranchCurrentBorder: 'rgba(0,112,243,0.2)',
      gitBranchOtherBg: 'rgba(249,115,22,0.15)',
      gitBranchOtherFg: '#f97316',
      gitBranchOtherBorder: 'rgba(249,115,22,0.2)',
  },
  solarized: {
    background: '#fdf6e3',
    foreground: '#657b83',
    accent: '#eee8d5',
    primary: '#b58900',
    mermaidBg: '#fdf6e3',
    editorBg: '#fdf6e3',
    editorFg: '#657b83',
    editorLineHighlight: '#eee8d5',
    editorSelection: '#b58900',
    editorCursor: '#b58900',
    cardBg: '#eee8d5',
    border: '#b58900',
    mutedBg: '#f5eecb',
    mutedFg: '#657b83',
    accentBg: '#eee8d5',
    accentFg: '#b58900',
    red: '#dc322f',
    sidebarTitleFg: '#657b83',
    sidebarIconFg: '#657b83',
    sidebarResizerBg: '#eee8d5',
      gitBranchColors: [
        '#b58900', // yellow
        '#268bd2', // blue
        '#2aa198', // cyan
        '#dc322f', // red
        '#6c71c4', // violet
        '#859900', // green
        '#cb4b16', // orange
        '#d33682', // magenta
      ],
      gitCommitStroke: '#657b83',
      gitMergeDot: '#eee8d5',
      gitCommitChevron: '#657b83',
      gitCommitMsg: '#657b83',
      gitCommitMeta: '#657b83',
      gitCommitExpandedBg: '#eee8d5',
      gitCommitExpandedBorder: '#b58900',
      gitCommitFile: '#657b83',
      gitMergeIcon: '#6c71c4',
      gitBranchCurrentBg: 'rgba(181,137,0,0.15)',
      gitBranchCurrentFg: '#b58900',
      gitBranchCurrentBorder: 'rgba(181,137,0,0.2)',
      gitBranchOtherBg: 'rgba(220,50,47,0.15)',
      gitBranchOtherFg: '#dc322f',
      gitBranchOtherBorder: 'rgba(220,50,47,0.2)',
  },
};

interface ThemeContextProps {
  colors: ThemeColors;
  setColor: (key: string, value: string) => void;
  setColors: (colors: ThemeColors) => void;
  themeName: string;
  setTheme: (name: string) => void;
  themeList: string[];
}

const ThemeContext = createContext<ThemeContextProps | undefined>(undefined);

export const ThemeProvider = ({ children }: { children: ReactNode }) => {
  // SSR/クライアントで初期値を必ず一致させる
  const [themeName, setThemeName] = useState<string>('dark');
  const [colors, setColorsState] = useState<ThemeColors>(themes['dark']);

  // クライアントマウント後にlocalStorageのテーマを反映
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('themeName');
      if (saved && themes[saved]) {
        setThemeName(saved);
        setColorsState(themes[saved]);
      }
    }
  }, []);

  const setColor = (key: string, value: string) => {
    setColorsState(prev => ({ ...prev, [key]: value }));
  };

  const setColors = (newColors: ThemeColors) => {
    setColorsState(newColors);
  };

  const setTheme = (name: string) => {
    if (themes[name]) {
      setThemeName(name);
      setColorsState(themes[name]);
      if (typeof window !== 'undefined') {
        localStorage.setItem('themeName', name);
      }
    }
  };

  return (
    <ThemeContext.Provider value={{ colors, setColor, setColors, themeName, setTheme, themeList: Object.keys(themes) }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
};
