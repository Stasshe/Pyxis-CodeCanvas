'use client';

import { getIconSrcForFile, highlightMatch } from '@/components/Top/OperationWindow/OperationUtils';
import type { OperationListItem } from '@/components/Top/OperationWindow/OperationWindow';
import type { FileItem } from '@/types';
import React from 'react';

interface Props {
  viewMode: 'files' | 'list';
  filteredFiles: FileItem[];
  filteredItems: OperationListItem[];
  selectedIndex: number;
  setSelectedIndex: (i: number) => void;
  handleFileSelectInOperation: (file: FileItem) => void;
  ITEM_HEIGHT: number;
  colors: any;
  queryTokens: string[];
  t: (k: string) => string;
}

import OperationVirtualList from './OperationVirtualList';

export default function OperationList(props: any) {
  // Thin wrapper kept for backward compatibility and future splitting
  return <OperationVirtualList {...props} />;
}
