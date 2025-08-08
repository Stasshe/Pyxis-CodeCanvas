
// HTML/CSS/JSインライン化処理を切り出し
// files: ディレクトリ内のファイル名配列
// path: ディレクトリパス
// fs: ファイルシステム
// 戻り値: インライン化済みhtmlContent
export const inlineHtmlAssets = async (
  files: string[],
  path: string,
  fs: any
): Promise<string> => {
  // index.htmlまたは最初のhtmlファイルを探す
  let htmlFile = files.find((f) => f.toLowerCase() === 'index.html');
  if (!htmlFile) {
    htmlFile = files.find((f) => f.endsWith('.html'));
  }
  if (!htmlFile) {
    throw new Error('フォルダ内にHTMLファイルがありません。');
  }
  const htmlPath = path + '/' + htmlFile;
  let htmlContent = await fs.promises.readFile(htmlPath, { encoding: 'utf8' });

  // ローカル判定関数
  const isLocal = (src: string) => {
    return src.startsWith('.') || src.startsWith('/') || src.startsWith('..');
  };

  // CSS
  const cssFiles = files.filter((f) => f.endsWith('.css'));
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
  const jsFiles = files.filter((f) => f.endsWith('.js'));
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
    htmlContent = htmlContent.replace(/<\/body>/i, `<script>\n${jsContent}\n<\/script></body>`);
  }

  return htmlContent;
};
