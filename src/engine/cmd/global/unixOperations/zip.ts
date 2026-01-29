import { fileRepository } from '@/engine/core/fileRepository';
import JSZip from 'jszip';
import { UnixCommandBase } from './base';
import { parseArgs } from '../../lib';

/**
 * zip - POSIX準拠（Info-ZIP互換）のZIPアーカイブ作成
 * 
 * Usage:
 *   zip archive.zip file1 file2 ...  # ZIPを作成
 *   zip -r archive.zip dir/          # ディレクトリを再帰的に追加
 *   zip archive file1 file2          # .zip拡張子を自動付与
 * 
 * Options:
 *   -r, --recurse-paths  ディレクトリを再帰的に追加
 *   -q, --quiet          静かに実行
 *   -v, --verbose        詳細表示
 *   -u, --update         既存アーカイブを更新
 *   -f, --freshen        既存エントリのみ更新
 *   -d, --delete         アーカイブからエントリを削除
 *   -h, --help           ヘルプ表示
 * 
 * Note: 
 *   - アーカイブ名に.zipがなければ自動付与
 *   - POSIXのzipは'-'オプションなしの最初の引数がアーカイブ名
 */
export class ZipCommand extends UnixCommandBase {
  async execute(args: string[] = []): Promise<string> {
    // オプション解析
    const { flags, positional } = parseArgs(args);

    // ヘルプ
    if (flags.has('-h') || flags.has('--help') || positional.length === 0) {
      return this.showHelp();
    }

    // オプション判定
    const recursive = flags.has('-r') || flags.has('--recurse-paths');
    const quiet = flags.has('-q') || flags.has('--quiet');
    const verbose = flags.has('-v') || flags.has('--verbose');
    const update = flags.has('-u') || flags.has('--update');
    const freshen = flags.has('-f') || flags.has('--freshen');
    const deleteMode = flags.has('-d') || flags.has('--delete');

    // アーカイブ名取得（最初の位置引数）
    let archiveName = positional[0];
    const files = positional.slice(1);

    // .zip拡張子の自動付与
    if (!archiveName.endsWith('.zip')) {
      archiveName = `${archiveName}.zip`;
    }

    if (deleteMode) {
      return await this.deleteFromArchive(archiveName, files, quiet);
    }

    if (update || freshen) {
      return await this.updateArchive(archiveName, files, freshen, recursive, quiet, verbose);
    }

    return await this.createArchive(archiveName, files, recursive, quiet, verbose);
  }

