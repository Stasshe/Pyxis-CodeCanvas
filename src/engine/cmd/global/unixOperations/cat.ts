import { UnixCommandBase } from './base';

import { fileRepository } from '@/engine/core/fileRepository';
import type { ProjectFile } from '@/types';

/**
 * cat - ファイルの内容を表示
 *
 * 使用法:
 *   cat [file...]
 *
 * オプション:
 *   -n, --number  行番号を表示
 *
 * 動作:
 *   - 複数のファイルを連結して表示
 *   - ファイル名が指定されない場合は標準入力から読み込み（未実装）
 *   - ワイルドカード対応
 */
export class CatCommand extends UnixCommandBase {
  async execute(args: string[]): Promise<string> {
    const { options, positional } = this.parseOptions(args);

    if (positional.length === 0) {
      throw new Error('cat: no files specified\nUsage: cat [OPTION]... [FILE]...');
    }

    const showLineNumbers = options.has('-n') || options.has('--number');

    const results: string[] = [];

    // 各引数に対してワイルドカード展開
    for (const arg of positional) {
      const expanded = await this.expandPathPattern(arg);

      if (expanded.length === 0) {
        throw new Error(`cat: ${arg}: No such file or directory`);
      }

      for (const path of expanded) {
        try {
          const content = await this.readFile(path, showLineNumbers);
          results.push(content);
        } catch (error) {
          throw new Error(`cat: ${path}: ${(error as Error).message}`);
        }
      }
    }

    return results.join('');
  }

  /**
   * ファイルの内容を読み取る（IndexedDB の FileRepository を使用）
   */
  private async readFile(path: string, showLineNumbers: boolean): Promise<string> {
    const normalizedPath = this.normalizePath(path);

    // ディレクトリではないことを確認
    const isDir = await this.isDirectory(normalizedPath);
    if (isDir) {
      throw new Error('Is a directory');
    }

    // プロジェクト内の相対パスに変換して DB から取得
    const relative = this.getRelativePathFromProject(normalizedPath);
    // Bypass cached getFileFromDB to ensure we read the latest content from DB
    const file: ProjectFile | null = await fileRepository.getFileByPath(this.projectId, relative);

    if (!file) {
      throw new Error('No such file or directory');
    }

    // ファイルがバイナリとして保存されている場合は bufferContent を TextDecoder でデコード
    let contentStr = '';
    if (file.isBufferArray && file.bufferContent) {
      // UTF-8 デコードを想定（必要ならオプション対応を追加）
      const decoder = new TextDecoder('utf-8');
      contentStr = decoder.decode(file.bufferContent as ArrayBuffer);
    } else if (typeof file.content === 'string') {
      contentStr = file.content;
    } else {
      // その他は空文字列とする
      contentStr = '';
    }

    if (showLineNumbers) {
      const lines = contentStr.split('\n');
      // 行番号幅は行数に応じて算出（最低幅は6）
      const width = Math.max(6, String(lines.length).length + 1);
      return lines.map((line, idx) => `${(idx + 1).toString().padStart(width)} ${line}`).join('\n');
    }

    return contentStr;
  }
}
