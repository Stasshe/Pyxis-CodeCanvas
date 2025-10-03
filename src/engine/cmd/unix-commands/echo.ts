import { fileRepository } from '@/engine/core/fileRepository';
import { UnixCommandBase } from './base';

/**
 * echo - テキストを出力、またはファイルに書き込み
 * 
 * 使用法:
 *   echo [string...]
 *   echo [string...] > file   (上書き)
 *   echo [string...] >> file  (追記)
 * 
 * オプション:
 *   -n  末尾の改行を出力しない
 *   -e  バックスラッシュエスケープを解釈
 * 
 * 動作:
 *   - リダイレクト対応（>、>>）
 *   - 複数の引数をスペース区切りで連結
 */
export class EchoCommand extends UnixCommandBase {
  async execute(args: string[]): Promise<string> {
    if (args.length === 0) {
      return '';
    }

    const { options, positional } = this.parseOptions(args);
    
    const noNewline = options.has('-n');
    const interpretEscapes = options.has('-e');

    // リダイレクトのチェック
    let redirectType: 'none' | 'overwrite' | 'append' = 'none';
    let redirectFile: string | null = null;
    let textParts: string[] = [];

    for (let i = 0; i < positional.length; i++) {
      const arg = positional[i];
      
      if (arg === '>') {
        redirectType = 'overwrite';
        if (i + 1 < positional.length) {
          redirectFile = positional[i + 1];
          i++; // 次の引数をスキップ
        }
        break;
      } else if (arg === '>>') {
        redirectType = 'append';
        if (i + 1 < positional.length) {
          redirectFile = positional[i + 1];
          i++; // 次の引数をスキップ
        }
        break;
      } else {
        textParts.push(arg);
      }
    }

    let text = textParts.join(' ');

    // エスケープ解釈
    if (interpretEscapes) {
      text = this.interpretEscapes(text);
    }

    // 改行追加
    if (!noNewline && redirectType === 'none') {
      text += '\n';
    }

    // リダイレクト処理
    if (redirectType !== 'none' && redirectFile) {
      await this.writeToFile(redirectFile, text, redirectType === 'append');
      return '';
    }

    return text;
  }

  /**
   * ファイルに書き込み
   */
  private async writeToFile(fileName: string, text: string, append: boolean): Promise<void> {
    const normalizedPath = this.normalizePath(this.resolvePath(fileName));
    const relativePath = this.getRelativePathFromProject(normalizedPath);

    const existingFile = await this.getFileFromDB(relativePath);

    let content = text;
    if (append && existingFile) {
      content = (existingFile.content || '') + text;
    }

    if (existingFile) {
      await fileRepository.saveFile({
        ...existingFile,
        content,
        updatedAt: new Date(),
      });
    } else {
      // 親ディレクトリの存在チェック
      const parentPath = relativePath.substring(0, relativePath.lastIndexOf('/')) || '/';
      if (parentPath !== '/') {
        const parentFullPath = this.normalizePath(`${this.getProjectRoot()}${parentPath}`);
        const parentExists = await this.exists(parentFullPath);
        
        if (!parentExists) {
          throw new Error('No such file or directory');
        }
      }

      await fileRepository.createFile(
        this.projectId,
        relativePath,
        content,
        'file'
      );
    }
  }

  /**
   * エスケープシーケンスを解釈
   */
  private interpretEscapes(text: string): string {
    return text
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\\r/g, '\r')
      .replace(/\\b/g, '\b')
      .replace(/\\f/g, '\f')
      .replace(/\\v/g, '\v')
      .replace(/\\0/g, '\0')
      .replace(/\\\\/g, '\\');
  }
}
