import { memo, type ReactNode } from 'react';

import type { FileItem } from '@/types';

import InlineHighlightedCode from '../InlineHighlightedCode';

import Mermaid from './Mermaid';

interface MemoizedCodeComponentProps {
  className?: string;
  children: ReactNode;
  currentProjectName?: string;
  projectFiles?: FileItem[];
}

const MemoizedCodeComponent = memo<MemoizedCodeComponentProps>(({ className, children }) => {
  const match = /language-(\w+)/.exec(className || '');
  const codeString = String(children).replace(/\n$/, '').trim();

  if (match && match[1] === 'mermaid') {
    return <Mermaid chart={codeString} />;
  }

  if (className && match) {
    return <InlineHighlightedCode language={match[1] || ''} value={codeString} />;
  }

  // インラインコード: InlineHighlightedCode を使う
  return <InlineHighlightedCode language={'plainText'} value={codeString} inline />;
});

MemoizedCodeComponent.displayName = 'MemoizedCodeComponent';

export default MemoizedCodeComponent;
