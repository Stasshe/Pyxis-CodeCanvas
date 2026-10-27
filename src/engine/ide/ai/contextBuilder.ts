// ファイルコンテキスト構築ユーティリティ

import { readFileContent } from '@/engine/core/fileContent';
import type { FsChangeEvent } from '@/engine/core/fs/index';
import { isPathWithin } from '@/engine/core/fs/index';
import type { AIFileContext, FileItem } from '@/types/index';

export function resolveAIFileSelection(
  persistedPaths: string[],
  pendingPaths: string[] | null
): string[] {
  if (!pendingPaths) return persistedPaths;
  if (
    pendingPaths.length === persistedPaths.length &&
    pendingPaths.every((path, index) => path === persistedPaths[index])
  ) {
    return persistedPaths;
  }
  return pendingPaths;
}

export function updateSelectedFilePaths(
  selectedPaths: string[],
  event: FsChangeEvent,
  rootPath: string
): string[] {
  if (event.type === 'delete') {
    if (!isPathWithin(event.path, rootPath)) return selectedPaths;
    return selectedPaths.filter(path => !isPathWithin(path, event.path));
  }
  const oldPath = event.oldPath;
  if (event.type !== 'rename' || !oldPath) return selectedPaths;

  return selectedPaths.flatMap(path => {
    if (!isPathWithin(path, oldPath)) return [path];
    if (!isPathWithin(event.path, rootPath)) return [];
    return [event.path + path.slice(oldPath.length)];
  });
}

export function reconcileAIFileContextsForPathChange(
  contexts: AIFileContext[],
  selectedPaths: string[],
  event: FsChangeEvent,
  rootPath: string
): { contexts: AIFileContext[]; selectedPaths: string[] } {
  const nextSelectedPaths = updateSelectedFilePaths(selectedPaths, event, rootPath);
  const selected = new Set(nextSelectedPaths);
  const nextContexts = contexts
    .flatMap(context => {
      if (event.type === 'delete') {
        return isPathWithin(context.path, event.path) ? [] : [context];
      }
      if (event.type !== 'rename' || !event.oldPath) return [context];
      if (!isPathWithin(context.path, event.oldPath)) {
        if (isPathWithin(context.path, event.path)) return [];
        return [context];
      }
      if (!isPathWithin(event.path, rootPath)) return [];
      const path = event.path + context.path.slice(event.oldPath.length);
      return [{ ...context, path, name: path.split('/').pop() || path }];
    })
    .map(context => ({ ...context, selected: selected.has(context.path) }));

  return { contexts: nextContexts, selectedPaths: nextSelectedPaths };
}

// バイナリファイルかどうかをチェック
function isBinaryFile(file: FileItem): boolean {
  return file.isBufferArray === true;
}

// FileItemをAIFileContextに変換
function fileItemToAIContext(file: FileItem, selected = false): AIFileContext | null {
  if (isBinaryFile(file) || file.type === 'folder') {
    return null;
  }

  return {
    path: file.path,
    name: file.name,
    content: file.content ?? '',
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

export async function loadAIFileContexts(
  files: FileItem[],
  selectedByPath: ReadonlyMap<string, boolean>
): Promise<AIFileContext[]> {
  async function loadFile(file: FileItem): Promise<FileItem> {
    const name = file.path.split('/').pop() || file.path;
    if (file.type !== 'file') {
      const children = await Promise.all((file.children ?? []).map(loadFile));
      return { ...file, name, children };
    }
    const loaded = await readFileContent(file.path);
    if (loaded.kind === 'binary') return { ...file, name, isBufferArray: true };
    return { ...file, name, content: loaded.content, isBufferArray: false };
  }

  const loadedFiles = await Promise.all(files.map(loadFile));

  return buildAIFileContextList(loadedFiles).map(context => ({
    ...context,
    selected: selectedByPath.get(context.path) ?? false,
  }));
}

export async function loadAIFileContextSnapshot(
  files: FileItem[],
  getRevision: (path: string) => number
): Promise<AIFileContext[]> {
  const revisions = new Map(files.map(file => [file.path, getRevision(file.path)]));
  const results = await Promise.all(
    files.map(async file => {
      try {
        return await loadAIFileContexts([file], new Map());
      } catch (error) {
        if (getRevision(file.path) !== revisions.get(file.path)) return [];
        throw error;
      }
    })
  );
  return results
    .flat()
    .filter(context => getRevision(context.path) === revisions.get(context.path));
}

export async function loadAIFileContext(path: string): Promise<AIFileContext> {
  const loaded = await readFileContent(path);
  if (loaded.kind === 'binary') {
    throw new Error(`Cannot add binary file to AI context: ${path}`);
  }

  return {
    path,
    name: path.split('/').pop() || path,
    content: loaded.content,
    selected: true,
  };
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
