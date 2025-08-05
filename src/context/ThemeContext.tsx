"use client";

import React, {
  createContext,
  useContext,
  useState,
  ReactNode,
  useEffect,
} from "react";

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
    background: "#18181b",
    foreground: "#d4d4d4",
    accent: "#363a4f",
    primary: "#4ea1ff",
    mermaidBg: "#f3f6fa",
    editorBg: "#1e1e1e",
    editorFg: "#d4d4d4",
    editorLineHighlight: "#2d2d30",
    editorSelection: "#264f78",
    editorCursor: "#aeafad",
    cardBg: "#23232a",
    border: "#2d2d30",
    mutedBg: "#22222a",
    mutedFg: "#a1a1aa",
    accentBg: "#363a4f",
    accentFg: "#4ea1ff",
    red: "#ef4444",
    sidebarTitleFg: "#a1a1aa",
    sidebarIconFg: "#d4d4d4",
    sidebarResizerBg: "#363a4f",
    gitBranchColors: [
      "#3b82f6", // blue
      "#10b981", // emerald
      "#f59e0b", // amber
      "#ef4444", // red
      "#8b5cf6", // violet
      "#06b6d4", // cyan
      "#f97316", // orange
      "#84cc16", // lime
    ],
    gitCommitStroke: "#fff",
    gitMergeDot: "#fff",
    gitCommitChevron: "#a1a1aa",
    gitCommitMsg: "#d4d4d4",
    gitCommitMeta: "#a1a1aa",
    gitCommitExpandedBg: "#23232a",
    gitCommitExpandedBorder: "#363a4f",
    gitCommitFile: "#d4d4d4",
    gitMergeIcon: "#a855f7",
    gitBranchCurrentBg: "rgba(59,130,246,0.2)",
    gitBranchCurrentFg: "#3b82f6",
    gitBranchCurrentBorder: "rgba(59,130,246,0.3)",
    gitBranchOtherBg: "rgba(249,115,22,0.2)",
    gitBranchOtherFg: "#f97316",
    gitBranchOtherBorder: "rgba(249,115,22,0.3)",
  },
  solarizedDark: {
    background: "#002b36",
    foreground: "#839496",
    accent: "#073642",
    primary: "#b58900",
    mermaidBg: "#f3f6fa",
    editorBg: "#002b36",
    editorFg: "#839496",
    editorLineHighlight: "#073642",
    editorSelection: "#586e75",
    editorCursor: "#b58900",
    cardBg: "#073642",
    border: "#586e75",
    mutedBg: "#073642",
    mutedFg: "#586e75",
    accentBg: "#073642",
    accentFg: "#b58900",
    red: "#dc322f",
    sidebarTitleFg: "#839496",
    sidebarIconFg: "#839496",
    sidebarResizerBg: "#073642",
    gitBranchColors: [
      "#b58900",
      "#268bd2",
      "#2aa198",
      "#dc322f",
      "#6c71c4",
      "#859900",
      "#cb4b16",
      "#d33682",
    ],
    gitCommitStroke: "#839496",
    gitMergeDot: "#073642",
    gitCommitChevron: "#839496",
    gitCommitMsg: "#839496",
    gitCommitMeta: "#839496",
    gitCommitExpandedBg: "#073642",
    gitCommitExpandedBorder: "#586e75",
    gitCommitFile: "#839496",
    gitMergeIcon: "#6c71c4",
    gitBranchCurrentBg: "rgba(181,137,0,0.15)",
    gitBranchCurrentFg: "#b58900",
    gitBranchCurrentBorder: "rgba(181,137,0,0.2)",
    gitBranchOtherBg: "rgba(220,50,47,0.15)",
    gitBranchOtherFg: "#dc322f",
    gitBranchOtherBorder: "rgba(220,50,47,0.2)",
  },
  nord: {
    background: "#2e3440",
    foreground: "#d8dee9",
    accent: "#4c566a",
    primary: "#81a1c1",
    mermaidBg: "#f3f6fa",
    editorBg: "#2e3440",
    editorFg: "#d8dee9",
    editorLineHighlight: "#3b4252",
    editorSelection: "#434c5e",
    editorCursor: "#81a1c1",
    cardBg: "#3b4252",
    border: "#4c566a",
    mutedBg: "#434c5e",
    mutedFg: "#88c0d0",
    accentBg: "#4c566a",
    accentFg: "#81a1c1",
    red: "#bf616a",
    sidebarTitleFg: "#88c0d0",
    sidebarIconFg: "#d8dee9",
    sidebarResizerBg: "#4c566a",
    gitBranchColors: [
      "#81a1c1",
      "#8fbcbb",
      "#ebcb8b",
      "#bf616a",
      "#b48ead",
      "#5e81ac",
      "#d08770",
      "#a3be8c",
    ],
    gitCommitStroke: "#d8dee9",
    gitMergeDot: "#4c566a",
    gitCommitChevron: "#88c0d0",
    gitCommitMsg: "#d8dee9",
    gitCommitMeta: "#88c0d0",
    gitCommitExpandedBg: "#3b4252",
    gitCommitExpandedBorder: "#4c566a",
    gitCommitFile: "#d8dee9",
    gitMergeIcon: "#b48ead",
    gitBranchCurrentBg: "rgba(129,161,193,0.15)",
    gitBranchCurrentFg: "#81a1c1",
    gitBranchCurrentBorder: "rgba(129,161,193,0.2)",
    gitBranchOtherBg: "rgba(191,97,106,0.15)",
    gitBranchOtherFg: "#bf616a",
    gitBranchOtherBorder: "rgba(191,97,106,0.2)",
  },
  dracula: {
    background: "#282a36",
    foreground: "#f8f8f2",
    accent: "#44475a",
    primary: "#bd93f9",
    mermaidBg: "#f3f6fa",
    editorBg: "#282a36",
    editorFg: "#f8f8f2",
    editorLineHighlight: "#44475a",
    editorSelection: "#6272a4",
    editorCursor: "#ff79c6",
    cardBg: "#44475a",
    border: "#6272a4",
    mutedBg: "#44475a",
    mutedFg: "#6272a4",
    accentBg: "#44475a",
    accentFg: "#bd93f9",
    red: "#ff5555",
    sidebarTitleFg: "#8be9fd",
    sidebarIconFg: "#f8f8f2",
    sidebarResizerBg: "#44475a",
    gitBranchColors: [
      "#bd93f9",
      "#8be9fd",
      "#f1fa8c",
      "#ff5555",
      "#ff79c6",
      "#50fa7b",
      "#ffb86c",
      "#6272a4",
    ],
    gitCommitStroke: "#f8f8f2",
    gitMergeDot: "#44475a",
    gitCommitChevron: "#8be9fd",
    gitCommitMsg: "#f8f8f2",
    gitCommitMeta: "#8be9fd",
    gitCommitExpandedBg: "#44475a",
    gitCommitExpandedBorder: "#6272a4",
    gitCommitFile: "#f8f8f2",
    gitMergeIcon: "#ff79c6",
    gitBranchCurrentBg: "rgba(189,147,249,0.15)",
    gitBranchCurrentFg: "#bd93f9",
    gitBranchCurrentBorder: "rgba(189,147,249,0.2)",
    gitBranchOtherBg: "rgba(255,85,85,0.15)",
    gitBranchOtherFg: "#ff5555",
    gitBranchOtherBorder: "rgba(255,85,85,0.2)",
  },
  monokai: {
    background: "#272822",
    foreground: "#f8f8f2",
    accent: "#75715e",
    primary: "#a6e22e",
    mermaidBg: "#f3f6fa",
    editorBg: "#272822",
    editorFg: "#f8f8f2",
    editorLineHighlight: "#49483e",
    editorSelection: "#49483e",
    editorCursor: "#f8f8f0",
    cardBg: "#49483e",
    border: "#75715e",
    mutedBg: "#49483e",
    mutedFg: "#75715e",
    accentBg: "#75715e",
    accentFg: "#a6e22e",
    red: "#f92672",
    sidebarTitleFg: "#fd971f",
    sidebarIconFg: "#f8f8f2",
    sidebarResizerBg: "#75715e",
    gitBranchColors: [
      "#a6e22e",
      "#fd971f",
      "#f92672",
      "#66d9ef",
      "#ae81ff",
      "#f8f8f2",
      "#75715e",
      "#49483e",
    ],
    gitCommitStroke: "#f8f8f2",
    gitMergeDot: "#75715e",
    gitCommitChevron: "#fd971f",
    gitCommitMsg: "#f8f8f2",
    gitCommitMeta: "#fd971f",
    gitCommitExpandedBg: "#49483e",
    gitCommitExpandedBorder: "#75715e",
    gitCommitFile: "#f8f8f2",
    gitMergeIcon: "#ae81ff",
    gitBranchCurrentBg: "rgba(166,226,46,0.15)",
    gitBranchCurrentFg: "#a6e22e",
    gitBranchCurrentBorder: "rgba(166,226,46,0.2)",
    gitBranchOtherBg: "rgba(249,38,114,0.15)",
    gitBranchOtherFg: "#f92672",
    gitBranchOtherBorder: "rgba(249,38,114,0.2)",
  },
  shikkoku: {
    background: "#0a0a0a",
    foreground: "#e5e5e5",
    accent: "#1a1a1a",
    primary: "#7f7fff",
    mermaidBg: "#f3f6fa",
    editorBg: "#0a0a0a",
    editorFg: "#e5e5e5",
    editorLineHighlight: "#222",
    editorSelection: "#333",
    editorCursor: "#7f7fff",
    cardBg: "#181818",
    border: "#222",
    mutedBg: "#181818",
    mutedFg: "#888",
    accentBg: "#1a1a1a",
    accentFg: "#7f7fff",
    red: "#ff4b4b",
    sidebarTitleFg: "#888",
    sidebarIconFg: "#e5e5e5",
    sidebarResizerBg: "#1a1a1a",
    gitBranchColors: [
      "#7f7fff", // blue
      "#4bff4b", // green
      "#ffd700", // gold
      "#ff4b4b", // red
      "#b47fff", // violet
      "#4bffff", // cyan
      "#ffb84b", // orange
      "#84ff16", // lime
    ],
    gitCommitStroke: "#e5e5e5",
    gitMergeDot: "#222",
    gitCommitChevron: "#888",
    gitCommitMsg: "#e5e5e5",
    gitCommitMeta: "#888",
    gitCommitExpandedBg: "#181818",
    gitCommitExpandedBorder: "#222",
    gitCommitFile: "#e5e5e5",
    gitMergeIcon: "#b47fff",
    gitBranchCurrentBg: "rgba(127,127,255,0.15)",
    gitBranchCurrentFg: "#7f7fff",
    gitBranchCurrentBorder: "rgba(127,127,255,0.2)",
    gitBranchOtherBg: "rgba(255,75,75,0.15)",
    gitBranchOtherFg: "#ff4b4b",
    gitBranchOtherBorder: "rgba(255,75,75,0.2)",
  },
  light: {
    background: "#fff",
    foreground: "#222",
    accent: "#e0e0e0",
    primary: "#0070f3",
    mermaidBg: "#f3f6fa",
    editorBg: "#ffffff",
    editorFg: "#222222",
    editorLineHighlight: "#f0f0f0",
    editorSelection: "#cce7ff",
    editorCursor: "#0070f3",
    cardBg: "#f5f5f5",
    border: "#e0e0e0",
    mutedBg: "#f0f0f0",
    mutedFg: "#888888",
    accentBg: "#e0e0e0",
    accentFg: "#0070f3",
    red: "#ef4444",
    sidebarTitleFg: "#888888",
    sidebarIconFg: "#222222",
    sidebarResizerBg: "#e0e0e0",
    gitBranchColors: [
      "#0070f3", // blue
      "#10b981", // emerald
      "#f59e0b", // amber
      "#ef4444", // red
      "#8b5cf6", // violet
      "#06b6d4", // cyan
      "#f97316", // orange
      "#84cc16", // lime
    ],
    gitCommitStroke: "#222",
    gitMergeDot: "#fff",
    gitCommitChevron: "#888888",
    gitCommitMsg: "#222",
    gitCommitMeta: "#888888",
    gitCommitExpandedBg: "#f5f5f5",
    gitCommitExpandedBorder: "#e0e0e0",
    gitCommitFile: "#222",
    gitMergeIcon: "#a855f7",
    gitBranchCurrentBg: "rgba(0,112,243,0.15)",
    gitBranchCurrentFg: "#0070f3",
    gitBranchCurrentBorder: "rgba(0,112,243,0.2)",
    gitBranchOtherBg: "rgba(249,115,22,0.15)",
    gitBranchOtherFg: "#f97316",
    gitBranchOtherBorder: "rgba(249,115,22,0.2)",
  },
  solarizedLight: {
    background: "#fdf6e3",
    foreground: "#657b83",
    accent: "#eee8d5",
    primary: "#b58900",
    mermaidBg: "#f3f6fa",
    editorBg: "#fdf6e3",
    editorFg: "#657b83",
    editorLineHighlight: "#eee8d5",
    editorSelection: "#b58900",
    editorCursor: "#b58900",
    cardBg: "#eee8d5",
    border: "#b58900",
    mutedBg: "#f5eecb",
    mutedFg: "#657b83",
    accentBg: "#eee8d5",
    accentFg: "#b58900",
    red: "#dc322f",
    sidebarTitleFg: "#657b83",
    sidebarIconFg: "#657b83",
    sidebarResizerBg: "#eee8d5",
    gitBranchColors: [
      "#b58900", // yellow
      "#268bd2", // blue
      "#2aa198", // cyan
      "#dc322f", // red
      "#6c71c4", // violet
      "#859900", // green
      "#cb4b16", // orange
      "#d33682", // magenta
    ],
    gitCommitStroke: "#657b83",
    gitMergeDot: "#eee8d5",
    gitCommitChevron: "#657b83",
    gitCommitMsg: "#657b83",
    gitCommitMeta: "#657b83",
    gitCommitExpandedBg: "#eee8d5",
    gitCommitExpandedBorder: "#b58900",
    gitCommitFile: "#657b83",
    gitMergeIcon: "#6c71c4",
    gitBranchCurrentBg: "rgba(181,137,0,0.15)",
    gitBranchCurrentFg: "#b58900",
    gitBranchCurrentBorder: "rgba(181,137,0,0.2)",
    gitBranchOtherBg: "rgba(220,50,47,0.15)",
    gitBranchOtherFg: "#dc322f",
    gitBranchOtherBorder: "rgba(220,50,47,0.2)",
  },
};

