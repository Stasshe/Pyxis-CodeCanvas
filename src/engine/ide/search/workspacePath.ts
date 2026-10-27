import { isPathWithin } from '@/engine/core/paths';

export function isCurrentWorkspacePath(
  filePath: string,
  requestedRoot: string,
  currentRoot: string
): boolean {
  return requestedRoot === currentRoot && isPathWithin(filePath, requestedRoot);
}
