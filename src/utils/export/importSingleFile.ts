import { UnixCommands } from '../cmd/unix';
import { syncFileToFileSystem } from '../filesystem';

/**
 * ファイルアップロード（インポート）機能
 * @param file File APIで受け取ったファイル
 * @param targetPath 保存先パス（例: /workspaces/project/foo.txt）
 * @param unix UnixCommandsインスタンス（プロジェクトごとに生成済みのものを渡す）
 */
export async function importSingleFile(file: File, targetPath: string, unix: UnixCommands) {

  await unix.touch(targetPath);
  // echoで内容書き込み
  console.log(`[importSingleFile] ファイルアップロード開始: ${targetPath}`);
  const content = await file.text();
  await unix.echo(content, targetPath);
  console.log(`[importSingleFile] ファイルアップロード完了: ${targetPath}`);

  // projectNameとfilePathを抽出
  const match = targetPath.match(/^\/projects\/([^/]+)(\/.*)$/);
  if (!match) throw new Error('targetPath形式が不正です');
  const [, projectName, filePath] = match;
  console.log(`[importSingleFile] プロジェクト名: ${projectName}, ファイルパス: ${filePath}`);
  // ファイルシステム同期
  await syncFileToFileSystem(projectName, filePath, content);
  console.log(`[importSingleFile] ファイルシステム同期完了: ${filePath}`);
}
