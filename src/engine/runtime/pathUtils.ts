/**
 * Path Utilities
 *
 * パス操作のユーティリティ関数
 */

/**
 * パスを正規化
 * - `/projects/{projectName}/` プレフィックスを削除
 * - 連続するスラッシュを1つに
 * - 末尾のスラッシュを削除
 *
 * @example
 * normalizePath('/projects/new/src/index.js', 'new') // → '/src/index.js'
 * normalizePath('/projects/new/node_modules/chalk/index.js', 'new') // → '/node_modules/chalk/index.js'
 * normalizePath('//src//index.js', 'new') // → '/src/index.js'
 */
export function normalizePath(path: string, projectName?: string): string {
  let normalized = path;

  // プロジェクトプレフィックスを削除
  if (projectName) {
    const prefix = `/projects/${projectName}`;
    if (normalized.startsWith(prefix)) {
      normalized = normalized.slice(prefix.length);
    }
  }

  // 連続するスラッシュを1つに
  normalized = normalized.replace(/\/+/g, '/');

  // 末尾のスラッシュを削除（ルート以外）
  if (normalized !== '/' && normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1);
  }

  // 空の場合はルートに
  if (normalized === '') {
    normalized = '/';
  }

  return normalized;
}

/**
 * パスの拡張子を取得
 *
 * @example
 * getExtension('/src/index.js') // → '.js'
 * getExtension('/src/component.tsx') // → '.tsx'
 */
export function getExtension(path: string): string {
  const match = path.match(/\.[^./]+$/);
  return match ? match[0] : '';
}

/**
 * パスの拡張子を変更
 *
 * @example
 * replaceExtension('/src/index.ts', '.js') // → '/src/index.js'
 */
export function replaceExtension(path: string, newExt: string): string {
  const ext = getExtension(path);
  if (ext) {
    return path.slice(0, -ext.length) + newExt;
  }
  return path + newExt;
}

/**
 * パスからディレクトリ部分を取得
 *
 * @example
 * dirname('/src/utils/helper.js') // → '/src/utils'
 * dirname('/index.js') // → '/'
 */
export function dirname(path: string): string {
  const parts = path.split('/');
  parts.pop();
  return parts.join('/') || '/';
}

/**
 * パスからファイル名を取得
 *
 * @example
 * basename('/src/utils/helper.js') // → 'helper.js'
 * basename('/src/utils/helper.js', '.js') // → 'helper'
 */
export function basename(path: string, ext?: string): string {
  const parts = path.split('/');
  let name = parts[parts.length - 1] || '';
  
  if (ext && name.endsWith(ext)) {
    name = name.slice(0, -ext.length);
  }
  
  return name;
}

/**
 * 相対パスを絶対パスに変換
 *
 * @example
 * resolveRelative('/src/index.js', './utils/helper.js') // → '/src/utils/helper.js'
 * resolveRelative('/src/index.js', '../lib/tools.js') // → '/lib/tools.js'
 */
export function resolveRelative(basePath: string, relativePath: string): string {
  // 既に絶対パスなら返す
  if (relativePath.startsWith('/')) {
    return relativePath;
  }

  const baseDir = dirname(basePath);
  const parts = baseDir.split('/').filter(Boolean);
  const relParts = relativePath.split('/');

  for (const part of relParts) {
    if (part === '.') {
      // カレントディレクトリ（何もしない）
      continue;
    } else if (part === '..') {
      // 親ディレクトリ
      parts.pop();
    } else {
      // 通常のパス
      parts.push(part);
    }
  }

  return '/' + parts.join('/');
}

/**
 * パスが特定のディレクトリ配下にあるか判定
 *
 * @example
 * isUnder('/src/utils/helper.js', '/src') // → true
 * isUnder('/lib/tools.js', '/src') // → false
 */
export function isUnder(path: string, dir: string): boolean {
  const normalizedPath = normalizePath(path);
  const normalizedDir = normalizePath(dir);
  
  return normalizedPath.startsWith(normalizedDir + '/') || normalizedPath === normalizedDir;
}
