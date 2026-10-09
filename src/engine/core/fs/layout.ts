import type { ProjectFile } from '@/types';
import { HOME_DIR } from '../pathUtils';

export const RUNTIME_CACHE_PATH = `${HOME_DIR}/.cache/pyxis`;
export const NPM_CACHE_PATH = `${HOME_DIR}/.npm`;
export const TMP_PATH = '/tmp';

export function mountRoot(
  path: string,
  mount: NonNullable<ProjectFile['mount']>,
  mtime = 0
): ProjectFile {
  return { path, type: 'folder', size: 0, mtime, mount };
}
