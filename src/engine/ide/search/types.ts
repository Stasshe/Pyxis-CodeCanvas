import type { FileItem } from '@/types/index';

export interface SearchResult {
  file: FileItem;
  line: number;
  column: number;
  content: string;
  matchStart: number;
  matchEnd: number;
}

export type SearchFlatItem =
  | {
      type: 'header';
      groupKey: string;
      first: SearchResult;
      resultCount: number;
      isCollapsed: boolean;
    }
  | {
      type: 'result';
      groupKey: string;
      result: SearchResult;
      globalIndex: number;
      idxInGroup: number;
    };
