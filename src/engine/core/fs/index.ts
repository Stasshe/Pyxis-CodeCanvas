export {
  basename,
  getParentPath,
  HOME_DIR,
  isPathWithin,
  normalizePath,
  posixPath,
  resolvePath,
} from '../paths';
export { FsClient, fsClient } from './client';
export { FSError, registerFsErrors } from './errors';
export { NPM_CACHE_PATH, RUNTIME_CACHE_PATH, TMP_PATH } from './layout';
export type { OwnerAwareFsApi, ScopedFsApi } from './scoped';
export type { SearchOptions, SearchRequest, SearchResult } from './search';
export type {
  FifoMode,
  FifoOpenOptions,
  FsApi,
  FsChangeEvent,
  FsFifoApi,
  MkdirOptions,
  PipePaths,
  RenameOptions,
  RmOptions,
} from './types';
export { getFifoApi } from './types';
