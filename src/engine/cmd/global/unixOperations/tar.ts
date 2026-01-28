import { fileRepository } from '@/engine/core/fileRepository';
import * as tar from 'tar-stream';
import { UnixCommandBase } from './base';
import { parseArgs } from '../../lib';

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

    // 正規化したアーカイブパス（AppPath形式）を取得してアーカイブ自身を除外できるようにする
    const archiveResolved = this.normalizePath(this.resolvePath(archiveName));
    const archiveRel = this.getRelativePathFromProject(archiveResolved);

    if (this.terminalUI) {
      await this.terminalUI.spinner.start('Creating tar archive...');
    }

    try {
      const pack = tar.pack();
      const chunks: Uint8Array[] = [];

      let addedCount = 0;

      // ファイルを順次追加
      for (const fileName of files) {
        const resolved = this.normalizePath(this.resolvePath(fileName));
        const rel = this.getRelativePathFromProject(resolved);

        // アーカイブ自身は含めない
        if (rel === archiveRel) {
          // skip archive file
          if (verbose) console.log(`Skipping archive file ${fileName}`);
          continue;
        }

        const file = await this.getFileFromDB(rel);

        if (!file) {
          throw new Error(`tar: ${fileName}: Cannot stat: No such file or directory`);
        }

        // アーカイブ内のパス名は AppPath から先頭スラッシュを除去して格納
        const entryName = rel.replace(/^\/+/, '');

        if (file.type === 'folder') {
          // ディレクトリエントリ（末尾にスラッシュ）
          pack.entry({ name: `${entryName}/`, type: 'directory' }, '', () => {});
          if (verbose) {
            console.log(`${entryName}/`);
          }

          // TODO: ディレクトリ配下のファイルを再帰的に追加（-rオプション実装時）
        } else {
          // ファイルエントリ
          const contentBuf = file.bufferContent
            ? Buffer.from(file.bufferContent)
            : Buffer.from(file.content || '', 'utf8');

          pack.entry(
            {
              name: entryName,
              type: 'file',
              size: contentBuf.length,
            },
            contentBuf,
            () => {}
          );

          if (verbose) {
            console.log(entryName);
          }
        }

        addedCount++;
      }

      if (addedCount === 0) {
        throw new Error('tar: Cowardly refusing to create an empty archive');
      }

      pack.finalize();

      // ストリームからデータ収集
      await new Promise<void>((resolve, reject) => {
        pack.on('data', (chunk: any) => chunks.push(Buffer.from(chunk)));
        pack.on('end', () => resolve());
        pack.on('error', (err: any) => reject(err));
      });

      const tarBuffer = Buffer.concat(chunks);

      // アーカイブを保存
      await fileRepository.createFile(
        this.projectId,
        archiveName,
        '',
        'file',
        true,
        tarBuffer.buffer as ArrayBuffer
      );

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
    const resolved = this.normalizePath(this.resolvePath(archiveName));
    const rel = this.getRelativePathFromProject(resolved);
    const file = await this.getFileFromDB(rel);

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
      const resolved = this.normalizePath(this.resolvePath(archiveName));
      const rel = this.getRelativePathFromProject(resolved);
      const file = await this.getFileFromDB(rel);

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

        const chunks: Uint8Array[] = [];
        stream.on('data', (chunk: any) => chunks.push(Buffer.from(chunk)));
        stream.on('end', () => {
          const fileBuf = Buffer.concat(chunks);
          entries.push({
            path: entryPath,
            content: '',
            type: 'file',
            isBufferArray: true,
            bufferContent: fileBuf.buffer as ArrayBuffer,
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