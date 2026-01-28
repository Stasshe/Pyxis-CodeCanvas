'use client';

import type { FileItem } from '@/types';
import type React from 'react';
import { getIconForFile } from 'vscode-icons-js';
import { ThemeColors } from '@/context/ThemeContext';

// FileItem[]を平坦化する関数（tab.tsと同じ実装）
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

// --- VSCode-style matching helpers ---
// CamelCase/snake_case boundaries を考慮したスコアリング
export function scoreMatch(text: string, query: string): number {
  if (!query) return 100;
  const t = text.toLowerCase();
  const q = query.toLowerCase();

  // 完全一致
  if (t === q) return 100;

  // 前方一致（高スコア）
  if (t.startsWith(q)) return 90;

  // 部分文字列一致
  const idx = t.indexOf(q);
  if (idx !== -1) {
    // 単語の境界で始まる場合はスコアを上げる
    const isBoundary =
      idx === 0 || text[idx - 1] === '/' || text[idx - 1] === '_' || text[idx - 1] === '-';
    return isBoundary ? 85 : 70;
  }

  // CamelCase マッチング (e.g., "ow" matches "OperationWindow")
  const camelIndices: number[] = [];
  let queryIdx = 0;
  for (let i = 0; i < text.length && queryIdx < query.length; i++) {
    if (text[i].toLowerCase() === query[queryIdx].toLowerCase()) {
      const isUpperCase = text[i] === text[i].toUpperCase() && text[i] !== text[i].toLowerCase();
      const isBoundary =
        i === 0 || text[i - 1] === '/' || text[i - 1] === '_' || text[i - 1] === '-';
      if (isUpperCase || isBoundary || queryIdx > 0) {
        camelIndices.push(i);
        queryIdx++;
      }
    }
  }
  if (queryIdx === query.length) return 60;

  return 0; // マッチしない
}

export function getIconSrcForFile(name: string) {
  const iconPath = getIconForFile(name) || getIconForFile('');
  if (iconPath?.endsWith('.svg')) {
    return `${process.env.NEXT_PUBLIC_BASE_PATH || ''}/vscode-icons/${iconPath.split('/').pop()}`;
  }
  return `${process.env.NEXT_PUBLIC_BASE_PATH || ''}/vscode-icons/file.svg`;
}

// テキストのハイライトを行うヘルパー
export function highlightMatch(
  text: string,
  query: string | string[],
  isSelected: boolean,
  colors: ThemeColors
): React.ReactNode {
  const tokens = Array.isArray(query)
    ? query.filter(Boolean)
    : String(query || '')
        .split(/\s+/)
        .filter(Boolean);
  if (tokens.length === 0) return <>{text}</>;

  const escaped = tokens.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = new RegExp(`(${escaped.join('|')})`, 'ig');
  const parts = text.split(re);

  return (
    <>
      {parts.map((part, i) => {
        if (tokens.some(tok => part.toLowerCase() === tok.toLowerCase())) {
          return (
            <span
              key={i}
              style={{
                background: isSelected ? 'rgba(255,255,255,0.3)' : colors.accentBg,
                color: isSelected ? colors.cardBg : colors.primary,
                fontWeight: 'bold',
                borderRadius: '2px',
                padding: '0 1px',
              }}
            >
              {part}
            </span>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}
