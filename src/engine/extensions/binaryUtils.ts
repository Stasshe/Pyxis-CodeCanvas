/**
 * Binary utilities for extension files
 * - centralizes binary extension list and mime map
 * - provides helpers to detect binary files, convert Uint8Array->dataURL and dataURL->Blob
 */

const binaryExts = [
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.ico',
  '.wasm',
  '.pdf',
  '.ttf',
  '.woff',
  '.woff2',
  '.mp3',
  '.mp4',
  '.webm',
  '.ogg',
] as const;

const mimeMap: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.pdf': 'application/pdf',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.ogg': 'audio/ogg',
};

export function isBinaryExt(filePath: string): boolean {
  const lower = (filePath || '').toLowerCase();
  return binaryExts.some(e => lower.endsWith(e));
}

export function extToMime(ext: string): string {
  return mimeMap[ext] || 'application/octet-stream';
}

export function toDataUrlFromUint8(uint8: Uint8Array, filePath?: string): string {
  // convert to base64 in chunks to avoid stack limits
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < uint8.length; i += chunkSize) {
    const chunk = uint8.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, Array.from(chunk as any));
  }
  const base64 = btoa(binary);
  let mime = 'application/octet-stream';
  if (filePath) {
    const lower = filePath.toLowerCase();
    const ext = binaryExts.find(e => lower.endsWith(e)) || '';
    mime = extToMime(ext);
  }
  return `data:${mime};base64,${base64}`;
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const match = dataUrl.match(/^data:([^;]+);base64,(.*)$/);
  if (!match) throw new Error('Invalid data URL');
  const mime = match[1];
  const base64 = match[2];
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export { binaryExts };
