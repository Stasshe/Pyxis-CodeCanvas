import JSZip from 'jszip';

import { UnixCommandBase } from './base';
import { parseWithGetOpt } from '../../lib';

import { fileRepository } from '@/engine/core/fileRepository';
import { fsPathToAppPath, resolvePath as pathResolve, toFSPath } from '@/engine/core/pathUtils';
import { isLikelyTextFile } from '@/engine/helper/isLikelyTextFile';

// TextDecoder: prefer browser global, fall back to Node's util.TextDecoder
const TextDecoder = (typeof globalThis !== 'undefined' && (globalThis as any).TextDecoder)
  ? (globalThis as any).TextDecoder
  : /* eslint-disable-next-line @typescript-eslint/no-var-requires */ require('util').TextDecoder;

/**
 * unzip - ZIP アーカイブを展開してプロジェクトに登録
 * 使用法:
 *   unzip ARCHIVE.zip [DEST_DIR]
 */
export class UnzipCommand extends UnixCommandBase {
  async execute(args: string[]): Promise<string> {
    const { flags, positional, errors } = parseWithGetOpt(args, '', ['help']);
    if (errors.length) throw new Error(errors.join('; '));
    const options = flags;

    if (options.has('--help') || options.has('-h')) {
      return 'Usage: unzip ARCHIVE.zip [DEST_DIR]\nExtract files from a ZIP archive into the project.';
    }

    const archive = positional[0] || args[0];
    const dest = positional[1] || '';
    return await this.extract(archive, dest);
  }

  async extract(
    zipFileName: string,
    destDir: string,
    bufferContent?: ArrayBuffer
  ): Promise<string> {
    // mv等と同じパス解決ロジックに統一
    const destTarget = destDir && destDir !== '' ? destDir : '.';
    const baseApp = fsPathToAppPath(this.currentDir, this.projectName);
    const destApp = pathResolve(baseApp, destTarget);
    const normalizedDest = toFSPath(this.projectName, destApp);

    let spinnerStarted = false;
    try {
      let zipBuffer: ArrayBuffer | undefined = bufferContent;
      if (this.terminalUI) {
        await this.terminalUI.spinner.start('Unzipping archive...');
        spinnerStarted = true;
      }
      if (!zipBuffer) {
        // Use AppPath to fetch archive directly
        const archiveApp = pathResolve(baseApp, zipFileName);
        const relPath = archiveApp;
        // Try to fetch the archive directly by path to avoid loading all project files
        const target = await fileRepository.getFileByPath(this.projectId, relPath);
        // デバッグログ追加
        console.log('[unzip] zipFileName:', zipFileName);
        console.log('[unzip] relPath:', relPath);
        console.log('[unzip] target:', target ? target.path : null);
        if (!target) {
          console.error('[unzip] archive not found:', zipFileName, 'relPath:', relPath);
          throw new Error(`archive not found: ${zipFileName}`);
        }
        if (target.isBufferArray && target.bufferContent) {
          zipBuffer = target.bufferContent as ArrayBuffer;
        } else if (target.content) {
          zipBuffer = new TextEncoder().encode(target.content).buffer;
        } else {
          throw new Error(`archive ${zipFileName} has no binary content`);
        }
      }

      const zip = await JSZip.loadAsync(zipBuffer as ArrayBuffer);
      let fileCount = 0;
      const entries: Array<any> = [];
      // track added folder paths to avoid duplicates (paths are project-relative like '/src')
      const addedFolders = new Set<string>();

      for (const relPath in zip.files) {
        const file = zip.files[relPath];

        if (!relPath || relPath === '/' || relPath.includes('../')) {
          continue;
        }

        const fileApp = pathResolve(destApp, relPath);
        const normalizedFilePath = toFSPath(this.projectName, fileApp);
        const relativePath = fileApp;

        if (file.dir || relPath.endsWith('/')) {
          // ensure folder paths are recorded
          if (!addedFolders.has(relativePath)) {
            entries.push({ path: relativePath, content: '', type: 'folder' });
            addedFolders.add(relativePath);
          }
        } else {
          // Ensure parent directories are present in the entries list. createFilesBulk does not
          // automatically create parent folders, so add them explicitly (top-down).
            const parentParts = relativePath.split('/').filter(p => p);
          if (parentParts.length > 1) {
            let accum = '';
            for (let i = 0; i < parentParts.length - 1; i++) {
              accum = `${accum}/${parentParts[i]}`;
              if (!addedFolders.has(accum)) {
                entries.push({ path: accum, content: '', type: 'folder' });
                addedFolders.add(accum);
              }
            }
          }

          // then push the file entry itself
          const arrayBuffer = await file.async('arraybuffer');
          const contentBuf = new Uint8Array(arrayBuffer);
          const isText = await isLikelyTextFile(relativePath, contentBuf);
          if (isText) {
            try {
              const text = new TextDecoder().decode(contentBuf);
              entries.push({ path: relativePath, content: text, type: 'file', isBufferArray: false });
            } catch (e) {
              // Decoding failed — treat as binary
              entries.push({
                path: relativePath,
                content: '',
                type: 'file',
                isBufferArray: true,
                bufferContent: arrayBuffer,
              });
            }
          } else {
            entries.push({
              path: relativePath,
              content: '',
              type: 'file',
              isBufferArray: true,
              bufferContent: arrayBuffer,
            });
          }
        }
        fileCount++;
      }

      // Note: entries already contains folders (parents) followed by files; call bulk create
      if (entries.length > 0) {
        const bulkEntries = entries.map(e => ({
          path: e.path,
          content: e.content,
          type: e.type,
          isBufferArray: e.isBufferArray,
          bufferContent: e.bufferContent,
        }));

        await fileRepository.createFilesBulk(this.projectId, bulkEntries);
      }

      return `Unzipped ${fileCount} file(s) to ${normalizedDest}`;
    } catch (error) {
      // 例外時も詳細ログ
      console.error('[unzip] error:', error);
      throw new Error(`unzip: ${zipFileName}: ${(error as Error).message}`);
    } finally {
      if (spinnerStarted && this.terminalUI) {
        try {
          await this.terminalUI.spinner.stop();
        } catch (e) {
          console.warn('[unzip] spinner stop failed:', e);
        }
      }
    }
  }


}
