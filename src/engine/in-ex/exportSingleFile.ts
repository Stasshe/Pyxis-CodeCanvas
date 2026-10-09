import { basename, fsClient } from '@/engine/core/fs';

export async function exportSingleFile(path: string): Promise<void> {
  const content = await fsClient.readFile(path);
  const blob = new Blob([Uint8Array.from(content).buffer], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = basename(path);
  document.body.appendChild(anchor);
  anchor.click();
  setTimeout(() => {
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }, 100);
}
