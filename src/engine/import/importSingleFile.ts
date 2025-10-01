import { UnixCommands } from '../cmd/unix';

/**
 * [NEW ARCHITECTURE] ファイルアップロード(インポート)機能
 * fileRepository経由で自動的にGitFileSystemに同期されるため、syncFileToFileSystemは不要
 *
 * @param file File APIで受け取ったファイル
 * @param targetPath 保存先パス(例: /projects/project/foo.txt)
 * @param unix UnixCommandsインスタンス(プロジェクトごとに生成済みのものを渡す)
 */
export async function importSingleFile(file: File, targetPath: string, unix: UnixCommands) {
  // バイナリ拡張子リスト
  const binaryExt =
    /\.(png|jpg|jpeg|gif|bmp|webp|svg|pdf|zip|ico|tar|gz|rar|exe|dll|so|mp3|mp4|avi|mov|woff|woff2|ttf|eot)$/i;
  const isBinary = binaryExt.test(file.name.toLowerCase());

  console.log(`[importSingleFile] [NEW ARCHITECTURE] ファイルアップロード開始: ${targetPath}`);

  // touch: fileRepository.createFile経由でDB登録 + GitFileSystemに自動同期
  await unix.touch(targetPath);

  // テキストファイルの場合のみecho
  if (!isBinary) {
    const content = await file.text();
    // echo: fileRepository.saveFile経由でDB更新 + GitFileSystemに自動同期
    await unix.echo(content, targetPath);
  } else {
    // バイナリファイルの場合は、touchで作成した後、直接バイナリ内容を書き込む
    const arrayBuffer = await file.arrayBuffer();
    // unix.echoでバイナリは扱えないため、fileRepositoryで直接保存
    // targetPathから projectName と filePath を抽出
    const match = targetPath.match(/^\/projects\/([^/]+)(\/.*)$/);
    if (match) {
      const [, projectName, filePath] = match;
      // UnixCommandsインスタンスが持つprojectIdを取得する必要があるが、
      // ここではprojectIdを取得できないため、unix内部でバイナリ対応を追加するか、
      // 別の方法でバイナリファイルを保存する必要がある
      // 現時点では、touchで作成したファイルにバイナリ内容を書き込む方法は未実装
      // TODO: UnixCommands.echoでバイナリ対応を追加するか、別途バイナリ保存メソッドを実装
      console.warn('[importSingleFile] バイナリファイルの内容書き込みは未実装です:', targetPath);
    }
  }

  console.log(`[importSingleFile] [NEW ARCHITECTURE] ファイルアップロード完了: ${targetPath}`);
  // [NEW ARCHITECTURE] syncFileToFileSystemは不要 - fileRepositoryが自動的にGitFileSystemに同期
}
