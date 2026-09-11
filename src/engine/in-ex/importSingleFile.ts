import { fileRepository } from '@/engine/core/fileRepository';
import { isLikelyTextFile } from '@/engine/helper/isLikelyTextFile';

/**
 * ファイルアップロード(インポート)機能
 * fileRepository経由で自動的にGitFileSystemに同期されるため、syncFileToFileSystemは不要
 *
 * @param file File APIで受け取ったファイル
 * @param targetPath 保存先パス(例: /projects/project/foo.txt)
 * @param unix UnixCommandsインスタンス(プロジェクトごとに生成済みのものを渡す)
 */
export async function importSingleFile(
  file: File,
  targetPath: string,
  projectName: string,
  projectId?: string
) {
  console.log(`[importSingleFile] ファイルアップロード開始: ${targetPath}`);

  // targetPath からプロジェクト内パスを抽出
  const match = targetPath.match(/^\/projects\/[^/]+(\/.*)$/);
  const filePath = match ? match[1] : targetPath;

  if (!projectId) {
    console.warn('[importSingleFile] projectIdが取得できませんでした:', targetPath);
    return;
  }

  const arrayBuffer = await file.arrayBuffer();
  const content = new Uint8Array(arrayBuffer);
  const isText = await isLikelyTextFile(file.name, content);

  if (isText) {
    // テキストファイルは直接createFileで登録（touch+echoの代替）
    await fileRepository.createFile(projectId, filePath, new TextDecoder().decode(content), 'file');
  } else {
    // バイナリファイルはArrayBufferを渡して作成
    await fileRepository.createFile(projectId, filePath, '', 'file', true, arrayBuffer);
  }

  console.log(`[importSingleFile] ファイルアップロード完了: ${targetPath}`);
  // syncFileToFileSystemは不要 - fileRepositoryが自動的にGitFileSystemに同期
}
