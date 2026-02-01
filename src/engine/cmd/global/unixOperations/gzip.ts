import { fileRepository } from '@/engine/core/fileRepository';
import pako from 'pako';
import { parseWithGetOpt } from '../../lib';
import { UnixCommandBase } from './base';

/**
 * gzip - POSIX準拠のファイル圧縮/展開
 *
 * Usage:
 *   gzip file              # fileを圧縮してfile.gzを作成、元ファイルを削除
 *   gzip -k file           # 元ファイルを保持
 *   gzip -d file.gz        # file.gzを展開してfileを作成、.gzを削除
 *   gzip -dk file.gz       # .gzを保持
 *   gzip -c file > out.gz  # 標準出力に出力（未実装）
 *
 * Options:
 *   -d, --decompress  展開モード
 *   -k, --keep        元ファイルを保持
 *   -f, --force       既存ファイルを上書き
 *   -v, --verbose     詳細表示
 *   -h, --help        ヘルプ表示
 */
export class GzipCommand extends UnixCommandBase {
  async execute(args: string[] = []): Promise<string> {
    // オプション解析
    const optstring = 'dkfvh';
    const longopts = ['decompress', 'keep', 'force', 'verbose', 'help', 'uncompress'];
    const { flags, values, positional, errors } = parseWithGetOpt(args, optstring, longopts);
    if (errors.length) throw new Error(errors.join('; '));

    // ヘルプ
    if (flags.has('-h') || flags.has('--help')) {
      return this.showHelp();
    }

    // オプション判定
    const decompress = flags.has('-d') || flags.has('--decompress') || flags.has('--uncompress');
    const keep = flags.has('-k') || flags.has('--keep');
    const force = flags.has('-f') || flags.has('--force');
    const verbose = flags.has('-v') || flags.has('--verbose');

    if (positional.length === 0) {
      throw new Error("gzip: missing file operand\nTry 'gzip --help' for more information.");
    }

    const results: string[] = [];

    for (const fileArg of positional) {
      try {
        const result = decompress
          ? await this.decompressFile(fileArg, keep, force, verbose)
          : await this.compressFile(fileArg, keep, force, verbose);
        if (result) results.push(result);
      } catch (err: any) {
        // 複数ファイル処理時はエラーを記録して継続
        results.push(`gzip: ${fileArg}: ${err?.message || String(err)}`);
      }
    }

    return results.join('\n');
  }

  /**
   * ファイル圧縮
   */
  private async compressFile(
    fileName: string,
    keep: boolean,
    force: boolean,
    verbose: boolean
  ): Promise<string> {
    const resolved = this.normalizePath(this.resolvePath(fileName));
    const rel = this.getRelativePathFromProject(resolved);
    const file = await this.getFileFromDB(rel);

    if (!file) {
      throw new Error('No such file or directory');
    }

    if (file.type === 'folder') {
      throw new Error('Is a directory');
    }

    // 既に.gzで終わっている場合は警告
    if (fileName.endsWith('.gz')) {
      if (!force) {
        throw new Error('already has .gz suffix -- unchanged');
      }
    }

    // 出力ファイル名
    const outName = fileName.endsWith('.gz') ? fileName : `${fileName}.gz`;
    const outRel = this.getRelativePathFromProject(this.normalizePath(this.resolvePath(outName)));

    // 既存チェック
    if (!force) {
      const existing = await this.getFileFromDB(outRel);
      if (existing) {
        throw new Error(`${outName} already exists; not overwritten`);
      }
    }

    if (this.terminalUI) {
      await this.terminalUI.spinner.start(`Compressing ${fileName}...`);
    }

    try {
      // 圧縮
      const contentArray = file.bufferContent
        ? new Uint8Array(file.bufferContent)
        : new TextEncoder().encode(file.content || '');
      const compressed = pako.gzip(contentArray);

      // 保存
      await fileRepository.createFile(
        this.projectId,
        outName,
        '',
        'file',
        true,
        compressed.buffer as ArrayBuffer
      );

      // 元ファイル削除（-kがなければ）
      if (!keep) {
        // file は getFileFromDB で取得したオブジェクト
        await fileRepository.deleteFile(file.id);
      }

      if (this.terminalUI) {
        await this.terminalUI.spinner.success(`Compressed to ${outName}`);
      }

      if (verbose) {
        const ratio = ((1 - compressed.length / contentArray.length) * 100).toFixed(1);
        return `${fileName}:\t ${ratio}% -- ${keep ? 'kept' : 'replaced with'} ${outName}`;
      }

      return '';
    } catch (err: any) {
      if (this.terminalUI) {
        await this.terminalUI.spinner.error(`Compression failed: ${err?.message || String(err)}`);
      }
      throw err;
    }
  }

