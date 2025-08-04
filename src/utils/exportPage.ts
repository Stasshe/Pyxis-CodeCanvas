export const exportPage = async (path: string, writeOutput: (output: string) => Promise<void>, unixCommandsRef: any) => {
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

    // ローカル判定関数
    const isLocal = (src: string) => {
      return src.startsWith('.') || src.startsWith('/') || src.startsWith('..');
    };

    if (stat && stat.isDirectory()) {
      const files = await fs.promises.readdir(path);
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

      // CSS
      const cssFiles = files.filter((f: string) => f.endsWith('.css'));
      let cssContent = '';
      for (const css of cssFiles) {
        try {
          const cssPath = path + '/' + css;
          cssContent += await fs.promises.readFile(cssPath, { encoding: 'utf8' }) + '\n';
        } catch (err) {
          console.error(`CSSファイルの読み込みに失敗しました: ${css}`, err);
        }
      }
      // ローカルCSSのみインライン化
      htmlContent = htmlContent.replace(
        /<link[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+)["'][^>]*>/gi,
        (match: string, href: string) => {
          if (isLocal(href)) {
            return '';
          }
          return match;
        }
      );
      if (cssContent) {
        htmlContent = htmlContent.replace(/<head>/i, `<head>\n<style>\n${cssContent}\n</style>`);
      }

      // JS
      const jsFiles = files.filter((f: string) => f.endsWith('.js'));
      let jsContent = '';
      for (const js of jsFiles) {
        try {
          const jsPath = path + '/' + js;
          jsContent += await fs.promises.readFile(jsPath, { encoding: 'utf8' }) + '\n';
        } catch (err) {
          console.error(`JSファイルの読み込みに失敗しました: ${js}`, err);
        }
      }
      // ローカルJSのみインライン化
      htmlContent = htmlContent.replace(
        /<script[^>]*src=["']([^"']+)["'][^>]*><\/script>/gi,
        (match: string, src: string) => {
          if (isLocal(src)) {
            return '';
          }
          return match;
        }
      );
      if (jsContent) {
        htmlContent = htmlContent.replace(/<\/body>/i, `<script>\n${jsContent}\n</script></body>`);
      }

      iframeDoc.open();
      iframeDoc.write(htmlContent);
      iframeDoc.close();

      // eruda
      const erudaScript = iframeDoc.createElement('script');
      erudaScript.src = 'https://cdn.jsdelivr.net/npm/eruda';
      erudaScript.onload = function() {
        const initScript = iframeDoc.createElement('script');
        initScript.textContent = 'eruda.init();';
        iframeDoc.body.appendChild(initScript);
      };
      iframeDoc.body.appendChild(erudaScript);

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
      erudaScript.onload = function() {
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
