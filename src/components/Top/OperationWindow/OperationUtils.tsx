import type React from 'react';
import { getIconForFile } from 'vscode-icons-js';
import type { ThemeColors } from '@/context/ThemeContext';
import { assetPath } from '@/env';
import type { FileItem } from '@/types';
import { matchText } from './fileSearchUtils';

// Flatten nested project file items.
export function flattenFileItems(items: FileItem[]): FileItem[] {
  const result: FileItem[] = [];

  function traverse(items: FileItem[]) {
    for (const item of items) {
      result.push(item);
      if (item.children && item.children.length > 0) {
        traverse(item.children);
      }
    }
  }

  traverse(items);
  return result;
}

const ICON_SRC_CACHE = new Map<string, string>();
export function getIconSrcForFile(name: string) {
  const key = name || '';
  const cached = ICON_SRC_CACHE.get(key);
  if (cached) return cached;
  const iconPath = getIconForFile(name) || getIconForFile('');
  let src: string;
  if (iconPath?.endsWith('.svg')) {
    src = assetPath(`/vscode-icons/${iconPath.split('/').pop()}`);
  } else {
    src = assetPath('/vscode-icons/file.svg');
  }
  ICON_SRC_CACHE.set(key, src);
  return src;
}

// Highlight fuzzy matches in text.
export function highlightMatch(
  text: string,
  query: string | string[],
  isSelected: boolean,
  colors: ThemeColors
): React.ReactNode {
  let tokens: string[] = [];
  if (Array.isArray(query)) tokens = query.filter(Boolean);
  else
    tokens = String(query || '')
      .split(/\s+/)
      .filter(Boolean);
  if (tokens.length === 0) return <>{text}</>;

  const matches = new Set<number>();
  for (const token of tokens) {
    for (const index of matchText(text, token)?.indices ?? []) matches.add(index);
  }

  const segments: { text: string; matched: boolean; start: number }[] = [];
  for (let index = 0; index < text.length; index += 1) {
    const matched = matches.has(index);
    const previous = segments[segments.length - 1];
    if (previous && previous.matched === matched) previous.text += text[index];
    else segments.push({ text: text[index], matched, start: index });
  }

  let matchColor = colors.primary;
  if (isSelected) matchColor = colors.editorFg;
  const renderedParts = segments.map(segment => {
    const key = `${segment.start}-${segment.matched}`;
    if (!segment.matched) return <span key={key}>{segment.text}</span>;
    return (
      <span
        key={key}
        style={{
          color: matchColor,
          fontWeight: 'bold',
        }}
      >
        {segment.text}
      </span>
    );
  });

  return <>{renderedParts}</>;
}
