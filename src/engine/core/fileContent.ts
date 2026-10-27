import { detectFileContent } from './fileBytes';
import { fsClient } from './fs/index';

export type { FileContent } from './fileBytes';
export { classifyFileContent, detectFileContent } from './fileBytes';

export async function readFileContent(path: string) {
  return detectFileContent(path, await fsClient.readFile(path));
}