  /**
   * ファイル展開
   */
  private async decompressFile(
    fileName: string,
    keep: boolean,
    force: boolean,
    verbose: boolean
  ): Promise<string> {
    const resolved = this.normalizePath(this.resolvePath(fileName));
    const rel = this.getRelativePathFromProject(resolved);
    const file = await this.getFileFromDB(rel);

    if (!file) {
      throw new Error('No such file or directory');
    }

    if (!file.isBufferArray || !file.bufferContent) {
      throw new Error('not in gzip format');
    }

    // 出力ファイル名（.gzを除去）
    let outName = fileName;
    if (fileName.endsWith('.gz')) {
      outName = fileName.slice(0, -3);
    } else {
      // .gzで終わっていない場合は警告
      if (!force) {
        throw new Error('unknown suffix -- ignored');
      }
      // -fがあれば.outを付ける
      outName = `${fileName}.out`;
    }

    const outRel = this.getRelativePathFromProject(this.normalizePath(this.resolvePath(outName)));

    // 既存チェック
    if (!force) {
      const existing = await this.getFileFromDB(outRel);
      if (existing) {
        throw new Error(`${outName} already exists; not overwritten`);
      }
    }

    if (this.terminalUI) {
      await this.terminalUI.spinner.start(`Decompressing ${fileName}...`);
    }

    try {
      // 展開
      const inBuf = new Uint8Array(file.bufferContent);
      const decompressed = pako.ungzip(inBuf);

      // 保存
      await fileRepository.createFile(
        this.projectId,
        outName,
        '',
        'file',
        true,
        decompressed.buffer as ArrayBuffer
      );

      // 元ファイル削除（-kがなければ）
      if (!keep) {
        // file は getFileFromDB で取得したオブジェクト
        await fileRepository.deleteFile(file.id);
      }

      if (this.terminalUI) {
        await this.terminalUI.spinner.success(`Decompressed to ${outName}`);
      }

      if (verbose) {
        const ratio = ((1 - inBuf.length / decompressed.length) * 100).toFixed(1);
        return `${fileName}:\t ${ratio}% -- ${keep ? 'kept' : 'replaced with'} ${outName}`;
      }

      return '';
    } catch (err: any) {
      if (this.terminalUI) {
        await this.terminalUI.spinner.error(`Decompression failed: ${err?.message || String(err)}`);
      }
      throw err;
    }
  }

  private showHelp(): string {
    return `Usage: gzip [OPTION]... [FILE]...

Compress or uncompress FILEs (by default, compress FILES in-place).

Options:
  -d, --decompress  decompress
  -k, --keep        keep (don't delete) input files
  -f, --force       force overwrite of output file
  -v, --verbose     verbose mode
  -h, --help        display this help and exit

With no FILE, or when FILE is -, read standard input (not yet implemented).

Examples:
  gzip file           # Compress file to file.gz
  gzip -k file        # Compress but keep original
  gzip -d file.gz     # Decompress file.gz to file
  gzip -dk file.gz    # Decompress but keep .gz file`;
  }
}
