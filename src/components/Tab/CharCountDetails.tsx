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

const CharCountDetails: React.FC<CharCountDetailsProps> = ({ content }) => {
  const stats = useMemo(() => ({
    lines: countLines(content),
    words: countWords(content),
    chars: countChars(content),
    charsNoSpaces: countCharsNoSpaces(content),
  }), [content]);

  return (
    <div style={{ padding: '10px', background: 'rgba(30,30,30,0.95)', color: '#d4d4d4', borderRadius: 8, fontSize: 14 }}>
      <div>行数: {stats.lines}</div>
      <div>単語数: {stats.words}</div>
      <div>文字数: {stats.chars}</div>
      <div>文字数（スペース除外）: {stats.charsNoSpaces}</div>
    </div>
  );
};

export default CharCountDetails;
