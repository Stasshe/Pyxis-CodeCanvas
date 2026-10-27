import { readFileContent } from '@/engine/core/fileContent';
import { fsClient } from '@/engine/core/fs/index';
import type { TabFileInfo, TabKind } from '@/engine/ide/tabs/types';

export async function prepareFileForTab(
  file: TabFileInfo,
  requestedKind: TabKind
): Promise<{ file: TabFileInfo; kind: TabKind }> {
  let kind = requestedKind;
  let preparedFile = file;
  if (file.isBufferArray || file.bufferContent) kind = 'binary';

  if (!file.path) return { file: preparedFile, kind };
  if (kind === 'binary') {
    if (file.bufferContent !== undefined) return { file: preparedFile, kind };
    const metadata = await fsClient.stat(file.path);
    if (metadata.type !== 'file') {
      throw new Error(`Cannot open ${file.path}: path is not a file.`);
    }
    const bytes = await fsClient.readFile(file.path);
    preparedFile = {
      ...file,
      isBufferArray: true,
      bufferContent: Uint8Array.from(bytes).buffer,
    };
    return { file: preparedFile, kind };
  }

  if (kind !== 'editor' && kind !== 'preview') return { file: preparedFile, kind };
  if (file.content !== undefined) return { file: preparedFile, kind };

  const metadata = await fsClient.stat(file.path);
  if (metadata.type !== 'file') {
    throw new Error(`Cannot open ${file.path}: path is not a file.`);
  }
  const content = await readFileContent(file.path);
  if (content.kind === 'binary') {
    kind = 'binary';
    preparedFile = {
      ...file,
      isBufferArray: true,
      bufferContent: content.bufferContent,
      mimeType: content.mimeType,
    };
  } else {
    preparedFile = { ...file, content: content.content };
  }
  return { file: preparedFile, kind };
}
