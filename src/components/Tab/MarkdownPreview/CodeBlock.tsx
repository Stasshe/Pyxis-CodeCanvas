import React from 'react';

import { FileItem } from '@/types';

import InlineHighlightedCode from '../InlineHighlightedCode';

import Mermaid from './Mermaid';

interface MemoizedCodeComponentProps {
  className?: string;
  children: React.ReactNode;
  colors: {
    mermaidBg?: string;
    background?: string;
    foreground?: string;
    [key: string]: string | undefined;
  };
  currentProjectName?: string;
  projectFiles?: FileItem[];
}

const MemoizedCodeComponent = React.memo<MemoizedCodeComponentProps>(
  ({ className, children, colors }) => {
    const match = /language-(\w+)/.exec(className || '');
    const codeString = String(children).replace(/\n$/, '').trim();

    if (match && match[1] === 'mermaid') {
      return <Mermaid chart={codeString} colors={colors} />;
    }

    if (className && match) {
      return <InlineHighlightedCode language={match[1] || ''} value={codeString} />;
    }

    // インラインコード: InlineHighlightedCode を使う
    return <InlineHighlightedCode language={'plainText'} value={codeString} inline />;
  }
);

MemoizedCodeComponent.displayName = 'MemoizedCodeComponent';

export default MemoizedCodeComponent;
