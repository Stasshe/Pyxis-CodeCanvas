// src/engine/cmd/global/unixOperations/tar.ts

import { fileRepository } from '@/engine/core/fileRepository';
import * as tar from 'tar-stream';
import { UnixCommandBase } from './base';
import { parseArgs } from '../../lib';
import { fsPathToAppPath, resolvePath as pathResolve } from '@/engine/core/pathUtils';

/**
 * tar - POSIX準拠のtarアーカイブ作成/一覧/展開
 * 
 * Usage:
 *   tar -c -f archive.tar file1 file2 ...  # 作成
 *   tar -t -f archive.tar                  # 一覧表示
 *   tar -x -f archive.tar                  # 展開
 *   tar -czf archive.tar.gz file1 ...      # gzip圧縮付き作成（-zは将来対応）
 * 
 * Options:
 *   -c, --create    アーカイブを作成
 *   -x, --extract   アーカイブを展開
 *   -t, --list      アーカイブの内容を一覧表示
 *   -f FILE         アーカイブファイル名を指定（必須）
 *   -v, --verbose   詳細表示
 *   -h, --help      ヘルプ表示
 */
export class TarCommand extends UnixCommandBase {
  async execute(args: string[] = []): Promise<string> {
    // オプション解析
    const { flags, values, positional } = parseArgs(args, ['-f', '--file']);

    // ヘルプ
    if (flags.has('-h') || flags.has('--help')) {
      return this.showHelp();
    }

    // モード判定
    const create = flags.has('-c') || flags.has('--create');
    const extract = flags.has('-x') || flags.has('--extract');
    const list = flags.has('-t') || flags.has('--list');
    const verbose = flags.has('-v') || flags.has('--verbose');

    // モードは1つだけ
    const modeCount = [create, extract, list].filter(Boolean).length;
    if (modeCount === 0) {
      throw new Error('tar: You must specify one of -c, -t, or -x');
    }
    if (modeCount > 1) {
      throw new Error('tar: Cannot specify multiple modes (-c/-t/-x)');
    }

    // アーカイブファイル名取得（-f必須）
    const archiveName = values.get('-f') || values.get('--file');
    if (!archiveName) {
      throw new Error('tar: Option -f is required');
    }

    if (create) {
      return await this.createArchive(archiveName, positional, verbose);
    } else if (list) {
      return await this.listArchive(archiveName, verbose);
    } else if (extract) {
      return await this.extractArchive(archiveName, verbose);
    }

    return '';
  }

  /**
   * アーカイブ作成
   */
  private async createArchive(
    archiveName: string,
    files: string[],
    verbose: boolean
  ): Promise<string> {
    if (files.length === 0) {
      throw new Error('tar: Cowardly refusing to create an empty archive');
    }

    if (this.terminalUI) {
      await this.terminalUI.spinner.start('Creating tar archive...');
    }

    try {
      const pack = tar.pack();
      const chunks: Buffer[] = [];

      // ストリームからデータ収集を開始
      pack.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
      });

      const packFinished = new Promise<void>((resolve, reject) => {
        pack.on('end', () => resolve());
        pack.on('error', (err: Error) => reject(err));
      });

      let addedCount = 0;

      // ファイルを順次追加
      const baseApp = fsPathToAppPath(this.currentDir, this.projectName);

