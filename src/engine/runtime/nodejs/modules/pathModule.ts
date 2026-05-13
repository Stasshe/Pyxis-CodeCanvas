/**
 * path モジュールのエミュレーション
 *
 * path-browserify の resolve() はブラウザの global process.cwd() (= '/') を使うため、
 * ランタイムの cwd を正しく反映しない。getCwd ゲッターで動的にオーバーライドする。
 */

import pathBrowserify from 'path-browserify';

export function createPathModule(getCwd: () => string) {
  return {
    ...pathBrowserify,
    resolve: (...paths: string[]): string => {
      // path-browserify は fallback に global process.cwd() を使うが、
      // ブラウザ環境では '/' になる。代わりに runtime の cwd を先頭に置く。
      return (pathBrowserify.resolve as (...args: string[]) => string)(getCwd(), ...paths);
    },
  };
}