  /**
   * ZIPアーカイブ作成
   */
  private async createArchive(
    archiveName: string,
    files: string[],
    recursive: boolean,
    quiet: boolean,
    verbose: boolean
  ): Promise<string> {
    if (files.length === 0) {
      throw new Error('zip: nothing to do');
    }

    // 正規化したアーカイブパス（AppPath形式）を取得してアーカイブ自身を除外できるようにする
    const archiveResolved = this.normalizePath(this.resolvePath(archiveName));
    const archiveRel = this.getRelativePathFromProject(archiveResolved);

    if (!quiet && this.terminalUI) {
      await this.terminalUI.spinner.start('Creating zip archive...');
    }

    try {
      const zip = new JSZip();
      const added: string[] = [];

      let addedCount = 0;

      for (const fileName of files) {
        const resolved = this.normalizePath(this.resolvePath(fileName));
        const rel = this.getRelativePathFromProject(resolved);

        // アーカイブ自身は含めない
        if (rel === archiveRel) {
          if (verbose) console.log(`Skipping archive file ${fileName}`);
          continue;
        }

        const file = await this.getFileFromDB(rel);

        if (!file) {
          throw new Error(`${fileName}: No such file or directory`);
        }

        // アーカイブ内のパスは AppPath から先頭スラッシュを除去
        const entryName = rel.replace(/^\/+/, '');

        if (file.type === 'folder') {
          if (recursive) {
            // ディレクトリとその配下を再帰的に追加
            await this.addDirectoryRecursive(zip, rel, entryName, added, verbose);
          } else {
            // ディレクトリエントリのみ
            zip.folder(entryName);
            added.push(`${entryName}/`);
          }
        } else {
          // ファイル追加
          if (file.isBufferArray && file.bufferContent) {
            zip.file(entryName, file.bufferContent);
          } else {
            zip.file(entryName, file.content || '');
          }
          added.push(entryName);
        }

        addedCount++;
      }

      if (addedCount === 0) {
        throw new Error('zip: nothing to do');
      }

      // ZIP生成
      const arrayBuffer = await zip.generateAsync({
        type: 'arraybuffer',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 },
      });

      // 保存
      await fileRepository.createFile(
        this.projectId,
        archiveName,
        '',
        'file',
        true,
        arrayBuffer as ArrayBuffer
      );

      if (!quiet && this.terminalUI) {
        await this.terminalUI.spinner.success('Archive created successfully');
      }

      if (verbose) {
        return added.map(name => `  adding: ${name}`).join('\n');
      }

      if (quiet) {
        return '';
      }

      return `  adding: ${files.join(', ')}\ncreated ${archiveName}`;
    } catch (err: any) {
      if (!quiet && this.terminalUI) {
        await this.terminalUI.spinner.error(`Archive failed: ${err?.message || String(err)}`);
      }
      throw err;
    }
  }

  /**
   * ディレクトリを再帰的に追加
   */
  private async addDirectoryRecursive(
    zip: JSZip,
    dirRel: string,
    entryPrefix: string,
    added: string[],
    verbose: boolean
  ): Promise<void> {
    // ディレクトリエントリ
    zip.folder(entryPrefix);
    added.push(`${entryPrefix}/`);

    // 配下のファイル/フォルダを取得
    const prefix = dirRel === '/' ? '' : `${dirRel}/`;
    const children = await this.cachedGetFilesByPrefix(prefix);

    for (const child of children) {
      if (!child.path.startsWith(prefix) || child.path === dirRel) continue;

      const relativePath = child.path.substring(prefix.length);
      if (relativePath.includes('/')) continue; // 直下のみ

      const childEntryName = `${entryPrefix}/${relativePath}`;

      if (child.type === 'folder') {
        // 再帰
        await this.addDirectoryRecursive(zip, child.path, childEntryName, added, verbose);
      } else {
        // ファイル追加
        if (child.isBufferArray && child.bufferContent) {
          zip.file(childEntryName, child.bufferContent);
        } else {
          zip.file(childEntryName, child.content || '');
        }
        added.push(childEntryName);
      }
    }
  }

  /**
   * 既存アーカイブを更新
   */
  private async updateArchive(
    archiveName: string,
    files: string[],
    freshenOnly: boolean,
    recursive: boolean,
    quiet: boolean,
    verbose: boolean
  ): Promise<string> {
    // 既存アーカイブを読み込み
    const resolved = this.normalizePath(this.resolvePath(archiveName));
    const rel = this.getRelativePathFromProject(resolved);
    const existingFile = await this.getFileFromDB(rel);

    let zip: JSZip;
    if (existingFile && existingFile.bufferContent) {
      zip = await JSZip.loadAsync(existingFile.bufferContent);
    } else if (freshenOnly) {
      throw new Error(`${archiveName}: No such file or directory`);
    } else {
      // -u（update）モードで存在しなければ新規作成
      zip = new JSZip();
    }

    const updated: string[] = [];

    for (const fileName of files) {
      const resolved = this.normalizePath(this.resolvePath(fileName));
      const rel = this.getRelativePathFromProject(resolved);
      const file = await this.getFileFromDB(rel);

      if (!file) {
        if (!quiet) {
          console.warn(`zip warning: ${fileName} not found`);
        }
        continue;
      }

      const entryName = fileName.replace(/^\/+/, '');

      // -f（freshen）: 既存エントリのみ更新
      if (freshenOnly && !zip.file(entryName)) {
        continue;
      }

      if (file.type === 'folder') {
        if (recursive) {
          await this.addDirectoryRecursive(zip, rel, entryName, updated, verbose);
        } else {
          zip.folder(entryName);
          updated.push(`${entryName}/`);
        }
      } else {
        if (file.isBufferArray && file.bufferContent) {
          zip.file(entryName, file.bufferContent);
        } else {
          zip.file(entryName, file.content || '');
        }
        updated.push(entryName);
      }
    }

    // ZIP生成
    const arrayBuffer = await zip.generateAsync({
      type: 'arraybuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    });

    // 保存
    await fileRepository.createFile(
      this.projectId,
      archiveName,
      '',
      'file',
      true,
      arrayBuffer as ArrayBuffer
    );

    if (verbose) {
      return updated.map(name => `  updating: ${name}`).join('\n');
    }

    return quiet ? '' : `updated ${archiveName}`;
  }

  /**
   * アーカイブからエントリを削除
   */
  private async deleteFromArchive(
    archiveName: string,
    files: string[],
    quiet: boolean
  ): Promise<string> {
    const resolved = this.normalizePath(this.resolvePath(archiveName));
    const rel = this.getRelativePathFromProject(resolved);
    const existingFile = await this.getFileFromDB(rel);

    if (!existingFile || !existingFile.bufferContent) {
      throw new Error(`${archiveName}: No such file or directory`);
    }

    const zip = await JSZip.loadAsync(existingFile.bufferContent);
    const deleted: string[] = [];

    for (const fileName of files) {
      const entryName = fileName.replace(/^\/+/, '');
      zip.remove(entryName);
      deleted.push(entryName);
    }

    // ZIP生成
    const arrayBuffer = await zip.generateAsync({
      type: 'arraybuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    });

    // 保存
    await fileRepository.createFile(
      this.projectId,
      archiveName,
      '',
      'file',
      true,
      arrayBuffer as ArrayBuffer
    );

    if (quiet) {
      return '';
    }

    return deleted.length > 0
      ? `deleted ${deleted.length} ${deleted.length === 1 ? 'entry' : 'entries'} from ${archiveName}`
      : 'nothing deleted';
  }

  private showHelp(): string {
    return `Usage: zip [OPTIONS] archive[.zip] file1 file2 ...

Create or update a ZIP archive.

Options:
  -r, --recurse-paths  travel the directory structure recursively
  -q, --quiet          quiet operation
  -v, --verbose        verbose operation
  -u, --update         update existing entries and add new files
  -f, --freshen        freshen existing entries (no new files)
  -d, --delete         delete entries from archive
  -h, --help           display this help and exit

Examples:
  zip archive file1 file2       # Create archive.zip
  zip -r backup /src            # Recursively zip directory
  zip -u archive newfile        # Add/update files in archive
  zip -d archive badfile        # Delete file from archive

Notes:
  - .zip extension is automatically added if not present
  - First argument (without -) is the archive name`;
  }
}