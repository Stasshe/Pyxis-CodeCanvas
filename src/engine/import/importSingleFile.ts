import { fileRepository } from '@/engine/core/fileRepository';

/**
 * [NEW ARCHITECTURE] ファイルアップロード(インポート)機能
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
  // バイナリ拡張子リスト
  const binaryExt =
    /\.(png|jpg|jpeg|gif|bmp|webp|svg|pdf|zip|ico|tar|gz|rar|exe|dll|so|mp3|mp4|avi|mov|woff|woff2|ttf|eot)$/i;
  const isBinary = binaryExt.test(file.name.toLowerCase());

  console.log(`[importSingleFile] [NEW ARCHITECTURE] ファイルアップロード開始: ${targetPath}`);

  // targetPath からプロジェクト内パスを抽出
  const match = targetPath.match(/^\/projects\/[^/]+(\/.*)$/);
  const filePath = match ? match[1] : targetPath;

  if (!projectId) {
    console.warn('[importSingleFile] projectIdが取得できませんでした:', targetPath);
    return;
  }

  if (!isBinary) {
    // テキストファイルは直接createFileで登録（touch+echoの代替）
    const content = await file.text();
    await fileRepository.createFile(projectId, filePath, content, 'file');
  } else {
    // バイナリファイルはArrayBufferを渡して作成
    const arrayBuffer = await file.arrayBuffer();
    await fileRepository.createFile(projectId, filePath, '', 'file', true, arrayBuffer);
  }

  console.log(`[importSingleFile] [NEW ARCHITECTURE] ファイルアップロード完了: ${targetPath}`);
  // [NEW ARCHITECTURE] syncFileToFileSystemは不要 - fileRepositoryが自動的にGitFileSystemに同期
}
