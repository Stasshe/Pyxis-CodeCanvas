import { fileTypeFromBuffer } from 'file-type';

export type FileContent =
  | { kind: 'text'; content: string }
  | { kind: 'binary'; bufferContent: ArrayBuffer; mimeType?: string };

const BINARY_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'avif',
  'ico',
  'bmp',
  'tif',
  'tiff',
  'heic',
  'heif',
  'pdf',
  'doc',
  'docx',
  'docm',
  'dotx',
  'dotm',
  'xls',
  'xlt',
  'xla',
  'xlsx',
  'xlsm',
  'xltx',
  'xltm',
  'xlam',
  'xlsb',
  'ppt',
  'pps',
  'ppa',
  'pptx',
  'pptm',
  'potx',
  'potm',
  'ppsx',
  'ppsm',
  'ppam',
  'sldx',
  'sldm',
  'odt',
  'ott',
  'ods',
  'ots',
  'odp',
  'otp',
  'odg',
  'otg',
  'odf',
  'zip',
  'tar',
  'gz',
  'tgz',
  'bz2',
  'xz',
  '7z',
  'rar',
  'mp3',
  'wav',
  'flac',
  'ogg',
  'm4a',
  'aac',
  'mp4',
  'mov',
  'mkv',
  'avi',
  'webm',
  'exe',
  'dll',
  'so',
  'dylib',
  'class',
  'jar',
  'wasm',
  'woff',
  'woff2',
  'ttf',
  'otf',
  'eot',
  'sqlite',
  'sqlite3',
]);

function hasBinaryExtension(path: string): boolean {
  const name = path.split('/').pop() ?? '';
  const extension = name.split('.').pop()?.toLowerCase() ?? '';
  return BINARY_EXTENSIONS.has(extension);
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
}

export function classifyFileContent(
  path: string,
  bytes: Uint8Array,
  detectedMimeType?: string
): FileContent {
  const textMime =
    detectedMimeType?.startsWith('text/') ||
    detectedMimeType?.endsWith('+xml') ||
    detectedMimeType === 'application/xml' ||
    detectedMimeType === 'application/rtf' ||
    detectedMimeType === 'application/postscript';
  let isBinary = Boolean(detectedMimeType && !textMime) || hasBinaryExtension(path);
  let content = '';
  if (!isBinary) {
    if (bytes.includes(0)) {
      isBinary = true;
    } else {
      try {
        content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
      } catch {
        isBinary = true;
      }
    }
  }

  if (isBinary) {
    const binary: FileContent = {
      kind: 'binary',
      bufferContent: toArrayBuffer(bytes),
    };
    if (detectedMimeType) binary.mimeType = detectedMimeType;
    return binary;
  }

  return { kind: 'text', content };
}

export async function detectFileContent(path: string, bytes: Uint8Array): Promise<FileContent> {
  try {
    const mimeType = (await fileTypeFromBuffer(bytes))?.mime;
    return classifyFileContent(path, bytes, mimeType);
  } catch (error) {
    if (!(error instanceof Error) || error.name !== 'EndOfStreamError') throw error;
    return { kind: 'binary', bufferContent: toArrayBuffer(bytes) };
  }
}
