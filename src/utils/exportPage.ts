export const exportPage = async (path: string, writeOutput: (output: string) => Promise<void>, unixCommandsRef: any) => {
  try {
    // Safari対応: window.openを同期で呼び出し
    const win = window.open('about:blank', '_blank');
    if (!win) {
      await writeOutput('新しいタブを開けませんでした。ポップアップブロックを確認してください。');
      return;
    }

    // ファイル内容を取得
    const content = await unixCommandsRef.current?.fs.promises.readFile(path, { encoding: 'utf8' });
    if (!content) {
      await writeOutput(`指定されたファイルが見つかりません: ${path}`);
      return;
    }

    // 新しいタブにHTMLを挿入
    win.document.open();
    win.document.write(content);
    win.document.close();

    await writeOutput(`ページが新しいタブで開かれました: ${path}`);
  } catch (error) {
    await writeOutput(`エクスポート中にエラーが発生しました: ${(error as Error).message}`);
  }
};
