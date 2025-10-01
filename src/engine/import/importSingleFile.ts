import { UnixCommands } from '../cmd/unix';

import { syncFileToFileSystem } from '@/engine/core/filesystem';
import { isBufferArray } from '@/engine/helper/isBufferArray';

/**
 * ファイルアップロード（インポート）機能
 * @param file File APIで受け取ったファイル
 * @param targetPath 保存先パス（例: /workspaces/project/foo.txt）
 * @param unix UnixCommandsインスタンス（プロジェクトごとに生成済みのものを渡す）
 */
export async function importSingleFile(file: File, targetPath: string, unix: UnixCommands) {
  // isBufferArrayでバイナリ判定（stringには使わない）
  let isBinary = false;
  const ext = file.name.toLowerCase();
  if (ext.match(/\.(png|jpg|jpeg|gif|bmp|webp|svg|pdf|zip)$/)) isBinary = true;

  let content: string = '';
  let bufferContent: ArrayBuffer | undefined = undefined;
  if (isBinary) {
    const arrayBuffer = await file.arrayBuffer();
    if (isBufferArray(arrayBuffer)) {
      bufferContent = arrayBuffer;
      content = '';
    } else {
      // 万一バイナリ拡張子だがArrayBufferでなければテキストとして扱う
      isBinary = false;
      content = await file.text();
    }
  } else {
    // テキストファイルはstringとして読み込む。isBufferArrayは使わない。
    content = await file.text();
    bufferContent = undefined;
  }

  await unix.touch(targetPath);
  console.log(`[importSingleFile] ファイルアップロード開始: ${targetPath}`);
  if (isBinary) {
    // バイナリはecho不可なのでスキップ（DB/FS同期のみ）
  } else {
    await unix.echo(content, targetPath);
  }
  console.log(`[importSingleFile] ファイルアップロード完了: ${targetPath}`);

  // projectNameとfilePathを抽出
  const match = targetPath.match(/^\/projects\/([^/]+)(\/.*)$/);
  if (!match) throw new Error('targetPath形式が不正です');
  const [, projectName, filePath] = match;
  console.log(`[importSingleFile] プロジェクト名: ${projectName}, ファイルパス: ${filePath}`);
  // ファイルシステム同期
  await syncFileToFileSystem(
    projectName,
    filePath,
    isBinary ? null : content,
    isBinary ? 'create' : undefined,
    isBinary ? bufferContent : undefined
  );
  console.log(`[importSingleFile] ファイルシステム同期完了: ${filePath}`);
}
