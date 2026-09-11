import { fileTypeFromBuffer } from 'file-type';
import * as jschardet from 'jschardet';

// TextDecoder: prefer browser global, fall back to Node's util.TextDecoder
const TextDecoder =
  typeof globalThis !== 'undefined' && (globalThis as any).TextDecoder
    ? (globalThis as any).TextDecoder
    : /* eslint-disable-next-line @typescript-eslint/no-var-requires */ require('util').TextDecoder;

const textExtensions = new Set([
  'txt',
  'md',
  'markdown',
  'json',
  'js',
  'jsx',
  'ts',
  'tsx',
  'html',
  'htm',
  'css',
  'svg',
  'scss',
  'sass',
  'less',
  'xml',
  'yml',
  'yaml',
  'csv',
  'env',
  'ini',
  'conf',
  'log',
  'py',
  'rb',
  'go',
  'rs',
  'java',
  'c',
  'cpp',
  'h',
  'hpp',
  'cs',
  'sh',
  'bash',
  'zsh',
  'ps1',
  'bat',
  'gradle',
  'makefile',
  'mk',
]);

const binaryExtensions = new Set([
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

/**
 * Determine whether a buffer likely represents a text file.
 * This centralizes the logic used by multiple archive commands.
 */
export async function isLikelyTextFile(path: string, content: Uint8Array): Promise<boolean> {
  // Fast-path based on file extension to avoid expensive detection for common cases
  const fileName = path.split('/').pop() || '';
  const extension = fileName.split('.').pop()?.toLowerCase() || '';

  if (textExtensions.has(extension)) return true;
  if (binaryExtensions.has(extension)) return false;

  // Empty files without a known extension are safe to handle as text.
  if (content.length === 0) return true;

  // file-type gives reliable mime when it recognizes the content
  const type = await fileTypeFromBuffer(content);
  if (type && type.mime) {
    const mime = type.mime.toLowerCase();
    if (
      mime.startsWith('text/') ||
      mime === 'application/xml' ||
      mime.endsWith('+xml') ||
      mime === 'application/json' ||
      mime === 'application/javascript'
    )
      return true;

    if (
      mime.startsWith('image/') ||
      mime === 'application/pdf' ||
      mime === 'application/zip' ||
      mime === 'application/x-gzip' ||
      mime.startsWith('video/') ||
      mime.startsWith('audio/')
    )
      return false;
  }

  // jschardet encoding detection on a sample
  const sampleSizeEnc = Math.min(8192, content.length);
  const sample = new TextDecoder('iso-8859-1').decode(content.slice(0, sampleSizeEnc));
  const det = jschardet.detect(sample as any);
  if (det && det.encoding) {
    const enc = String(det.encoding).toLowerCase();
    const conf = typeof det.confidence === 'number' ? det.confidence : 0;
    if (
      enc.includes('utf-8') ||
      enc.includes('utf8') ||
      enc.includes('utf-16') ||
      enc.includes('ascii')
    )
      return true;
    if (conf > 0.9 && (enc.includes('binary') || enc.includes('iso-8859'))) {
      if (enc.includes('iso-8859')) return true;
      return false;
    }
  }

  // Final fallback: try to decode as UTF-8 (fatal)
  try {
    const decoder = new TextDecoder('utf-8', { fatal: true });
    decoder.decode(content.slice(0, Math.min(8192, content.length)));
    return true;
  } catch (e) {
    console.warn('[isLikelyTextFile.ts] caught non-fatal error', e);
    return false;
  }
}
