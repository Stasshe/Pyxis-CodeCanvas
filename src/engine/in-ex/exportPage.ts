import { basename, fsClient, getParentPath, normalizePath } from '@/engine/core/fs';
import { inlineHtmlAssets } from './inlineHtmlAssets';

export const exportPage = async (
  path: string,
  writeOutput: (output: string) => Promise<void>
): Promise<void> => {
  try {
    const targetPath = normalizePath(path);
    const target = await fsClient.stat(targetPath);
    const isDirectory = target.type === 'folder';
    let directoryPath = targetPath;
    if (!isDirectory) directoryPath = getParentPath(targetPath);
    let childFiles: string[] = [];
    if (isDirectory) {
      const entries = await fsClient.readdir(targetPath);
      childFiles = entries
        .filter(entry => entry.type === 'file')
        .map(entry => basename(entry.path));
    }
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

    let htmlContent: string;
    if (isDirectory) {
      htmlContent = await inlineHtmlAssets(childFiles, directoryPath, fullPath =>
        fsClient.readText(fullPath)
      );
    } else {
      htmlContent = await fsClient.readText(targetPath);
    }

    iframeDoc.open();
    iframeDoc.write(htmlContent);
    iframeDoc.close();

    const erudaScript = iframeDoc.createElement('script');
    erudaScript.src = 'https://cdn.jsdelivr.net/npm/eruda';
    erudaScript.onload = () => {
      const initScript = iframeDoc.createElement('script');
      initScript.textContent = 'eruda.init();';
      iframeDoc.body.appendChild(initScript);
    };
    iframeDoc.body.appendChild(erudaScript);

    let htmlFile = childFiles.find(file => file.toLowerCase() === 'index.html');
    if (!htmlFile) htmlFile = childFiles.find(file => file.endsWith('.html'));
    let exportedPath = targetPath;
    if (isDirectory && htmlFile) exportedPath = `${targetPath}/${htmlFile}`;
    let message = `ページが新しいタブのiframe内で開かれました: ${targetPath}`;
    if (isDirectory) {
      message = `フォルダ内のページが新しいタブのiframe内で開かれました: ${exportedPath}`;
    }
    await writeOutput(message);
  } catch (error) {
    let message = String(error);
    if (error instanceof Error) message = error.message;
    await writeOutput(`エクスポート中にエラーが発生しました: ${message}`);
  }
};
