export const exportPage = async (path: string, writeOutput: (output: string) => Promise<void>, unixCommandsRef: any) => {
  try {
    const fs = unixCommandsRef.current?.fs;
    const win = window.open('about:blank', '_blank');
    if (!win) {
      await writeOutput('新しいタブを開けませんでした。ポップアップブロックを確認してください。');
      return;
    }

    let stat: any = null;
    try {
      stat = await fs.promises.stat(path);
    } catch {}

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

      // jsFilesとcssFilesを再代入可能に変更
      let jsFiles = files.filter((f: string) => f.endsWith('.js'));
      let cssFiles = files.filter((f: string) => f.endsWith('.css'));

      // Next.jsのチャンクファイルや特定のスクリプトを除外
      const excludedJsPatterns = [/\/next\/static\//, /chunk.js$/];
      jsFiles = jsFiles.filter((js: string) => !excludedJsPatterns.some(pattern => pattern.test(js)));

      const excludedCssPatterns = [/\/next\/static\//];
      cssFiles = cssFiles.filter((css: string) => !excludedCssPatterns.some(pattern => pattern.test(css)));

      let cssContent = '';
      for (const css of cssFiles) {
        try {
          const cssPath = path + '/' + css;
          cssContent += await fs.promises.readFile(cssPath, { encoding: 'utf8' }) + '\n';
        } catch (err) {
          console.error(`CSSファイルの読み込みに失敗しました: ${css}`, err);
        }
      }

      const cdnCssLinks = [];
      const linkRegex = /<link[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+)["'][^>]*>/gi;
      let match;
      while ((match = linkRegex.exec(htmlContent)) !== null) {
        cdnCssLinks.push(match[1]);
      }

      // CDNスクリプトやリンクも同様にフィルタリング
      const filteredCdnCssLinks = cdnCssLinks.filter((url: string) => !excludedCssPatterns.some(pattern => pattern.test(url)));

      // フィルタリング後のリンクを使用
      for (const url of filteredCdnCssLinks) {
        try {
          const res = await fetch(url);
          if (res.ok) {
            cssContent += await res.text() + '\n';
          }
        } catch (err) {
          console.error(`CDN CSSのフェッチに失敗しました: ${url}`, err);
        }
      }

      if (cssContent) {
        htmlContent = htmlContent.replace(/<link[^>]*rel=["']stylesheet["'][^>]*>/gi, '');
        htmlContent = htmlContent.replace(/<head>/i, `<head>\n<style>\n${cssContent}\n</style>`);
      }

      let jsContent = '';
      for (const js of jsFiles) {
        try {
          const jsPath = path + '/' + js;
          jsContent += await fs.promises.readFile(jsPath, { encoding: 'utf8' }) + '\n';
        } catch (err) {
          console.error(`JSファイルの読み込みに失敗しました: ${js}`, err);
        }
      }

      const cdnJsLinks = [];
      const scriptRegex = /<script[^>]*src=["']([^"']+)["'][^>]*><\/script>/gi;
      let jsMatch;
      while ((jsMatch = scriptRegex.exec(htmlContent)) !== null) {
        cdnJsLinks.push(jsMatch[1]);
      }

      // CDNスクリプトやリンクも同様にフィルタリング
      const filteredCdnJsLinks = cdnJsLinks.filter((url: string) => !excludedJsPatterns.some(pattern => pattern.test(url)));

      // フィルタリング後のリンクを使用
      for (const url of filteredCdnJsLinks) {
        try {
          const res = await fetch(url);
          if (res.ok) {
            jsContent += await res.text() + '\n';
          }
        } catch (err) {
          console.error(`CDN JSのフェッチに失敗しました: ${url}`, err);
        }
      }
      console.log('jsContent', jsContent);
      if (jsContent) {
        htmlContent = htmlContent.replace(/<script[^>]*src=["'][^"']+["'][^>]*><\/script>/gi, '');
        htmlContent = htmlContent.replace(/<\/body>/i, `<script>
${jsContent}
</script></body>`);
      }

      win.document.open();
      win.document.write(htmlContent);
      win.document.close();
      await writeOutput(`フォルダ内のページが新しいタブで開かれました: ${htmlPath}`);
    } else {
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
