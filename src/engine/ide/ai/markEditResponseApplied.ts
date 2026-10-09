import type { AIEditResponse } from '@/types/index';

export function markEditResponseFileApplied(
  response: AIEditResponse,
  filePath: string,
  originalContent: string | undefined,
  appliedContent: string
): AIEditResponse {
  return {
    ...response,
    changedFiles: response.changedFiles.map(file => {
      if (file.path !== filePath) return file;
      const updated = { ...file, applied: true };
      if (originalContent !== undefined) updated.originalContent = originalContent;
      updated.appliedContent = appliedContent;
      return updated;
    }),
  };
}

export function markEditResponseFileReverted(
  response: AIEditResponse,
  filePath: string
): AIEditResponse {
  return {
    ...response,
    changedFiles: response.changedFiles.map(file => {
      if (file.path !== filePath) return file;
      return { ...file, applied: false };
    }),
  };
}
