import type { Segment } from './types';

export interface CommandGroup {
  segments: Segment[];
  operator?: Segment['separator'];
}

export function groupCommands(segments: Segment[]): CommandGroup[] {
  const groups: CommandGroup[] = [];
  let current: Segment[] = [];
  for (const segment of segments) {
    current.push(segment);
    if (segment.separator !== '|') {
      groups.push({ segments: current, operator: segment.separator });
      current = [];
    }
  }
  return groups;
}
