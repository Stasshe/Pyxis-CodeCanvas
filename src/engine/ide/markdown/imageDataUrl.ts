import { detectFileContent } from '@/engine/core/fileBytes';
import { fsClient } from '@/engine/core/fs/index';

const imageMimeTypes: Record<string, string> = {
  gif: 'image/gif',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  svg: 'image/svg+xml',
  webp: 'image/webp',
};

export const loadImageAsDataURL = async (imagePath: string): Promise<string> => {
  const extension = imagePath.toLowerCase().split('.').pop() ?? '';
  const bytes = await fsClient.readFile(imagePath);
  const fileContent = await detectFileContent(imagePath, bytes);
  let mimeType = imageMimeTypes[extension] ?? 'application/octet-stream';
  if (fileContent.kind === 'binary' && fileContent.mimeType) {
    mimeType = fileContent.mimeType;
  }
  let binary = '';
  const chunkSize = 0x8000;

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }

  return `data:${mimeType};base64,${btoa(binary)}`;
};
