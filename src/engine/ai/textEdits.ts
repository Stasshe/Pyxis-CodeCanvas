import { readFileContent } from '@/engine/core/fileContent';
import { fsClient } from '@/engine/core/fs';

export async function readAIText(path: string): Promise<string> {
  const file = await readFileContent(path);
  if (file.kind === 'binary') {
    throw new Error(`Cannot edit binary file with AI: ${path}`);
  }
  return file.content;
}

export async function prepareAITextWrite(path: string, content: string): Promise<string> {
  if (!(await fsClient.exists(path))) return content;
  const original = await readAIText(path);
  if (original.startsWith('\uFEFF') && !content.startsWith('\uFEFF')) {
    return `\uFEFF${content}`;
  }
  return content;
}
