import { UnixCommands } from '../cmd/unix';
import { syncFileToFileSystem } from '@/utils/core/filesystem';
import { isBufferArray } from '@/utils/helper/isBufferArray';

/**
 * ファイルアップロード（インポート）機能
 * @param file File APIで受け取ったファイル
 * @param targetPath 保存先パス（例: /workspaces/project/foo.txt）
 * @param unix UnixCommandsインスタンス（プロジェクトごとに生成済みのものを渡す）
 */
export async function importSingleFile(file: File, targetPath: string, unix: UnixCommands) {
  // isBufferArrayでバイナリ判定
  let isBinary = false;
  // File APIの型判定は難しいので拡張子で判定しつつ、arrayBuffer取得後にisBufferArrayで再判定
  const ext = file.name.toLowerCase();
  if (ext.match(/\.(png|jpg|jpeg|gif|bmp|webp|svg|pdf|zip)$/)) isBinary = true;

  let content: string;
  let bufferContent: ArrayBuffer | undefined = undefined;
  if (isBinary) {
    const arrayBuffer = await file.arrayBuffer();
    if (!isBufferArray(arrayBuffer)) {
      // 念のため再判定
      isBinary = false;
      content = await file.text();
    } else {
      bufferContent = arrayBuffer;
      content = ''; // バイナリファイルの場合はcontentは空
    }
  } else {
    content = await file.text();
    // テキストだがバイナリだった場合
    if (isBufferArray(content)) {
      isBinary = true;
      // この場合は既にstringとして読み込まれているので、再度arrayBufferで読み込む
      bufferContent = await file.arrayBuffer();
      content = '';
    }
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
