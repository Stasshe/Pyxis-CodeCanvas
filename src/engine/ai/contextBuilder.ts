// ファイルコンテキスト構築ユーティリティ

import type { AIFileContext, FileItem } from '@/types';

// ファイル内容の行数制限（400行）
const MAX_LINES_PER_FILE = 400;

// バイナリファイルかどうかをチェック
function isBinaryFile(file: FileItem): boolean {
  return file.isBufferArray === true;
}

// ファイル内容を400行に制限する
function truncateFileContent(content: string): string {
  const lines = content.split('\n');
  if (lines.length <= MAX_LINES_PER_FILE) {
    return content;
  }

  const truncatedLines = lines.slice(0, MAX_LINES_PER_FILE);
  return `${truncatedLines.join('\n')}\n\n// ... ファイルが長すぎるため切り詰められました`;
}

// FileItemをAIFileContextに変換
function fileItemToAIContext(file: FileItem, selected = false): AIFileContext | null {
  //console.log('[fileItemToAIContext] Processing file:', file.path, 'type:', file.type, 'hasContent:', !!file.content, 'isBinary:', isBinaryFile(file));

  if (isBinaryFile(file) || file.type === 'folder') {
    return null;
  }

  return {
    path: file.path,
    name: file.name,
    content: truncateFileContent(file.content ?? ''),
    selected,
  };
}

// フラットなファイルリストからAIコンテキストリストを作成
export function buildAIFileContextList(files: FileItem[]): AIFileContext[] {
  const contexts: AIFileContext[] = [];

  function visit(items: FileItem[]): void {
    for (const file of items) {
      if (file.type === 'file') {
        const context = fileItemToAIContext(file);
        if (context) contexts.push(context);
      }
      if (file.children) visit(file.children);
    }
  }

  visit(files);
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

// Custom instructions file path
export const CUSTOM_INSTRUCTIONS_PATH = '.pyxis/pyxis-instructions.md';

/**
 * Extract custom instructions from file contexts if .pyxis/pyxis-instructions.md exists
 */
export function getCustomInstructions(contexts: AIFileContext[]): string | undefined {
  const instructionsFile = contexts.find(
    ctx =>
      ctx.path === CUSTOM_INSTRUCTIONS_PATH ||
      ctx.path.endsWith('/.pyxis/pyxis-instructions.md') ||
      ctx.path === 'pyxis-instructions.md'
  );

  if (instructionsFile?.content) {
    return instructionsFile.content;
  }

  return undefined;
}

/**
 * Find custom instructions from a flat file list
 */
export function findCustomInstructionsFromFiles(
  files: Array<{ path: string; content?: string }>
): string | undefined {
  const instructionsFile = files.find(
    f =>
      f.path === CUSTOM_INSTRUCTIONS_PATH ||
      f.path.endsWith('/.pyxis/pyxis-instructions.md') ||
      f.path.endsWith('/pyxis-instructions.md')
  );

  if (instructionsFile?.content) {
    return instructionsFile.content;
  }

  return undefined;
}
