import { fromHtml } from 'hast-util-from-html';
import { toHtml } from 'hast-util-to-html';
import { detectFileContent } from '@/engine/core/fileBytes';
import { getParentPath, resolvePath } from '@/engine/core/fs/index';

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

const escapeRawTextEndTag = (content: string, tagName: 'script' | 'style'): string =>
  content.replace(new RegExp(`</${tagName}`, 'gi'), `<\\/${tagName}`);

const inlineCssAssets = async (
  css: string,
  cssPath: string,
  readBytes: (fullPath: string) => Promise<Uint8Array>,
  onDependency?: (fullPath: string) => void
): Promise<string> => {
  const references = [...css.matchAll(/url\((['"]?)(.*?)\1\)/gi)];
  for (const match of references) {
    const source = match[2].trim();
    if (!source || !isLocal(source)) continue;
    try {
      const assetPath = resolveAssetPath(source, getParentPath(cssPath));
      onDependency?.(assetPath);
      const dataUrl = await toDataUrl(assetPath, await readBytes(assetPath));
      css = css.replace(match[0], `url("${dataUrl}")`);
    } catch (error) {
      console.warn(`[inlineHtmlAssets] Failed to load CSS asset ${source}.`, error);
    }
  }
  return css;
};

type HtmlRoot = ReturnType<typeof fromHtml>;
type HtmlElement = Extract<HtmlRoot['children'][number], { type: 'element' }>;
type HtmlParent = HtmlRoot | HtmlElement;

const inlineHtmlAssetsInTree = async (
  parent: HtmlParent,
  directoryPath: string,
  readBytes: (fullPath: string) => Promise<Uint8Array>,
  readText: (fullPath: string) => Promise<string>,
  onDependency?: (fullPath: string) => void
): Promise<void> => {
  for (const child of parent.children) {
    if (child.type !== 'element') continue;
    const element = child;

    if (element.tagName === 'link') {
      const rel = element.properties.rel;
      const isStylesheet =
        Array.isArray(rel) && rel.some(value => value.toLowerCase() === 'stylesheet');
      const source = element.properties.href;
      if (isStylesheet && typeof source === 'string' && isLocal(source)) {
        try {
          const cssPath = resolveAssetPath(source, directoryPath);
          onDependency?.(cssPath);
          const css = await inlineCssAssets(
            await readText(cssPath),
            cssPath,
            readBytes,
            onDependency
          );
          element.tagName = 'style';
          delete element.properties.rel;
          delete element.properties.href;
          element.children = [{ type: 'text', value: escapeRawTextEndTag(css, 'style') }];
        } catch (error) {
          console.warn(`[inlineHtmlAssets] Failed to load stylesheet ${source}.`, error);
        }
      }
    } else if (element.tagName === 'script') {
      const source = element.properties.src;
      if (typeof source === 'string' && isLocal(source)) {
        try {
          const scriptPath = resolveAssetPath(source, directoryPath);
          onDependency?.(scriptPath);
          const script = await readText(scriptPath);
          delete element.properties.src;
          element.children = [{ type: 'text', value: escapeRawTextEndTag(script, 'script') }];
        } catch (error) {
          console.warn(`[inlineHtmlAssets] Failed to load script ${source}.`, error);
        }
      }
    } else {
      for (const attribute of ['src', 'poster'] as const) {
        const source = element.properties[attribute];
        if (typeof source !== 'string' || !source || !isLocal(source)) continue;
        try {
          const assetPath = resolveAssetPath(source, directoryPath);
          onDependency?.(assetPath);
          element.properties[attribute] = await toDataUrl(assetPath, await readBytes(assetPath));
        } catch (error) {
          console.warn(`[inlineHtmlAssets] Failed to load HTML asset ${source}.`, error);
        }
      }
    }

    await inlineHtmlAssetsInTree(element, directoryPath, readBytes, readText, onDependency);
    if (element.content) {
      await inlineHtmlAssetsInTree(
        element.content,
        directoryPath,
        readBytes,
        readText,
        onDependency
      );
    }
  }
};

export const inlineHtmlAssets = async (
  files: string[],
  path: string,
  fileReader: (fullPath: string) => Promise<Uint8Array>,
  requestedHtmlFile?: string,
  onDependency?: (fullPath: string) => void
): Promise<string> => {
  const htmlFile =
    requestedHtmlFile ??
    files.find(file => file.toLowerCase() === 'index.html') ??
    files.find(file => file.toLowerCase().endsWith('.html'));
  if (!htmlFile) throw new Error('The directory does not contain an HTML file.');

  const htmlPath = resolvePath(path, htmlFile);
  const directoryPath = getParentPath(htmlPath);
  onDependency?.(htmlPath);
  const readText = async (fullPath: string): Promise<string> =>
    new TextDecoder().decode(await fileReader(fullPath));
  const tree = fromHtml(await readText(htmlPath));
  await inlineHtmlAssetsInTree(tree, directoryPath, fileReader, readText, onDependency);
  return toHtml(tree);
};
