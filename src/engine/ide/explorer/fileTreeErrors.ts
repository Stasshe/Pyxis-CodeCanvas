import { FSError } from '@/engine/core/fs/errors';
import { pushLogMessage } from '@/stores/loggerStore';

export function fileTreeErrorMessage(
  error: unknown,
  destinationExists: (path: string) => string
): string {
  if (error instanceof FSError && error.code === 'EEXIST') return destinationExists(error.path);
  return error instanceof Error ? error.message : String(error);
}

export function reportFileTreeError(message: string): void {
  pushLogMessage(message, 'error', 'FileTree');
  alert(message);
}
