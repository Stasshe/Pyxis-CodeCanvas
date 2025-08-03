export const exportPage = async (path: string, writeOutput: (output: string) => Promise<void>, unixCommandsRef: any) => {
  try {
    const fs = unixCommandsRef.current?.fs;
    // Safari対応: window.openを同期で呼び出し
    const win = window.open('about:blank', '_blank');
    if (!win) {
      await writeOutput('新しいタブを開けませんでした。ポップアップブロックを確認してください。');
      return;
    }

    // パスがディレクトリか判定
    let stat: any = null;
    try {
      stat = await fs.promises.stat(path);
    } catch {}

    if (stat && stat.isDirectory()) {
      // フォルダの場合
      const files = await fs.promises.readdir(path);
      // index.html優先、なければ最初の.html
      let htmlFile = files.find((f: string) => f.toLowerCase() === 'index.html');
      if (!htmlFile) {
        htmlFile = files.find((f: string) => f.endsWith('.html'));
      }
      if (!htmlFile) {
        await writeOutput('フォルダ内にHTMLファイルがありません。');
        return;
      }
      const htmlPath = path + '/' + htmlFile;
      let htmlContent = await fs.promises.readFile(htmlPath, { encoding: 'utf8' });

      // CSS/JSファイルを探す
      const cssFiles = files.filter((f: string) => f.endsWith('.css'));
      const jsFiles = files.filter((f: string) => f.endsWith('.js'));

      // CSSファイルをすべてインライン化
      let cssContent = '';
      for (const css of cssFiles) {
        try {
          cssContent += await fs.promises.readFile(path + '/' + css, { encoding: 'utf8' }) + '\n';
        } catch {}
      }
      if (cssContent) {
        // <link rel="stylesheet">タグを削除
        htmlContent = htmlContent.replace(/<link[^>]*rel=["']stylesheet["'][^>]*>/gi, '');
        // <head>タグ直後に<style>挿入
        htmlContent = htmlContent.replace(/<head>/i, `<head>\n<style>\n${cssContent}\n</style>`);
      }

      // JSファイルをすべてインライン化
      let jsContent = '';
      for (const js of jsFiles) {
        try {
          jsContent += await fs.promises.readFile(path + '/' + js, { encoding: 'utf8' }) + '\n';
        } catch {}
      }
      if (jsContent) {
        // <script src=...>タグを削除
        htmlContent = htmlContent.replace(/<script[^>]*src=["'][^"']+["'][^>]*><\/script>/gi, '');
        // </body>タグ直前に<script>挿入
        htmlContent = htmlContent.replace(/<\/body>/i, `<script>\n${jsContent}\n</script></body>`);
      }

      win.document.open();
      win.document.write(htmlContent);
      win.document.close();
      await writeOutput(`フォルダ内のページが新しいタブで開かれました: ${htmlPath}`);
    } else {
      // ファイルの場合
      const content = await fs.promises.readFile(path, { encoding: 'utf8' });
      if (!content) {
        await writeOutput(`指定されたファイルが見つかりません: ${path}`);
        return;
      }
      win.document.open();
      win.document.write(content);
      win.document.close();
      await writeOutput(`ページが新しいタブで開かれました: ${path}`);
    }
  } catch (error) {
    await writeOutput(`エクスポート中にエラーが発生しました: ${(error as Error).message}`);
  }
};
