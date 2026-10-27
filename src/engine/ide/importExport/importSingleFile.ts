import { fsClient, getParentPath } from '@/engine/core/fs/index';

/** Import a browser file at its absolute filesystem path. */
export async function importSingleFile(
  file: File,
  targetPath: string,
  destinationExistsMessage: string,
  isCurrentWorkspace: () => boolean = () => true,
  workspaceChangedMessage = 'Workspace changed while importing files.'
): Promise<void> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!isCurrentWorkspace()) throw new Error(workspaceChangedMessage);
  if (await fsClient.exists(targetPath)) {
    throw new Error(destinationExistsMessage);
  }
  if (!isCurrentWorkspace()) throw new Error(workspaceChangedMessage);
  await fsClient.mkdir(getParentPath(targetPath), { recursive: true });
  if (!isCurrentWorkspace()) throw new Error(workspaceChangedMessage);
  await fsClient.writeRange(targetPath, bytes, null, true, true);
}
