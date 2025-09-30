import { getFileSystem } from '@/utils/core/filesystem';
import { FileItem } from '@/types';

// Safe conversion of Uint8Array to base64 using chunking to avoid call stack limits
export const uint8ArrayToBase64 = (uint8Array: Uint8Array): string => {
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
  projectFiles?: FileItem[]
): Promise<string | null> => {
  if (!projectName) return null;

  if (projectFiles) {
    const normalizedPath = imagePath.startsWith('/') ? imagePath : '/' + imagePath;

    const findFileRecursively = (files: FileItem[]): FileItem | null => {
      for (const file of files) {
        if (
          file.path === normalizedPath &&
          file.type === 'file' &&
          file.isBufferArray &&
          file.bufferContent
        ) {
          return file;
        }
        if (file.children) {
          const found = findFileRecursively(file.children);
          if (found) return found;
        }
      }
      return null;
    };

    const imageFile = findFileRecursively(projectFiles);
    if (imageFile && imageFile.bufferContent) {
      try {
        const extension = imagePath.toLowerCase().split('.').pop();
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

        const uint8Array = new Uint8Array(imageFile.bufferContent);
        const base64 = uint8ArrayToBase64(uint8Array);
        return `data:${mimeType};base64,${base64}`;
      } catch (error) {
        console.warn(`Failed to load image from bufferContent: ${imagePath}`, error);
      }
    }
  }

  const fs = getFileSystem();
  if (!fs) return null;

  try {
    const normalizedPath = imagePath.startsWith('/') ? imagePath.slice(1) : imagePath;
    const fullPath = `/projects/${projectName}/${normalizedPath}`;
    const stat = await fs.promises.stat(fullPath);
    if (!stat.isFile()) return null;

    const fileData = await fs.promises.readFile(fullPath);

    const extension = imagePath.toLowerCase().split('.').pop();
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

    const uint8Array =
      fileData instanceof ArrayBuffer ? new Uint8Array(fileData) : new Uint8Array(fileData as any);
    const base64 = uint8ArrayToBase64(uint8Array);
    return `data:${mimeType};base64,${base64}`;
  } catch (error) {
    console.warn(`Failed to load image: ${imagePath}`, error);
    return null;
  }
};

export const parseYamlConfig = (yamlText: string): any => {
  try {
    const lines = yamlText.split('\n').filter(line => line.trim());
    const config: any = {};
    let currentObject = config;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const colonIndex = trimmed.indexOf(':');
      if (colonIndex > 0) {
        const key = trimmed.substring(0, colonIndex).trim();
        const value = trimmed.substring(colonIndex + 1).trim();
        if (value) {
          let parsedValue: any = value;
          if (value === 'true' || value === 'false') parsedValue = value === 'true';
          else if (!isNaN(Number(value))) parsedValue = Number(value);
          else if (value.startsWith("'") && value.endsWith("'")) parsedValue = value.slice(1, -1);
          currentObject[key] = parsedValue;
        } else {
          currentObject[key] = {};
          currentObject = currentObject[key];
        }
      }
    }
    return config;
  } catch (error) {
    console.warn('YAML設定の解析に失敗:', error);
    return {};
  }
};

export const parseMermaidContent = (chart: string): { config: any; diagram: string } => {
  const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/;
  const match = chart.match(frontmatterRegex);
  if (match) {
    const yamlContent = match[1];
    const diagramContent = match[2];
    const config = parseYamlConfig(yamlContent);
    return { config, diagram: diagramContent };
  }
  return { config: {}, diagram: chart };
};
