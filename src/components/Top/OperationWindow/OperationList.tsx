'use client';

import type { OperationListItem } from '@/components/Top/OperationWindow/OperationWindow';
import type { FileItem } from '@/types';

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

export default function OperationList(props: Props) {
  // Thin wrapper kept for backward compatibility and future splitting
  return <OperationVirtualList {...props} />;
}