      for (const fileName of files) {
        // パス解決: AppPath ベースから解決
        const fileAppPath = pathResolve(baseApp, fileName);

        const file = await this.getFileFromDB(fileAppPath);

        if (!file) {
          throw new Error(`tar: ${fileName}: Cannot stat: No such file or directory`);
        }

        // アーカイブ内のパス名は AppPath から先頭スラッシュを除去して格納
        const entryName = fileAppPath.replace(/^\/+/, '');

        if (file.type === 'folder') {
          // フォルダの場合は再帰的に中身を取得して追加する
          const folderPrefix = fileAppPath; // AppPath 形式
          const children = await fileRepository.getFilesByPrefix(this.projectId, folderPrefix);

          // 先にディレクトリエントリ自身を追加
          await new Promise<void>((resolve, reject) => {
            pack.entry({ name: `${entryName}/`, type: 'directory' }, '', (err) => {
              if (err) reject(err);
              else resolve();
            });
          });

          for (const child of children) {
            const childEntryName = child.path.replace(/^\\+/, '');

            if (child.type === 'folder') {
              await new Promise<void>((resolve, reject) => {
                pack.entry({ name: `${childEntryName}/`, type: 'directory' }, '', err => {
                  if (err) reject(err);
                  else resolve();
                });
              });
              if (verbose) console.log(`${childEntryName}/`);
            } else {
              const contentBuf = child.bufferContent
                ? Buffer.from(child.bufferContent as ArrayBuffer)
                : Buffer.from(child.content || '', 'utf8');

              await new Promise<void>((resolve, reject) => {
                pack.entry(
                  {
                    name: childEntryName,
                    type: 'file',
                    size: contentBuf.length,
                  },
                  contentBuf,
                  err => {
                    if (err) reject(err);
                    else resolve();
                  }
                );
              });

              if (verbose) console.log(childEntryName);
            }
            addedCount++;
          }
        } else {
          // ファイルエントリ
          const contentBuf = file.bufferContent
            ? Buffer.from(file.bufferContent)
            : Buffer.from(file.content || '', 'utf8');

          await new Promise<void>((resolve, reject) => {
            pack.entry(
              {
                name: entryName,
                type: 'file',
                size: contentBuf.length,
              },
              contentBuf,
              (err) => {
                if (err) reject(err);
                else resolve();
              }
            );
          });

          if (verbose) {
            console.log(entryName);
          }
        }

        addedCount++;
      }

      if (addedCount === 0) {
        throw new Error('tar: Cowardly refusing to create an empty archive');
      }

      // アーカイブを確定
      pack.finalize();

      // ストリーム終了を待つ
      await packFinished;

      // バッファを結合
      const tarBuffer = Buffer.concat(chunks);

      console.log(`[TarCommand] Created tar buffer: ${tarBuffer.length} bytes`);
      console.log(`[TarCommand] First 100 bytes:`, tarBuffer.slice(0, 100));

      // ArrayBuffer を正確な長さで作成
      const archiveArrayBuffer = tarBuffer.buffer.slice(
        tarBuffer.byteOffset,
        tarBuffer.byteOffset + tarBuffer.length
      );

      console.log(`[TarCommand] ArrayBuffer size: ${archiveArrayBuffer.byteLength} bytes`);

      // アーカイブを保存（AppPath形式で）
      const archiveAppPath = pathResolve(baseApp, archiveName);

      console.log(`[TarCommand] Saving to: ${archiveAppPath}`);

      await fileRepository.createFile(this.projectId, archiveAppPath, '', 'file', true, archiveArrayBuffer);

      if (this.terminalUI) {
        await this.terminalUI.spinner.success('Archive created successfully');
      }

