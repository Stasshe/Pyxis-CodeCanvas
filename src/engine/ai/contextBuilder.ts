// ファイルコンテキスト構築ユーティリティ

import type { FileItem, ProjectFile, AIFileContext } from '@/types';

// ファイル内容の行数制限（400行）
const MAX_LINES_PER_FILE = 400;

// バイナリファイルかどうかをチェック
function isBinaryFile(file: FileItem | ProjectFile): boolean {
  return 'isBufferArray' in file && file.isBufferArray === true;
}

// ファイル内容の行数をチェック
function isFileTooLarge(content: string): boolean {
  const lines = content.split('\n');
  return lines.length > MAX_LINES_PER_FILE;
}

// ファイル内容を切り詰める
function truncateFileContent(content: string): string {
  const lines = content.split('\n');
  if (lines.length <= MAX_LINES_PER_FILE) {
    return content;
  }

  const truncatedLines = lines.slice(0, MAX_LINES_PER_FILE);
  return truncatedLines.join('\n') + '\n\n// ... ファイルが長すぎるため切り詰められました';
}

// FileItemをAIFileContextに変換
function fileItemToAIContext(file: FileItem, selected: boolean = false): AIFileContext | null {
  //console.log('[fileItemToAIContext] Processing file:', file.path, 'type:', file.type, 'hasContent:', !!file.content, 'isBinary:', isBinaryFile(file));

  if (isBinaryFile(file) || file.type === 'folder') {
    return null;
  }

  return {
    path: file.path,
    name: file.name,
    content: file.content ? truncateFileContent(file.content) : '', // 空文字列でもOK
    selected,
  };
}

// ProjectFileをAIFileContextに変換
function projectFileToAIContext(
  file: ProjectFile,
  selected: boolean = false
): AIFileContext | null {
  if (isBinaryFile(file) || file.type === 'folder') {
    return null;
  }

  return {
    path: file.path,
    name: file.name,
    content: file.content ? truncateFileContent(file.content) : '', // 空文字列でもOK
    selected,
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
export function getSelectedFileContexts(
  contexts: AIFileContext[]
): Array<{ path: string; content: string }> {
  return contexts
    .filter(ctx => ctx.selected)
    .map(ctx => ({
      path: ctx.path,
      content: ctx.content,
    }));
}