interface ThemeContextProps {
  colors: ThemeColors;
  setColor: (key: string, value: string) => void;
  setColors: (colors: ThemeColors) => void;
  themeName: string;
  setTheme: (name: string) => void;
  themeList: string[];
  highlightTheme: string;
  setHighlightTheme: (name: string) => void;
  highlightThemeList: string[];
}

const ThemeContext = createContext<ThemeContextProps | undefined>(undefined);

export const ThemeProvider = ({ children }: { children: ReactNode }) => {
  // SSR/クライアントで初期値を必ず一致させる
  const [themeName, setThemeName] = useState<string>("dark");
  const [colors, setColorsState] = useState<ThemeColors>(themes["dark"]);
  // shiki用ハイライトテーマ
  const highlightThemeList = [
    "github-dark",
    "github-light",
    "nord",
    "dracula",
    "monokai",
    "min-dark",
    "min-light",
    "solarized-dark",
    "solarized-light",
    "material-theme-darker",
    "material-theme-lighter",
    "material-theme-palenight",
    "material-theme-ocean",
    "one-light",
  ];
  const [highlightTheme, setHighlightTheme] = useState<string>("github-dark");

  // クライアントマウント後にlocalStorageのテーマを反映
  useEffect(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("themeName");
      if (saved && themes[saved]) {
        setThemeName(saved);
        setColorsState(themes[saved]);
      }
      const savedHighlight = localStorage.getItem("highlightTheme");
      if (savedHighlight && highlightThemeList.includes(savedHighlight)) {
        setHighlightTheme(savedHighlight);
      }
    }
  }, []);

  const setColor = (key: string, value: string) => {
    setColorsState((prev) => ({ ...prev, [key]: value }));
  };

  const setColors = (newColors: ThemeColors) => {
    setColorsState(newColors);
  };

  const setTheme = (name: string) => {
    if (themes[name]) {
      setThemeName(name);
      setColorsState(themes[name]);
      if (typeof window !== "undefined") {
        localStorage.setItem("themeName", name);
      }
    }
  };

  const setHighlightThemePersist = (name: string) => {
    if (highlightThemeList.includes(name)) {
      setHighlightTheme(name);
      if (typeof window !== "undefined") {
        localStorage.setItem("highlightTheme", name);
      }
    }
  };

  return (
    <ThemeContext.Provider
      value={{
        colors,
        setColor,
        setColors,
        themeName,
        setTheme,
        themeList: Object.keys(themes),
        highlightTheme,
        setHighlightTheme: setHighlightThemePersist,
        highlightThemeList,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
};
