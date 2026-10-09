import { isPathWithin } from '@/engine/core/pathUtils';

export function isCurrentWorkspacePath(
  filePath: string,
  requestedRoot: string,
  currentRoot: string
): boolean {
  return requestedRoot === currentRoot && isPathWithin(filePath, requestedRoot);
}
