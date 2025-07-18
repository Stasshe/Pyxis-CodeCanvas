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
  [key: string]: string;
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
