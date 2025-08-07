import { UnixCommands } from '../cmd/unix';
import { syncFileToFileSystem } from '../filesystem';

/**
 * ファイルアップロード（インポート）機能
 * @param file File APIで受け取ったファイル
 * @param targetPath 保存先パス（例: /workspaces/project/foo.txt）
 * @param unix UnixCommandsインスタンス（プロジェクトごとに生成済みのものを渡す）
 */
export async function importSingleFile(file: File, targetPath: string, unix: UnixCommands) {
  // 拡張子でバイナリか判定（画像・pdf等はバイナリ）
  const isBinary = (() => {
    const ext = file.name.toLowerCase();
    if (ext.match(/\.(png|jpg|jpeg|gif|bmp|webp|svg|pdf)$/)) return true;
    return false;
  })();

  let content: string | ArrayBuffer;
  if (isBinary) {
    content = await file.arrayBuffer();
  } else {
    content = await file.text();
  }

  await unix.touch(targetPath);
  console.log(`[importSingleFile] ファイルアップロード開始: ${targetPath}`);
  if (isBinary) {
    // バイナリはecho不可なのでスキップ（DB/FS同期のみ）
  } else {
    await unix.echo(content as string, targetPath);
  }
  console.log(`[importSingleFile] ファイルアップロード完了: ${targetPath}`);

  // projectNameとfilePathを抽出
  const match = targetPath.match(/^\/projects\/([^/]+)(\/.*)$/);
  if (!match) throw new Error('targetPath形式が不正です');
  const [, projectName, filePath] = match;
  console.log(`[importSingleFile] プロジェクト名: ${projectName}, ファイルパス: ${filePath}`);
  // ファイルシステム同期
  await syncFileToFileSystem(projectName, filePath, content, isBinary ? 'create' : undefined);
  console.log(`[importSingleFile] ファイルシステム同期完了: ${filePath}`);
}
