/**
 * [NEW ARCHITECTURE] path モジュールのエミュレーション
 */

import pathBrowserify from 'path-browserify'

export function createPathModule(projectDir: string) {
  return {
    ...pathBrowserify,
    // projectDirを使った独自拡張が必要な場合はここに追加
  }
}