      return verbose ? '' : `Created ${archiveName}`;
    } catch (err: any) {
      if (this.terminalUI) {
        await this.terminalUI.spinner.error(`Archive failed: ${err?.message || String(err)}`);
      }
      throw err;
    }
  }

  /**
   * アーカイブ一覧表示
   */
  private async listArchive(archiveName: string, verbose: boolean): Promise<string> {
    const baseApp = fsPathToAppPath(this.currentDir, this.projectName);
    const archiveAppPath = pathResolve(baseApp, archiveName);
    const file = await this.getFileFromDB(archiveAppPath);

    if (!file) {
      throw new Error(`tar: ${archiveName}: Cannot open: No such file or directory`);
    }

    const buf = file.bufferContent
      ? file.bufferContent
      : new TextEncoder().encode(file.content || '').buffer;

    const extract = tar.extract();
    const entries: string[] = [];

    extract.on('entry', (header, stream, next) => {
      if (verbose) {
        // -v: 詳細表示（権限、サイズ、日付、名前）
        const mode = header.mode ? header.mode.toString(8).padStart(4, '0') : '0644';
        const size = (header.size || 0).toString().padStart(8);
        const date = header.mtime ? new Date(header.mtime).toISOString().split('T')[0] : '1970-01-01';
        entries.push(`-rw-r--r-- 0/0 ${size} ${date} ${header.name}`);
      } else {
        entries.push(header.name);
      }

      stream.on('end', () => next());
      stream.resume();
    });

    await new Promise<void>((resolve, reject) => {
      extract.on('finish', () => resolve());
      extract.on('error', (err: any) => reject(err));
      extract.end(Buffer.from(buf));
    });

    return entries.join('\n');
  }

  /**
   * アーカイブ展開
   */
  private async extractArchive(archiveName: string, verbose: boolean): Promise<string> {
    if (this.terminalUI) {
      await this.terminalUI.spinner.start('Extracting tar archive...');
    }

    try {
      const baseApp = fsPathToAppPath(this.currentDir, this.projectName);
      const archiveAppPath = pathResolve(baseApp, archiveName);
      const file = await this.getFileFromDB(archiveAppPath);

      if (!file) {
        throw new Error(`tar: ${archiveName}: Cannot open: No such file or directory`);
      }

      const buf = file.bufferContent
        ? file.bufferContent
        : new TextEncoder().encode(file.content || '').buffer;

      const extract = tar.extract();
      type TarEntry = {
        path: string;
        content: string;
        type: 'file' | 'folder';
        isBufferArray?: boolean;
        bufferContent?: ArrayBuffer;
      };
      const entries: TarEntry[] = [];
      const extractedNames: string[] = [];

      extract.on('entry', (header, stream, next) => {
        // パス名を正規化（先頭にスラッシュを付与）
        const name = header.name.replace(/\/$/, '');
        const entryPath = name.startsWith('/') ? name : `/${name}`;

        if (header.type === 'directory' || header.name.endsWith('/')) {
          entries.push({ path: entryPath, content: '', type: 'folder' });
          extractedNames.push(`${header.name}`);
          stream.resume();
          next();
          return;
        }

        const chunks: Buffer[] = [];
        stream.on('data', (chunk: Buffer) => chunks.push(chunk));
        stream.on('end', () => {
          const fileBuf = Buffer.concat(chunks);
          // 正確な長さの ArrayBuffer を作る
          const fileArrayBuffer = fileBuf.buffer.slice(
            fileBuf.byteOffset,
            fileBuf.byteOffset + fileBuf.length
          );

          entries.push({
            path: entryPath,
            content: '',
            type: 'file',
            isBufferArray: true,
            bufferContent: fileArrayBuffer,
          });
          extractedNames.push(header.name);
          next();
        });
      });

      await new Promise<void>((resolve, reject) => {
        extract.on('finish', () => resolve());
        extract.on('error', (err: any) => reject(err));
        extract.end(Buffer.from(buf));
      });

      // 一括書き込み
      if (entries.length > 0) {
        await fileRepository.createFilesBulk(this.projectId, entries);
      }

      if (this.terminalUI) {
        await this.terminalUI.spinner.success('Archive extracted successfully');
      }

      if (verbose) {
        return extractedNames.join('\n');
      }

      return `Extracted ${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}`;
    } catch (err: any) {
      if (this.terminalUI) {
        await this.terminalUI.spinner.error(`Extract failed: ${err?.message || String(err)}`);
      }
      throw err;
    }
  }

  private showHelp(): string {
    return `Usage: tar [OPTION]... [FILE]...

Main operation mode:
  -c, --create    create a new archive
  -x, --extract   extract files from an archive
  -t, --list      list the contents of an archive

Required:
  -f, --file=FILE use archive file FILE

Other options:
  -v, --verbose   verbosely list files processed
  -h, --help      display this help and exit

Examples:
  tar -cf archive.tar file1 file2    # Create archive
  tar -tf archive.tar                # List contents
  tar -xf archive.tar                # Extract archive
  tar -cvf archive.tar dir/          # Create with verbose output`;
  }
}