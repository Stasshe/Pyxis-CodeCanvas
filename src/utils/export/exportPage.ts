import { inlineHtmlAssets } from './inlineHtmlAssets';

export const exportPage = async (
  path: string,
  writeOutput: (output: string) => Promise<void>,
  unixCommandsRef: any
) => {
  try {
    const fs = unixCommandsRef.current?.fs;
    const newWindow = window.open('about:blank', '_blank');
    if (!newWindow) {
      await writeOutput('新しいタブを開けませんでした。ポップアップブロックを確認してください。');
      return;
    }

    const iframe = newWindow.document.createElement('iframe');
    iframe.style.position = 'absolute';
    iframe.style.top = '0';
    iframe.style.left = '0';
    iframe.style.width = '100%';
    iframe.style.height = '100%';
    iframe.style.border = 'none';
    newWindow.document.body.appendChild(iframe);

    const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!iframeDoc) {
      await writeOutput('iframeのドキュメントを取得できませんでした。');
      return;
    }

    let stat: any = null;
    try {
      stat = await fs.promises.stat(path);
    } catch {}

    if (stat && stat.isDirectory()) {
      const files = await fs.promises.readdir(path);
      let htmlContent: string;
      try {
        htmlContent = await inlineHtmlAssets(files, path, fs);
      } catch (err: any) {
        await writeOutput(err.message || 'HTMLインライン化中にエラーが発生しました。');
        return;
      }

      iframeDoc.open();
      iframeDoc.write(htmlContent);
      iframeDoc.close();

      // eruda
      const erudaScript = iframeDoc.createElement('script');
      erudaScript.src = 'https://cdn.jsdelivr.net/npm/eruda';
      erudaScript.onload = function () {
        const initScript = iframeDoc.createElement('script');
        initScript.textContent = 'eruda.init();';
        iframeDoc.body.appendChild(initScript);
      };
      iframeDoc.body.appendChild(erudaScript);

      // index.htmlまたは最初のhtmlファイル名を取得
      let htmlFile = files.find((f: string) => f.toLowerCase() === 'index.html');
      if (!htmlFile) {
        htmlFile = files.find((f: string) => f.endsWith('.html'));
      }
      const htmlPath = htmlFile ? path + '/' + htmlFile : path;
      await writeOutput(`フォルダ内のページが新しいタブのiframe内で開かれました: ${htmlPath}`);
    } else {
      const content = await fs.promises.readFile(path, { encoding: 'utf8' });
      if (!content) {
        await writeOutput(`指定されたファイルが見つかりません: ${path}`);
        return;
      }

      iframeDoc.open();
      iframeDoc.write(content);
      iframeDoc.close();

      // eruda
      const erudaScript = iframeDoc.createElement('script');
      erudaScript.src = 'https://cdn.jsdelivr.net/npm/eruda';
      erudaScript.onload = function () {
        const initScript = iframeDoc.createElement('script');
        initScript.textContent = 'eruda.init();';
        iframeDoc.body.appendChild(initScript);
      };
      iframeDoc.body.appendChild(erudaScript);

      await writeOutput(`ページが新しいタブのiframe内で開かれました: ${path}`);
    }
  } catch (error) {
    await writeOutput(`エクスポート中にエラーが発生しました: ${(error as Error).message}`);
  }
};
