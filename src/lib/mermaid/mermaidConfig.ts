import type { MermaidConfig } from 'mermaid';

import type { ThemeColors } from '@/context/ThemeContext';

type MermaidColors = Pick<
  ThemeColors,
  'accent' | 'background' | 'border' | 'cardBg' | 'foreground' | 'mutedBg'
>;

interface MermaidConfigOptions {
  colors: MermaidColors;
  isDark: boolean;
}

export function createMermaidConfig({ colors, isDark }: MermaidConfigOptions): MermaidConfig {
  return {
    startOnLoad: false,
    theme: isDark ? 'dark' : 'default',
    securityLevel: 'loose',
    htmlLabels: false,
    themeVariables: {
      fontSize: '8px',
      primaryTextColor: colors.foreground,
      secondaryTextColor: colors.foreground,
      tertiaryTextColor: colors.foreground,
      textColor: colors.foreground,
      primaryColor: colors.accent,
      primaryBorderColor: colors.border,
      secondaryColor: colors.mutedBg,
      secondaryBorderColor: colors.border,
      tertiaryColor: colors.cardBg,
      tertiaryBorderColor: colors.border,
      lineColor: colors.foreground,
      labelTextColor: colors.foreground,
      nodeBorder: colors.border,
      clusterBkg: colors.cardBg,
      clusterBorder: colors.border,
      edgeLabelBackground: colors.background,
    },
    suppressErrorRendering: true,
    maxTextSize: 100000,
    maxEdges: 2000,
    flowchart: {
      useMaxWidth: false,
      curve: 'basis',
      rankSpacing: 80,
      nodeSpacing: 50,
    },
    layout: 'dagre',
  };
}
