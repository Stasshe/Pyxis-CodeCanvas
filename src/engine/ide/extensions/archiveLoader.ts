import { detectFileContent } from '@/engine/core/fileBytes';
import { uint8ToBlob } from './binaryData';
import { isExtensionManifest } from './extensionLoader';
import type { ExtensionManifest } from './types';

export interface ExtensionArchive {
  manifest: ExtensionManifest;
  entryCode: string;
  files?: Record<string, string | Blob>;
}

export async function loadExtensionArchive(file: File | Blob): Promise<ExtensionArchive> {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  let manifestPath: string | null = zip.file('manifest.json') ? 'manifest.json' : null;
  if (!manifestPath) {
    zip.forEach(path => {
      if (!manifestPath && path.toLowerCase().endsWith('manifest.json')) manifestPath = path;
    });
  }
  if (!manifestPath) throw new Error('manifest.json not found inside ZIP');

  const manifestText = await zip.file(manifestPath)?.async('string');
  const value: unknown = JSON.parse(manifestText ?? '');
  if (!isExtensionManifest(value)) {
    throw new Error('Invalid manifest.json: expected a complete extension manifest');
  }
  const manifest = value;
  const manifestDir = manifestPath.includes('/')
    ? manifestPath.slice(0, manifestPath.lastIndexOf('/'))
    : '';
  const resolveZipPath = (paths: string[]) => {
    for (const path of paths) {
      const normalized = path.replace(/^\.\//, '');
      if (zip.file(normalized)) return normalized;
      const nested = manifestDir ? `${manifestDir}/${normalized}` : '';
      if (nested && zip.file(nested)) return nested;
    }
    return null;
  };

  const entryPath = resolveZipPath([
    manifest.entry,
    `./${manifest.entry}`,
    manifest.entry.replace(/^\//, ''),
  ]);
  if (!entryPath) throw new Error(`Entry file not found in ZIP: ${manifest.entry}`);
  const entry = zip.file(entryPath);
  if (!entry) throw new Error(`Entry file not found in ZIP: ${manifest.entry}`);
  const entryCode = new TextDecoder('utf-8', { fatal: true }).decode(
    await entry.async('uint8array')
  );
  manifest.entry = relativeToManifest(manifestDir, entryPath);

  const files: Record<string, string | Blob> = {};
  for (const filePath of manifest.files ?? []) {
    const resolved = resolveZipPath([filePath, `./${filePath}`, filePath.replace(/^\//, '')]);
    if (!resolved) throw new Error(`File listed in manifest.files not found in ZIP: ${filePath}`);
    const asset = zip.file(resolved);
    if (!asset) throw new Error(`Extension asset not found in ZIP: ${filePath}`);
    const bytes = await asset.async('uint8array');
    const content = await detectFileContent(filePath, bytes);
    const key = filePath.replace(/^\.\//, '').replace(/^\//, '');
    files[key] =
      content.kind === 'binary' ? uint8ToBlob(bytes, filePath, content.mimeType) : content.content;
  }

  return { manifest, entryCode, files: Object.keys(files).length ? files : undefined };
}

function relativeToManifest(manifestDir: string, path: string): string {
  return manifestDir && path.startsWith(`${manifestDir}/`)
    ? path.slice(manifestDir.length + 1)
    : path;
}
