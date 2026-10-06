import { fsClient } from '@/engine/core/fs';

/** Import a browser file at its absolute filesystem path. */
export async function importSingleFile(file: File, targetPath: string): Promise<void> {
  await fsClient.writeFile(targetPath, new Uint8Array(await file.arrayBuffer()));
}
