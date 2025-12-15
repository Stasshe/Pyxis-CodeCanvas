/**
 * pathResolver.ts - Pyxisにおけるパス解決の統一モジュール
 *
 * パスの種類:
 * 1. AppPath (Application Path)
 *    - FileRepositoryで使用するパス形式
 *    - 先頭スラッシュ付き、末尾スラッシュなし
 *    - 例: "/src/hello.ts", "/", "/folder"
 *
 * 2. GitPath (Git/Lightning-FS Path)
 *    - Git操作やlightning-fsで使用するパス形式
 *    - 先頭スラッシュなし（プロジェクトルートからの相対パス）
 *    - 例: "src/hello.ts", ".", "folder"
 *
 * 3. FSPath (FileSystem Absolute Path)
 *    - lightning-fsのファイルシステム内での絶対パス
 *    - /projects/{projectName}/... 形式
 *    - 例: "/projects/MyProject/src/hello.ts"
 *
 * 設計原則:
 * - 各変換関数は冪等（同じ入力に対して常に同じ出力）
 * - エッジケース（空文字、null、undefined）を安全に処理
 * - パス区切りは常に / を使用
 */

// ========================================
// 型定義
// ========================================

/**
 * パスの種類を表す型（ドキュメント目的）
 * 実行時には string として扱う
 */
export type AppPath = string
export type GitPath = string
export type FSPath = string

// ========================================
// 基本的な正規化関数
// ========================================

/**
 * AppPath形式に正規化する
 * - 先頭にスラッシュを付与
 * - 末尾のスラッシュを除去（ルート除く）
 * - 連続スラッシュを単一化
 * - . や .. は解決しない（resolvePathで行う）
 *
 * @example
 * toAppPath("src/hello.ts") → "/src/hello.ts"
 * toAppPath("/src/hello.ts") → "/src/hello.ts"
 * toAppPath("src/") → "/src"
 * toAppPath("") → "/"
 * toAppPath(null) → "/"
 */
export function toAppPath(path: string | null | undefined): AppPath {
  if (!path || path === '') return '/'

  // 連続スラッシュを単一化
  let normalized = path.replace(/\/+/g, '/')

  // 先頭にスラッシュを追加
  if (!normalized.startsWith('/')) {
    normalized = '/' + normalized
  }

  // 末尾のスラッシュを除去（ルート以外）
  if (normalized !== '/' && normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1)
  }

  return normalized
}

/**
 * GitPath形式に変換する
 * - 先頭のスラッシュを除去
 * - ルートは "." で表現
 *
 * @example
 * toGitPath("/src/hello.ts") → "src/hello.ts"
 * toGitPath("/") → "."
 * toGitPath("src/hello.ts") → "src/hello.ts"
 */
export function toGitPath(path: string | null | undefined): GitPath {
  const appPath = toAppPath(path)

  if (appPath === '/') return '.'

  // 先頭スラッシュを除去
  return appPath.substring(1)
}

/**
 * GitPath形式からAppPath形式に変換
 *
 * @example
 * fromGitPath("src/hello.ts") → "/src/hello.ts"
 * fromGitPath(".") → "/"
 * fromGitPath("") → "/"
 */
export function fromGitPath(path: string | null | undefined): AppPath {
  if (!path || path === '.' || path === './') return '/'

  return toAppPath(path)
}

// ========================================
// FSPath（ファイルシステム絶対パス）関連
// ========================================

const PROJECTS_BASE = '/projects'

/**
 * プロジェクトのルートディレクトリパスを取得
 *
 * @example
 * getProjectRoot("MyProject") → "/projects/MyProject"
 */
export function getProjectRoot(projectName: string): FSPath {
  return `${PROJECTS_BASE}/${projectName}`
}

/**
 * FSPath形式に変換（プロジェクト名 + AppPath → FSPath）
 *
 * @example
 * toFSPath("MyProject", "/src/hello.ts") → "/projects/MyProject/src/hello.ts"
 * toFSPath("MyProject", "/") → "/projects/MyProject"
 */
export function toFSPath(projectName: string, appPath: string | null | undefined): FSPath {
  const normalized = toAppPath(appPath)
  const projectRoot = getProjectRoot(projectName)

  if (normalized === '/') {
    return projectRoot
  }

  // AppPathは既に先頭スラッシュ付きなのでそのまま結合
  return `${projectRoot}${normalized}`
}

/**
 * FSPathからAppPathを抽出
 *
 * @example
 * fsPathToAppPath("/projects/MyProject/src/hello.ts", "MyProject") → "/src/hello.ts"
 * fsPathToAppPath("/projects/MyProject", "MyProject") → "/"
 */
export function fsPathToAppPath(fsPath: string, projectName: string): AppPath {
  const projectRoot = getProjectRoot(projectName)

  if (fsPath === projectRoot) {
    return '/'
  }

  if (fsPath.startsWith(projectRoot + '/')) {
    return toAppPath(fsPath.substring(projectRoot.length))
  }

  // プロジェクトルートと一致しない場合はそのまま返す（フォールバック）
  return toAppPath(fsPath)
}

/**
 * FSPathが指定プロジェクト内かチェック
 */
