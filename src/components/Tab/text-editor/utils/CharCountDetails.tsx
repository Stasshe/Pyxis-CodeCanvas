import React, { useMemo } from 'react';

interface CharCountDetailsProps {
  content: string;
}

function countLines(text: string): number {
  return text.split(/\r?\n/).length;
}

function countWords(text: string): number {
  // 単語の区切りは空白・改行・タブ
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function countChars(text: string): number {
  return text.length;
}

function countCharsNoSpaces(text: string): number {
  return text.replace(/\s/g, '').length;
}

function countZenkaku(text: string): number {
  // 全角文字（日本語、全角記号など）
  return (text.match(/[\u3000-\u9FFF\uFF01-\uFF60\uFFE0-\uFFEF]/g) || []).length;
}

function countHankaku(text: string): number {
  // 半角英数・記号
  return (text.match(/[\u0020-\u007E]/g) || []).length;
}

function countDigits(text: string): number {
  return (text.match(/[0-9]/g) || []).length;
}

function countAlpha(text: string): number {
  return (text.match(/[A-Za-z]/g) || []).length;
}

function countSymbols(text: string): number {
  // 記号（英記号・全角記号）
  return (text.match(/[!-/:-@\[-`{-~\uFF01-\uFF60\uFFE0-\uFFEF]/g) || []).length;
}

function countSpaces(text: string): number {
  return (text.match(/\s/g) || []).length;
}

function countNewlines(text: string): number {
  return (text.match(/\r?\n/g) || []).length;
}

function maxLineLength(text: string): number {
  return Math.max(...text.split(/\r?\n/).map(line => line.length), 0);
}

function avgLineLength(text: string): number {
  const lines = text.split(/\r?\n/);
  if (lines.length === 0) return 0;
  return Math.round(lines.reduce((sum, line) => sum + line.length, 0) / lines.length);
}

const CharCountDetails: React.FC<CharCountDetailsProps> = ({ content }) => {
  const stats = useMemo(
    () => ({
      lines: countLines(content),
      words: countWords(content),
      chars: countChars(content),
      charsNoSpaces: countCharsNoSpaces(content),
      zenkaku: countZenkaku(content),
      hankaku: countHankaku(content),
      digits: countDigits(content),
      alpha: countAlpha(content),
      symbols: countSymbols(content),
      spaces: countSpaces(content),
      newlines: countNewlines(content),
      maxLineLen: maxLineLength(content),
      avgLineLen: avgLineLength(content),
    }),
    [content]
  );

  return (
    <div
      style={{
        padding: '10px',
        background: 'rgba(30,30,30,0.95)',
        color: '#d4d4d4',
        borderRadius: 8,
        fontSize: 14,
      }}
    >
      <div>行数: {stats.lines}</div>
      <div>単語数: {stats.words}</div>
      <div>文字数: {stats.chars}</div>
      <div>文字数（スペース除外）: {stats.charsNoSpaces}</div>
      <div>全角文字数: {stats.zenkaku}</div>
      <div>半角文字数: {stats.hankaku}</div>
      <div>数字: {stats.digits}</div>
      <div>英字: {stats.alpha}</div>
      <div>記号: {stats.symbols}</div>
      <div>空白: {stats.spaces}</div>
      <div>改行: {stats.newlines}</div>
      <div>最大行長: {stats.maxLineLen}</div>
      <div>平均行長: {stats.avgLineLen}</div>
    </div>
  );
};

export default CharCountDetails;
