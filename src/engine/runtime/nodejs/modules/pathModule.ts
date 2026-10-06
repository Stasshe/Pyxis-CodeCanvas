/**
 * POSIX path module backed by path-browserify.
 *
 * Runtime resolve uses the current cwd because the browser process cwd is always '/'.
 */

import { posixPath } from '@/engine/core/pathUtils';

type RuntimePathModule = typeof posixPath & { readonly posix: RuntimePathModule };

export function createPathModule(getCwd: () => string): RuntimePathModule {
  let runtimePath: RuntimePathModule;
  runtimePath = {
    ...posixPath,
    get posix() {
      return runtimePath;
    },
    resolve: (...paths: string[]): string => {
      return posixPath.resolve(getCwd(), ...paths);
    },
  };
  return runtimePath;
}
