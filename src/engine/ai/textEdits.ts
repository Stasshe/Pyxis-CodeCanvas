import { readFileContent } from '@/engine/core/fileContent';

export async function readAIText(path: string): Promise<string> {
  const file = await readFileContent(path);
  if (file.kind === 'binary') {
    throw new Error(`Cannot edit binary file with AI: ${path}`);
  }
  return file.content;
}