export function isWithinProject(fsPath: string, projectName: string): boolean {
  const projectRoot = getProjectRoot(projectName)
  return fsPath === projectRoot || fsPath.startsWith(projectRoot + '/')
}

// ========================================
// パス操作ユーティリティ
// ========================================

/**
 * パスの親ディレクトリを取得
 *
 * @example
 * getParentPath("/src/hello.ts") → "/src"
 * getParentPath("/hello.ts") → "/"
 * getParentPath("/") → "/"
 */
export function getParentPath(path: string | null | undefined): AppPath {
  const normalized = toAppPath(path)

  if (normalized === '/') return '/'

  const lastSlash = normalized.lastIndexOf('/')
  if (lastSlash === 0) return '/'

  return normalized.substring(0, lastSlash)
}

/**
 * パスのファイル名部分を取得
 *
 * @example
 * getFileName("/src/hello.ts") → "hello.ts"
 * getFileName("/hello.ts") → "hello.ts"
 * getFileName("/") → ""
 */
export function getFileName(path: string | null | undefined): string {
  const normalized = toAppPath(path)

  if (normalized === '/') return ''

  const lastSlash = normalized.lastIndexOf('/')
  return normalized.substring(lastSlash + 1)
}

/**
 * パスを結合
 *
 * @example
 * joinPath("/src", "hello.ts") → "/src/hello.ts"
 * joinPath("/src/", "/hello.ts") → "/src/hello.ts"
 * joinPath("/", "src") → "/src"
 */
export function joinPath(basePath: string, ...paths: string[]): AppPath {
  let result = toAppPath(basePath)

  for (const path of paths) {
    if (!path) continue

    // 結合するパスが絶対パスの場合
    if (path.startsWith('/')) {
      result = toAppPath(path)
    } else {
      // 相対パスの場合は結合
      result = toAppPath(result === '/' ? `/${path}` : `${result}/${path}`)
    }
  }

  return result
}

/**
 * 相対パスを絶対パスに解決（. と .. を処理）
 *
 * @example
 * resolvePath("/src", "./hello.ts") → "/src/hello.ts"
 * resolvePath("/src/sub", "../hello.ts") → "/src/hello.ts"
 * resolvePath("/src", "hello.ts") → "/src/hello.ts"
 * resolvePath("/src", "/absolute") → "/absolute"
 */
export function resolvePath(basePath: string, relativePath: string): AppPath {
  // 絶対パスの場合はそのまま正規化して返す
  if (relativePath.startsWith('/')) {
    return normalizeDotSegments(toAppPath(relativePath))
  }

  // 相対パスの場合は結合してから解決
  const combined = joinPath(basePath, relativePath)
  return normalizeDotSegments(combined)
}

/**
 * パス中の . と .. を解決
 *
 * @example
 * normalizeDotSegments("/src/./hello.ts") → "/src/hello.ts"
 * normalizeDotSegments("/src/../hello.ts") → "/hello.ts"
 * normalizeDotSegments("/src/sub/../../hello.ts") → "/hello.ts"
 */
export function normalizeDotSegments(path: string): AppPath {
  const normalized = toAppPath(path)
  const segments = normalized.split('/').filter(s => s !== '')
  const result: string[] = []

  for (const segment of segments) {
    if (segment === '.') {
      // カレントディレクトリ: スキップ
      continue
    } else if (segment === '..') {
      // 親ディレクトリ: 1つ戻る（ルートを超えない）
      if (result.length > 0) {
        result.pop()
      }
    } else {
      result.push(segment)
    }
  }

  return '/' + result.join('/')
}

// ========================================
// 後方互換性のためのエイリアス
// ========================================

/**
 * @deprecated toAppPath を使用してください
 */
export const normalizePath = toAppPath

// ========================================
// パス検証ユーティリティ
// ========================================

/**
 * パスがルートかチェック
 */
export function isRoot(path: string | null | undefined): boolean {
  return toAppPath(path) === '/'
}

/**
 * パスが指定されたプレフィックスで始まるかチェック
 * （両方正規化してから比較）
 *
 * @example
 * hasPrefix("/src/hello.ts", "/src") → true
 * hasPrefix("/src/hello.ts", "/src/") → true
 * hasPrefix("/other/hello.ts", "/src") → false
 */
export function hasPrefix(path: string, prefix: string): boolean {
  const normalizedPath = toAppPath(path)
  const normalizedPrefix = toAppPath(prefix)

  if (normalizedPrefix === '/') return true

  return normalizedPath === normalizedPrefix || normalizedPath.startsWith(normalizedPrefix + '/')
}

/**
 * パスからプレフィックスを除去
 *
 * @example
 * removePrefix("/src/hello.ts", "/src") → "/hello.ts"
 * removePrefix("/src/hello.ts", "/") → "/src/hello.ts"
 */
export function removePrefix(path: string, prefix: string): AppPath {
  const normalizedPath = toAppPath(path)
  const normalizedPrefix = toAppPath(prefix)

  if (normalizedPrefix === '/') return normalizedPath

  if (normalizedPath === normalizedPrefix) return '/'

  if (normalizedPath.startsWith(normalizedPrefix + '/')) {
    return toAppPath(normalizedPath.substring(normalizedPrefix.length))
  }

  return normalizedPath
}
