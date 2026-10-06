import { fsClient } from '@/engine/core/fs';

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
  const mimeType = imageMimeTypes[extension] ?? 'application/octet-stream';
  const bytes = await fsClient.readFile(imagePath);
  let binary = '';
  const chunkSize = 0x8000;

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }

  return `data:${mimeType};base64,${btoa(binary)}`;
};
