/**
 * Runtime path module backed by browser path implementations.
 *
 * Resolve operations use the runtime cwd because the browser process cwd is always '/'.
 */

import browserPath from 'path-browserify-win32';

type RuntimePosixPath = typeof browserPath.posix & {
  readonly posix: RuntimePosixPath;
  readonly win32: RuntimeWin32Path;
};
type RuntimeWin32Path = Omit<typeof browserPath.win32, 'posix' | 'win32'> & {
  readonly posix: RuntimePosixPath;
  readonly win32: RuntimeWin32Path;
};
type RuntimePathModule = RuntimePosixPath;

export function createPathModule(getCwd: () => string): RuntimePathModule {
  let runtimePath: RuntimePathModule;
  let runtimeWin32: RuntimeWin32Path;
  runtimeWin32 = {
    ...browserPath.win32,
    get posix() {
      return runtimePath;
    },
    get win32() {
      return runtimeWin32;
    },
    resolve: (...paths: string[]): string => {
      return browserPath.win32.resolve(getCwd(), ...paths);
    },
    relative: (from: string, to: string): string => {
      return browserPath.win32.relative(runtimeWin32.resolve(from), runtimeWin32.resolve(to));
    },
    toNamespacedPath: (path: string): string => {
      if (typeof path !== 'string' || path.length === 0) return path;
      return browserPath.win32.toNamespacedPath(runtimeWin32.resolve(path));
    },
  };
  runtimePath = {
    ...browserPath.posix,
    get posix() {
      return runtimePath;
    },
    get win32() {
      return runtimeWin32;
    },
    resolve: (...paths: string[]): string => {
      return browserPath.posix.resolve(getCwd(), ...paths);
    },
  };
  return runtimePath;
}
