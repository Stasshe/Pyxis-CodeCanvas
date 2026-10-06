export {
  basename,
  getParentPath,
  HOME_DIR,
  isPathWithin,
  normalizePath,
  posixPath,
  resolvePath,
} from '../pathUtils';
export { FsClient, fsClient } from './client';
export { FSError, registerFsErrors } from './errors';
export { NPM_CACHE_PATH, RUNTIME_CACHE_PATH, TMP_PATH } from './layout';
export type { SearchOptions, SearchRequest, SearchResult } from './search';
export type { FsApi, FsChangeEvent, MkdirOptions, RmOptions } from './types';
