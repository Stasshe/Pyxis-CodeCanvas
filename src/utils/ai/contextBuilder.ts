// ファイルコンテキスト構築ユーティリティ

import type { FileItem, ProjectFile, AIFileContext } from '@/types';

// ファイル内容の行数制限（400行）
const MAX_LINES_PER_FILE = 400;

// バイナリファイルかどうかをチェック
export function isBinaryFile(file: FileItem | ProjectFile): boolean {
  if ('isBufferArray' in file && file.isBufferArray) {
    return true;
  }
  
  // ファイル拡張子での判定
  const binaryExtensions = [
    '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.ico',
    '.pdf', '.zip', '.tar', '.gz', '.rar',
    '.exe', '.dll', '.so', '.dylib',
    '.mp3', '.mp4', '.avi', '.mov',
    '.woff', '.woff2', '.ttf', '.eot'
  ];
  
  const extension = file.name.toLowerCase().substring(file.name.lastIndexOf('.'));
  return binaryExtensions.includes(extension);
}

// ファイル内容の行数をチェック
export function isFileTooLarge(content: string): boolean {
  const lines = content.split('\n');
  return lines.length > MAX_LINES_PER_FILE;
}

// ファイル内容を切り詰める
export function truncateFileContent(content: string): string {
  const lines = content.split('\n');
  if (lines.length <= MAX_LINES_PER_FILE) {
    return content;
  }
  
  const truncatedLines = lines.slice(0, MAX_LINES_PER_FILE);
  return truncatedLines.join('\n') + '\n\n// ... ファイルが長すぎるため切り詰められました';
}

// FileItemをAIFileContextに変換
export function fileItemToAIContext(file: FileItem, selected: boolean = false): AIFileContext | null {
  //console.log('[fileItemToAIContext] Processing file:', file.path, 'type:', file.type, 'hasContent:', !!file.content, 'isBinary:', isBinaryFile(file));
  
  if (isBinaryFile(file) || file.type === 'folder') {
    return null;
  }
  
  return {
    path: file.path,
    name: file.name,
    content: file.content ? truncateFileContent(file.content) : '', // 空文字列でもOK
    selected
  };
}

// ProjectFileをAIFileContextに変換
export function projectFileToAIContext(file: ProjectFile, selected: boolean = false): AIFileContext | null {
  //console.log('[projectFileToAIContext] Processing file:', file.path, 'type:', file.type, 'hasContent:', !!file.content, 'isBinary:', isBinaryFile(file));
  
  if (isBinaryFile(file) || file.type === 'folder') {
    return null;
  }
  
  return {
    path: file.path,
    name: file.name,
    content: file.content ? truncateFileContent(file.content) : '', // 空文字列でもOK
    selected
  };
}

// フラットなファイルリストからAIコンテキストリストを作成
export function buildAIFileContextList(files: (FileItem | ProjectFile)[]): AIFileContext[] {
  // console.log('[buildAIFileContextList] Input files:', files.length, files.map(f => ({ 
  //   path: f.path, 
  //   type: f.type, 
  //   hasContent: !!f.content,
  //   contentLength: f.content?.length || 0,
  //   name: f.name
  // })));
  
  const contexts: AIFileContext[] = [];
  
  // FileItemの場合は再帰的にフラット化する
  function flattenFileItems(items: FileItem[]): FileItem[] {
    const result: FileItem[] = [];
    
    for (const item of items) {
      if (item.type === 'file') {
        result.push(item);
      }
      if (item.children && item.children.length > 0) {
        result.push(...flattenFileItems(item.children));
      }
    }
    
    return result;
  }
  
  // ファイルをフラット化
  const flatFiles: (FileItem | ProjectFile)[] = [];
  
  for (const file of files) {
    if ('children' in file) {
      // FileItem - 再帰的にフラット化
      flatFiles.push(...flattenFileItems([file]));
    } else {
      // ProjectFile
      flatFiles.push(file);
    }
  }
  
  // console.log('[buildAIFileContextList] Flattened files:', flatFiles.length, flatFiles.map(f => ({ 
  //   path: f.path, 
  //   type: f.type, 
  //   hasContent: !!f.content,
  //   contentLength: f.content?.length || 0,
  //   name: f.name
  // })));
  
  // フラット化されたファイルをAIコンテキストに変換
  for (const file of flatFiles) {
    let context: AIFileContext | null = null;
    
    if ('children' in file) {
      // FileItem
      context = fileItemToAIContext(file);
    } else {
      // ProjectFile
      context = projectFileToAIContext(file as ProjectFile);
    }
    
    if (context) {
      contexts.push(context);
      // console.log('[buildAIFileContextList] Added context:', context.path, 'contentLength:', context.content.length);
    } else {
      // console.log('[buildAIFileContextList] Skipped file:', file.path, 'type:', file.type, 'hasContent:', !!file.content, 'isBinary:', isBinaryFile(file), 'contentLength:', file.content?.length || 0);
    }
  }
  
  // console.log('[buildAIFileContextList] Final contexts:', contexts.length, contexts.map(c => c.path));
  return contexts;
}

// 選択されたファイルのコンテキストを取得
export function getSelectedFileContexts(contexts: AIFileContext[]): Array<{path: string, content: string}> {
  return contexts
    .filter(ctx => ctx.selected)
    .map(ctx => ({
      path: ctx.path,
      content: ctx.content
    }));
}

// ファイルパスから言語を推測
export function getLanguageFromPath(filePath: string): string {
  const extension = filePath.toLowerCase().substring(filePath.lastIndexOf('.') + 1);
  
  const languageMap: Record<string, string> = {
    'js': 'javascript',
    'jsx': 'javascript',
    'ts': 'typescript',
    'tsx': 'typescript',
    'py': 'python',
    'java': 'java',
    'c': 'c',
    'cpp': 'cpp',
    'cs': 'csharp',
    'php': 'php',
    'rb': 'ruby',
    'go': 'go',
    'rs': 'rust',
    'html': 'html',
    'css': 'css',
    'scss': 'scss',
    'json': 'json',
    'md': 'markdown',
    'yaml': 'yaml',
    'yml': 'yaml',
    'xml': 'xml',
    'sql': 'sql',
    'sh': 'bash',
    'bash': 'bash'
  };
  
  return languageMap[extension] || 'text';
}
