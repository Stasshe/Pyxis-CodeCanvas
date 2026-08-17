import { fileRepository } from '@/engine/core/fileRepository';
import type { FileItem } from '@/types';

// Safe conversion of Uint8Array to base64 using chunking to avoid call stack limits
const uint8ArrayToBase64 = (uint8Array: Uint8Array): string => {
  const CHUNK_SIZE = 0x8000; // 32KB chunks
  let result = '';
  for (let i = 0; i < uint8Array.length; i += CHUNK_SIZE) {
    const chunk = uint8Array.subarray(i, i + CHUNK_SIZE);
    result += String.fromCharCode.apply(null, Array.from(chunk));
  }
  return btoa(result);
};

export const loadImageAsDataURL = async (
  imagePath: string,
  projectName?: string,
  projectId?: string,
  baseFilePath?: string // optional path of the markdown file that references this image
): Promise<string | null> => {
  if (!projectName && !projectId) return null;

  try {
    // Prefer indexed single-file lookup when projectId is available
    if (projectId) {
      // we'll try to resolve candidate paths via getFileByPath instead of loading the whole tree
    }

    const extension = (imagePath || '').toLowerCase().split('.').pop();
    let mimeType = 'image/png';
    switch (extension) {
      case 'jpg':
      case 'jpeg':
        mimeType = 'image/jpeg';
        break;
      case 'png':
        mimeType = 'image/png';
        break;
      case 'gif':
        mimeType = 'image/gif';
        break;
      case 'svg':
        mimeType = 'image/svg+xml';
        break;
      case 'webp':
        mimeType = 'image/webp';
        break;
    }

    // Quick checks for external URLs or data URLs
    if (!imagePath) return null;
    if (
      imagePath.startsWith('http://') ||
      imagePath.startsWith('https://') ||
      imagePath.startsWith('data:')
    ) {
      return imagePath;
    }

    // Helper: normalize and resolve '..' and '.' segments
    const normalizeSegments = (p: string) => {
      const parts = p.split('/');
      const stack: string[] = [];
      for (const part of parts) {
        if (!part || part === '.') continue;
        if (part === '..') {
          if (stack.length) stack.pop();
        } else {
          stack.push(part);
        }
      }
      return `/${stack.join('/')}`;
    };

    // Build candidate paths to search in the project file tree.
    // We expect image paths to be either relative to the markdown file (baseFilePath)
    // or project-root relative. Keep resolution simple and deterministic.
    const candidates: string[] = [];
    if (imagePath.startsWith('/')) {
      // project-root relative
      candidates.push(normalizeSegments(imagePath));
    } else {
      if (baseFilePath) {
        const dir = baseFilePath.replace(/\/[^/]*$/, '').replace(/^\/?$/, '/');
        candidates.push(normalizeSegments(`${dir}/${imagePath}`));
      }
      // fallback: treat as project-root relative
      candidates.push(normalizeSegments(`/${imagePath}`));
    }

    // Remove duplicates while preserving order
    const uniqueCandidates = Array.from(new Set(candidates.filter(Boolean)));

    // Try candidate paths using indexed lookup when possible
    let imageFile: FileItem | null = null;
    if (projectId) {
      for (const cand of uniqueCandidates) {
        try {
          const f = await fileRepository.getFileByPath(projectId, cand);
          if (f && f.type === 'file') {
            imageFile = f as FileItem;
            break;
          }
        } catch (err) {
          console.warn('[markdownUtils.ts] caught non-fatal error', err);
          // ignore and try next candidate
        }
      }
    } else {
      // No projectId: conservative fallback (no project files loaded)
      return null;
    }

    // If bufferContent exists, convert to base64
    if ((imageFile as any).isBufferArray && (imageFile as any).bufferContent) {
      const uint8Array = new Uint8Array((imageFile as any).bufferContent as any);
      const base64 = uint8ArrayToBase64(uint8Array);
      return `data:${mimeType};base64,${base64}`;
    }

    // If content exists and looks like a data URL, return it
    if (typeof (imageFile as any).content === 'string') {
      const contentStr = (imageFile as any).content as string;
      if (contentStr.startsWith('data:')) return contentStr;
      try {
        if (extension === 'svg' || /^\s*</.test(contentStr)) {
          return `data:${mimeType};utf8,${encodeURIComponent(contentStr)}`;
        }
        return `data:${mimeType};base64,${btoa(contentStr)}`;
      } catch (err) {
        console.warn('Failed to convert file content to data URL', err);
        return null;
      }
    }

    return null;
  } catch (error) {
    console.warn(`Failed to load image: ${imagePath}`, error);
    return null;
  }
};
