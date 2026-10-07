import { detectFileContent } from '@/engine/core/fileBytes';
import { getParentPath, resolvePath } from '@/engine/core/fs';

const mimeTypes: Record<string, string> = {
  avif: 'image/avif',
  bmp: 'image/bmp',
  css: 'text/css',
  gif: 'image/gif',
  ico: 'image/x-icon',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  js: 'text/javascript',
  mp3: 'audio/mpeg',
  mp4: 'video/mp4',
  ogg: 'audio/ogg',
  pdf: 'application/pdf',
  png: 'image/png',
  svg: 'image/svg+xml',
  wav: 'audio/wav',
  webm: 'video/webm',
  webp: 'image/webp',
};

const toDataUrl = async (path: string, bytes: Uint8Array): Promise<string> => {
  const content = await detectFileContent(path, bytes);
  const extension = path.toLowerCase().split('.').pop() ?? '';
  let mimeType = mimeTypes[extension] ?? 'application/octet-stream';
  if (content.kind === 'binary' && content.mimeType) mimeType = content.mimeType;
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return `data:${mimeType};base64,${btoa(binary)}`;
};

const isLocal = (source: string): boolean =>
  !source.startsWith('//') && !/^[a-z][a-z\d+\-.]*:/i.test(source);

const resolveAssetPath = (source: string, directoryPath: string): string => {
  const filePath = source.split(/[?#]/, 1)[0];
  if (filePath.startsWith('/')) return resolvePath('/', filePath);
  return resolvePath(directoryPath, filePath);
};

const inlineCssAssets = async (
  css: string,
  cssPath: string,
  readBytes: (fullPath: string) => Promise<Uint8Array>
): Promise<string> => {
  const references = [...css.matchAll(/url\((['"]?)(.*?)\1\)/gi)];
  for (const match of references) {
    const source = match[2].trim();
    if (!source || !isLocal(source)) continue;
    try {
      const assetPath = resolveAssetPath(source, getParentPath(cssPath));
      const dataUrl = await toDataUrl(assetPath, await readBytes(assetPath));
      css = css.replace(match[0], `url("${dataUrl}")`);
    } catch (error) {
      console.warn(`[inlineHtmlAssets] Failed to load CSS asset ${source}.`, error);
    }
  }
  return css;
};

export const inlineHtmlAssets = async (
  files: string[],
  path: string,
  fileReader: (fullPath: string) => Promise<Uint8Array>,
  requestedHtmlFile?: string
): Promise<string> => {
  const htmlFile =
    requestedHtmlFile ??
    files.find(file => file.toLowerCase() === 'index.html') ??
    files.find(file => file.toLowerCase().endsWith('.html'));
  if (!htmlFile) throw new Error('The directory does not contain an HTML file.');

  const htmlPath = resolvePath(path, htmlFile);
  const directoryPath = htmlPath.slice(0, htmlPath.lastIndexOf('/')) || '/';
  const readText = async (fullPath: string): Promise<string> =>
    new TextDecoder().decode(await fileReader(fullPath));
  let html = await readText(htmlPath);

  const getAttribute = (tag: string, name: string): string | null => {
    const attribute = tag.match(new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, 'i'));
    return attribute?.[2] ?? null;
  };

  const stylesheetTags = [...html.matchAll(/<link\b[^>]*>\s*/gi)];
  for (const match of stylesheetTags) {
    const tag = match[0];
    if (getAttribute(tag, 'rel')?.toLowerCase() !== 'stylesheet') continue;
    const source = getAttribute(tag, 'href');
    if (!source || !isLocal(source)) continue;
    try {
      const cssPath = resolveAssetPath(source, directoryPath);
      const css = await inlineCssAssets(await readText(cssPath), cssPath, fileReader);
      html = html.replace(tag, `<style>\n${css}\n</style>`);
    } catch (error) {
      console.warn(`[inlineHtmlAssets] Failed to load stylesheet ${source}.`, error);
    }
  }

  const scriptTags = [...html.matchAll(/<script\b[^>]*src=["'][^"']+["'][^>]*>\s*<\/script>\s*/gi)];
  for (const match of scriptTags) {
    const tag = match[0];
    const source = getAttribute(tag, 'src');
    if (!source || !isLocal(source)) continue;
    try {
      const scriptPath = resolveAssetPath(source, directoryPath);
      const script = await readText(scriptPath);
      html = html.replace(tag, `<script>\n${script}\n</script>`);
    } catch (error) {
      console.warn(`[inlineHtmlAssets] Failed to load script ${source}.`, error);
    }
  }

  const assetAttributes = /\b(src|poster)=(['"])(.*?)\2/gi;
  const matches = [...html.matchAll(assetAttributes)];
  for (const match of matches) {
    const source = match[3];
    if (!source || !isLocal(source)) continue;
    try {
      const assetPath = resolveAssetPath(source, directoryPath);
      const dataUrl = await toDataUrl(assetPath, await fileReader(assetPath));
      html = html.replace(match[0], `${match[1]}=${match[2]}${dataUrl}${match[2]}`);
    } catch (error) {
      console.warn(`[inlineHtmlAssets] Failed to load HTML asset ${source}.`, error);
    }
  }
  return html;
};
