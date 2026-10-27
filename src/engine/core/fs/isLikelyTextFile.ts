import { detectFileContent } from '@/engine/core/fileBytes';

export async function isLikelyTextFile(path: string, bytes: Uint8Array): Promise<boolean> {
  return (await detectFileContent(path, bytes)).kind === 'text';
}
