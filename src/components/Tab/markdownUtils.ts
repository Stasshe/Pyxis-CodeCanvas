import { fileRepository } from '@/engine/core/fileRepository';
import { FileItem } from '@/types';

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
  projectId?: string
): Promise<string | null> => {
  if (!projectName && !projectId) return null;

  try {
    // Always fetch project files from fileRepository. Prefer projectId when provided.
    let files: FileItem[] | undefined;
    if (projectId) {
      files = await fileRepository.getProjectFiles(projectId);
    } else {
      const projects = await fileRepository.getProjects();
      const project = projects.find((p: any) => p.name === projectName || p.id === projectName);
      if (!project) return null;
      files = await fileRepository.getProjectFiles(project.id);
    }

    const normalizedPath = imagePath.startsWith('/') ? imagePath : '/' + imagePath;
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

    // Find the file in the project files (recursive)
    const findFileRecursively = (filesList: FileItem[] | undefined): FileItem | null => {
      if (!filesList) return null;
      for (const file of filesList) {
        // Normalize stored file.path to ensure leading slash
        const filePath = file.path && file.path.startsWith('/') ? file.path : '/' + file.path;
        if (filePath === normalizedPath && file.type === 'file') return file;
        if (file.children) {
          const found = findFileRecursively(file.children);
          if (found) return found;
        }
      }
      return null;
    };

  const imageFile = findFileRecursively(files);
    if (!imageFile) return null;

    // If bufferContent exists, convert to base64
    if (imageFile.isBufferArray && imageFile.bufferContent) {
      const uint8Array = new Uint8Array(imageFile.bufferContent as any);
      const base64 = uint8ArrayToBase64(uint8Array);
      return `data:${mimeType};base64,${base64}`;
    }

    // If content exists and looks like a data URL, return it
    if (typeof (imageFile as any).content === 'string') {
      const contentStr = (imageFile as any).content as string;
      if (contentStr.startsWith('data:')) return contentStr;
      // Otherwise assume it's raw text (e.g. SVG) or base64-encoded; try to encode
      try {
        if (extension === 'svg' || /^\s*</.test(contentStr)) {
          return `data:${mimeType};utf8,${encodeURIComponent(contentStr)}`;
        }
        // Fallback: treat as base64 content
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
