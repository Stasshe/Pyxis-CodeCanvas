'use client';

import React, { createContext, useContext, useState, ReactNode } from 'react';

export type ThemeColors = {
  background: string;
  foreground: string;
  accent: string;
  primary: string;
  mermaidBg: string;
  [key: string]: string;
};

const themes: { [key: string]: ThemeColors } = {
  dark: {
    background: '#18181b',
    foreground: '#d4d4d4',
    accent: '#363a4f',
    primary: '#4ea1ff',
    mermaidBg: '#eaffea',
  },
  light: {
    background: '#fff',
    foreground: '#222',
    accent: '#e0e0e0',
    primary: '#0070f3',
    mermaidBg: '#fffbe6',
  },
  solarized: {
    background: '#fdf6e3',
    foreground: '#657b83',
    accent: '#eee8d5',
    primary: '#b58900',
    mermaidBg: '#fdf6e3',
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
  const [themeName, setThemeName] = useState<string>('dark');
  const [colors, setColorsState] = useState<ThemeColors>(themes[themeName]);

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
