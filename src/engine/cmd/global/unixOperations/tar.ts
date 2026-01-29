// src/engine/cmd/global/unixOperations/tar.ts

import { fileRepository } from '@/engine/core/fileRepository';
import { UnixCommandBase } from './base';
import { parseArgs } from '../../lib';
import { fsPathToAppPath, resolvePath as pathResolve } from '@/engine/core/pathUtils';

// TextEncoder/TextDecoder: prefer browser globals, fall back to Node's `util` on server.
// This avoids bundling an undefined TextEncoder when running client-side.
const TextEncoder = (typeof globalThis !== 'undefined' && (globalThis as any).TextEncoder)
  ? (globalThis as any).TextEncoder
  : /* eslint-disable-next-line @typescript-eslint/no-var-requires */ require('util').TextEncoder;
const TextDecoder = (typeof globalThis !== 'undefined' && (globalThis as any).TextDecoder)
  ? (globalThis as any).TextDecoder
  : /* eslint-disable-next-line @typescript-eslint/no-var-requires */ require('util').TextDecoder;

/**
 * tar - POSIX準拠のtarアーカイブ作成/一覧/展開（ネイティブ実装）
 */
export class TarCommand extends UnixCommandBase {
  async execute(args: string[] = []): Promise<string> {
    const { flags, values, positional } = parseArgs(args, ['-f', '--file']);

    if (flags.has('-h') || flags.has('--help')) {
      return this.showHelp();
    }

    const create = flags.has('-c') || flags.has('--create');
    const extract = flags.has('-x') || flags.has('--extract');
    const list = flags.has('-t') || flags.has('--list');
    const verbose = flags.has('-v') || flags.has('--verbose');

    const modeCount = [create, extract, list].filter(Boolean).length;
    if (modeCount === 0) {
      throw new Error('tar: You must specify one of -c, -t, or -x');
    }
    if (modeCount > 1) {
      throw new Error('tar: Cannot specify multiple modes (-c/-t/-x)');
    }

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
   * tarヘッダーを生成（POSIX ustar形式、512バイト）
   */
  private createTarHeader(name: string, size: number, isDir: boolean): Uint8Array {
    const header = new Uint8Array(512);
    const encoder = new TextEncoder();
    const now = Math.floor(Date.now() / 1000);

    // ヘルパー: 文字列を指定位置に書き込み
    const writeString = (str: string, offset: number, length: number) => {
      const bytes = encoder.encode(str);
      for (let i = 0; i < Math.min(bytes.length, length); i++) {
        header[offset + i] = bytes[i];
      }
    };

    // ヘルパー: 8進数を指定位置に書き込み（NULまたはスペース終端）
    const writeOctal = (value: number, offset: number, length: number, terminator: number = 0) => {
      const octal = value.toString(8).padStart(length - 1, '0');
      writeString(octal, offset, length - 1);
      header[offset + length - 1] = terminator;
    };

    // ファイル名 (0-99)
    const nameToWrite = isDir && !name.endsWith('/') ? `${name}/` : name;
    writeString(nameToWrite, 0, 100);

    // モード (100-107)
    writeOctal(isDir ? 0o755 : 0o644, 100, 8);

    // UID (108-115)
    writeOctal(0, 108, 8);

    // GID (116-123)
    writeOctal(0, 116, 8);

    // サイズ (124-135)
    writeOctal(size, 124, 12);

    // 更新時刻 (136-147)
    writeOctal(now, 136, 12);

    // チェックサム (148-155) - 一旦スペースで埋める
    for (let i = 148; i < 156; i++) {
      header[i] = 32; // スペース
    }

    // タイプフラグ (156)
    header[156] = isDir ? 53 : 48; // '5' or '0'

    // USTAR indicator (257-262)
    writeString('ustar', 257, 6);
    header[263] = 48; // '0'
    header[264] = 48; // '0'

    // ユーザー名 (265-296)
    writeString('root', 265, 32);

    // グループ名 (297-328)
    writeString('root', 297, 32);

    // チェックサム計算
    let checksum = 0;
    for (let i = 0; i < 512; i++) {
      checksum += header[i];
    }

    // チェックサムを書き込み (148-155)
    writeOctal(checksum, 148, 7);
    header[155] = 32; // スペース

    return header;
  }

  /**
   * アーカイブ作成（ネイティブ実装）
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
      const chunks: Uint8Array[] = [];
      let totalFiles = 0;
      const addedPaths = new Set<string>(); // 重複チェック用

      const baseApp = fsPathToAppPath(this.currentDir, this.projectName);

      for (const fileName of files) {
        const fileAppPath = pathResolve(baseApp, fileName);
        const file = await this.getFileFromDB(fileAppPath);

        if (!file) {
          throw new Error(`tar: ${fileName}: Cannot stat: No such file or directory`);
        }

        // tar内のパス名（先頭スラッシュなし）
        const entryName = fileAppPath.replace(/^\/+/, '');

        if (file.type === 'folder') {
          // フォルダ自身を追加（重複チェック）
          if (!addedPaths.has(entryName)) {
            const dirHeader = this.createTarHeader(entryName, 0, true);
            chunks.push(dirHeader);
            addedPaths.add(entryName);
            if (verbose) console.log(`${entryName}/`);
            totalFiles++;
          }

          // フォルダ内のファイルを取得
          const folderFiles = await fileRepository.getFilesByPrefix(this.projectId, fileAppPath);

          // フォルダ内のファイルを追加
          for (const child of folderFiles) {
            const childEntryName = child.path.replace(/^\/+/, '');

            // 重複チェック
            if (addedPaths.has(childEntryName)) {
              continue;
            }

            if (child.type === 'folder') {
              const childDirHeader = this.createTarHeader(childEntryName, 0, true);
              chunks.push(childDirHeader);
              addedPaths.add(childEntryName);
              if (verbose) console.log(`${childEntryName}/`);
            } else {
              const contentBuf = child.bufferContent
                ? new Uint8Array(child.bufferContent)
                : new TextEncoder().encode(child.content || '');

              const fileHeader = this.createTarHeader(childEntryName, contentBuf.length, false);
              chunks.push(fileHeader);
              chunks.push(contentBuf);

              // 512バイト境界にパディング
              const padding = (512 - (contentBuf.length % 512)) % 512;
              if (padding > 0) {
                chunks.push(new Uint8Array(padding));
              }

              addedPaths.add(childEntryName);
              if (verbose) console.log(childEntryName);
            }
            totalFiles++;
          }
        } else {
          // 単一ファイル（重複チェック）
          if (!addedPaths.has(entryName)) {
            const contentBuf = file.bufferContent
              ? new Uint8Array(file.bufferContent)
              : new TextEncoder().encode(file.content || '');

            const fileHeader = this.createTarHeader(entryName, contentBuf.length, false);
            chunks.push(fileHeader);
            chunks.push(contentBuf);

            const padding = (512 - (contentBuf.length % 512)) % 512;
            if (padding > 0) {
              chunks.push(new Uint8Array(padding));
            }

            addedPaths.add(entryName);
            if (verbose) console.log(entryName);
            totalFiles++;
          }
        }
      }

      if (totalFiles === 0) {
        throw new Error('tar: Cowardly refusing to create an empty archive');
      }

      // 終端マーカー（1024バイトのゼロ）
      chunks.push(new Uint8Array(1024));

      // すべてのチャンクを結合
      const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
      const tarBuffer = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        tarBuffer.set(chunk, offset);
        offset += chunk.length;
      }

      console.log(`[TarCommand] Created tar buffer: ${tarBuffer.length} bytes`);
      console.log(`[TarCommand] First 512 bytes:`, tarBuffer.slice(0, 512));

      // ArrayBufferに変換
      const archiveArrayBuffer = tarBuffer.buffer;

      const archiveAppPath = pathResolve(baseApp, archiveName);
      await fileRepository.createFile(
        this.projectId,
        archiveAppPath,
        '',
        'file',
        true,
        archiveArrayBuffer
      );

      if (this.terminalUI) {
        await this.terminalUI.spinner.success('Archive created successfully');
      }

      return verbose ? '' : `Created ${archiveName} (${totalFiles} files)`;
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
      ? new Uint8Array(file.bufferContent)
      : new TextEncoder().encode(file.content || '');

    const entries: string[] = [];
    let offset = 0;
    const decoder = new TextDecoder();

    while (offset + 512 <= buf.length) {
      const header = buf.slice(offset, offset + 512);

      // ゼロブロックチェック
      if (header.every((b: number) => b === 0)) break;

      const name = decoder.decode(header.slice(0, 100)).replace(/\0.*$/, '');
      const sizeStr = decoder.decode(header.slice(124, 136)).replace(/\0.*$/, '').trim();
      const size = parseInt(sizeStr, 8) || 0;

      if (name) {
        if (verbose) {
          const mtimeStr = decoder.decode(header.slice(136, 148)).trim();
          const mtime = parseInt(mtimeStr, 8) || 0;
          const date = new Date(mtime * 1000).toISOString().split('T')[0];
          entries.push(`-rw-r--r-- 0/0 ${size.toString().padStart(8)} ${date} ${name}`);
        } else {
          entries.push(name);
        }
      }

      offset += 512;
      if (size > 0) {
        const padding = (512 - (size % 512)) % 512;
        offset += size + padding;
      }
    }

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
        ? new Uint8Array(file.bufferContent)
        : new TextEncoder().encode(file.content || '');

      const entries: Array<{
        path: string;
        content: string;
        type: 'file' | 'folder';
        isBufferArray?: boolean;
        bufferContent?: ArrayBuffer;
      }> = [];

      let offset = 0;
      const decoder = new TextDecoder();

      while (offset + 512 <= buf.length) {
        const header = buf.slice(offset, offset + 512);

        if (header.every((b: number) => b === 0)) break;

        const name = decoder.decode(header.slice(0, 100)).replace(/\0.*$/, '');
        const typeFlag = String.fromCharCode(header[156]);
        const sizeStr = decoder.decode(header.slice(124, 136)).trim();
        const size = parseInt(sizeStr, 8) || 0;

        if (name) {
          const entryPath = name.startsWith('/') ? name.replace(/\/$/, '') : `/${name.replace(/\/$/, '')}`;
          const isDir = typeFlag === '5' || name.endsWith('/');

          offset += 512;

          if (isDir) {
            entries.push({ path: entryPath, content: '', type: 'folder' });
          } else {
            const contentBuf = buf.slice(offset, offset + size);
            
            // テキストファイルかバイナリファイルかを判定
            const isTextFile = this.isLikelyTextFile(entryPath, contentBuf);
            
            if (isTextFile) {
              // テキストファイルとして展開
              try {
                const textContent = decoder.decode(contentBuf);
                entries.push({
                  path: entryPath,
                  content: textContent,
                  type: 'file',
                  isBufferArray: false,
                });
              } catch (e) {
                // デコード失敗時はバイナリとして扱う
                entries.push({
                  path: entryPath,
                  content: '',
                  type: 'file',
                  isBufferArray: true,
                  bufferContent: contentBuf.buffer.slice(contentBuf.byteOffset, contentBuf.byteOffset + contentBuf.length),
                });
              }
            } else {
              // バイナリファイルとして展開
              entries.push({
                path: entryPath,
                content: '',
                type: 'file',
                isBufferArray: true,
                bufferContent: contentBuf.buffer.slice(contentBuf.byteOffset, contentBuf.byteOffset + contentBuf.length),
              });
            }

            const padding = (512 - (size % 512)) % 512;
            offset += size + padding;
          }

          if (verbose) console.log(name);
        } else {
          offset += 512;
        }
      }

      if (entries.length > 0) {
        await fileRepository.createFilesBulk(this.projectId, entries);
      }

      if (this.terminalUI) {
        await this.terminalUI.spinner.success('Archive extracted successfully');
      }

      return `Extracted ${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}`;
    } catch (err: any) {
      if (this.terminalUI) {
        await this.terminalUI.spinner.error(`Extract failed: ${err?.message || String(err)}`);
      }
      throw err;
    }
  }

  /**
   * ファイルがテキストファイルかどうかを判定
   * 拡張子とバイト内容の両方で判定（POSIX準拠）
   */
  private isLikelyTextFile(path: string, content: Uint8Array): boolean {
    // テキストファイルの一般的な拡張子
    const textExtensions = [
      '.txt', '.md', '.markdown', '.rst',
      '.json', '.xml', '.yaml', '.yml', '.toml', '.ini', '.conf', '.cfg',
      '.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs',
      '.html', '.htm', '.xhtml', '.svg',
      '.css', '.scss', '.sass', '.less', '.styl',
      '.sh', '.bash', '.zsh', '.fish', '.ksh', '.csh',
      '.py', '.rb', '.php', '.java', '.c', '.cpp', '.cc', '.cxx', '.h', '.hpp',
      '.rs', '.go', '.swift', '.kt', '.kts', '.scala', '.groovy',
      '.sql', '.graphql', '.proto',
      '.vim', '.el', '.lisp', '.clj', '.cljs',
      '.r', '.R', '.m', '.matlab',
      '.tex', '.latex',
      '.gitignore', '.gitattributes', '.gitmodules', '.editorconfig',
      '.env', '.envrc', '.env.example',
      '.npmrc', '.yarnrc', '.babelrc', '.eslintrc', '.prettierrc',
    ];

    const lowerPath = path.toLowerCase();
    
    // 拡張子チェック
    if (textExtensions.some(ext => lowerPath.endsWith(ext))) {
      return true;
    }

    // ファイル名チェック（拡張子なし）
    const fileName = path.split('/').pop() || '';
    const textFileNames = [
      'Dockerfile', 'Containerfile', 'Makefile', 'GNUmakefile', 'makefile',
      'README', 'LICENSE', 'COPYING', 'AUTHORS', 'CONTRIBUTORS',
      'CHANGELOG', 'CHANGES', 'HISTORY', 'NEWS',
      'TODO', 'NOTICE', 'THANKS',
      'Gemfile', 'Rakefile', 'Podfile', 'Brewfile',
      'Vagrantfile', 'Procfile',
    ];
    
    if (textFileNames.includes(fileName)) {
      return true;
    }

    // dotfileチェック（隠しファイル）
    if (fileName.startsWith('.') && !fileName.includes('.')) {
      return true;
    }

    // バイト内容チェック: null文字やバイナリ文字が含まれていないか
    // 最初の8KBをサンプリング（POSIX `file` コマンドの挙動に準拠）
    const sampleSize = Math.min(8192, content.length);
    let nullCount = 0;
    let nonTextCount = 0;
    
    for (let i = 0; i < sampleSize; i++) {
      const byte = content[i];
      
      // null文字
      if (byte === 0) {
        nullCount++;
        // nullが1つでもあればバイナリと判定
        if (nullCount > 0) {
          return false;
        }
      }
      
      // 非ASCII制御文字（タブ、改行、復帰、Form Feed、ESCを除く）
      if (byte < 32 && byte !== 9 && byte !== 10 && byte !== 13 && byte !== 12 && byte !== 27) {
        nonTextCount++;
      }
      
      // 非テキスト文字が多い場合はバイナリ
      if (nonTextCount > sampleSize * 0.05) {
        return false;
      }
    }

    // UTF-8として有効かチェック
    try {
      const decoder = new TextDecoder('utf-8', { fatal: true });
      decoder.decode(content.slice(0, sampleSize));
      return true;
    } catch (e) {
      // UTF-8デコード失敗 → バイナリ
      return false;
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