import React from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { dark } from 'react-syntax-highlighter/dist/esm/styles/prism';

export function HighlightedCode({ language, value }: { language: string; value: string }) {
  return (
    <SyntaxHighlighter style={dark} language={language} PreTag="div" customStyle={{ borderRadius: 8, fontSize: '1em', margin: 0 }}>
      {value}
    </SyntaxHighlighter>
  );
}
