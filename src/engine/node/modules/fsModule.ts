/**
 * [NEW ARCHITECTURE] fs モジュールのエミュレーション
 * - fileRepositoryを直接使用してIndexedDBに保存
 * - GitFileSystemへの同期は自動的に実行される
 * - 読み取りはgitFileSystem.getFS()から直接実行
 * - 書き込みはfileRepositoryのみを使用（自動同期）
 */

import { fileRepository } from '@/engine/core/fileRepository'
import {
  toAppPath,
  toFSPath,
  fsPathToAppPath,
  normalizeDotSegments,
} from '@/engine/core/pathResolver'

export interface FSModuleOptions {
  projectDir: string
  projectId: string
  projectName: string
}

export function createFSModule(options: FSModuleOptions) {
  const { projectDir, projectId, projectName } = options

  /**
   * パスを正規化してフルパスと相対パス（AppPath）を取得
   * pathResolverを使用
   * POSIX準拠: . と .. を解決
   */
  function normalizeModulePath(path: string): { fullPath: string; relativePath: string } {
    // すでにprojectDirで始まる場合（FSPath形式）
    if (path.startsWith(projectDir)) {
      const relativePath = fsPathToAppPath(path, projectName)
      // . と .. を解決
      const resolvedPath = normalizeDotSegments(relativePath)
      return {
        fullPath: toFSPath(projectName, resolvedPath),
        relativePath: resolvedPath,
      }
    }

    // AppPath形式またはGitPath形式の場合
    // まずAppPath形式に変換し、. と .. を解決
    const appPath = normalizeDotSegments(toAppPath(path))
    return {
      fullPath: toFSPath(projectName, appPath),
      relativePath: appPath,
    }
  }

  /**
   * ファイルを書き込む（IndexedDBに保存し、自動的にGitFileSystemに同期）
   * [NEW ARCHITECTURE] GitFileSystemへの直接書き込みは不要
   */
  async function handleWriteFile(
    path: string,
    data: string | Uint8Array,
    isNodeRuntime: boolean = true
  ): Promise<void> {
    // projectIdのバリデーション
    if (!projectId || typeof projectId !== 'string') {
      console.error('[fsModule] Invalid projectId:', projectId)
      throw new Error(`Invalid projectId: ${projectId}`)
    }

    const { relativePath } = normalizeModulePath(path)

    // 親ディレクトリをIndexedDBに作成
    const parentPath = relativePath.substring(0, relativePath.lastIndexOf('/'))
    if (parentPath) {
      try {
        // Prefer direct lookup of the parent folder instead of listing all files
        const folder = await fileRepository.getFileByPath(projectId, parentPath)
        const folderExists = folder && folder.type === 'folder'
        if (!folderExists) {
          await fileRepository.createFile(projectId, parentPath, '', 'folder')
        }
      } catch (error) {
        console.error('[fsModule] Failed to create parent directory in IndexedDB:', error)
      }
    }

    // IndexedDBに保存（自動的にGitFileSystemに同期される）
    try {
      const existingFile = await fileRepository.getFileByPath(projectId, relativePath)

      if (existingFile) {
        // 既存ファイルを更新
        const content = typeof data === 'string' ? data : ''
        const bufferContent =
          typeof data === 'string'
            ? undefined
            : data.buffer instanceof ArrayBuffer
              ? data.buffer
              : undefined

        await fileRepository.saveFile({
          ...existingFile,
          content,
          bufferContent,
          updatedAt: new Date(),
        })
      } else {
        // 新規ファイルを作成
        const content = typeof data === 'string' ? data : ''
        const isBufferArray = typeof data !== 'string'
        const bufferContent =
          isBufferArray && data.buffer instanceof ArrayBuffer ? data.buffer : undefined

        await fileRepository.createFile(
          projectId,
          relativePath,
          content,
          'file',
          isBufferArray,
          bufferContent
        )
      }
    } catch (error) {
      console.error('[fsModule] Failed to save file to IndexedDB:', error)
      throw error
    }
  }

  // メモリキャッシュ（同期読み込み用）
  const memoryCache = new Map<string, string | Uint8Array>()

  const fsModule = {
    /**
     * ファイルを読み取る
     */
    readFile: async (path: string, options?: any): Promise<string | Uint8Array> => {
      try {
        const { relativePath } = normalizeModulePath(path)

        // キャッシュにあればそれを返す
        if (memoryCache.has(relativePath)) {
          const content = memoryCache.get(relativePath)!
          if (options && options.encoding === null) {
            const encoder = new TextEncoder()
            return typeof content === 'string' ? encoder.encode(content) : content
          }
          return content
        }

        const file = await fileRepository.getFileByPath(projectId, relativePath)
        if (!file) throw new Error(`File not found: ${path}`)
        const content = file.content ?? ''

        // キャッシュ更新
        memoryCache.set(relativePath, content)

        if (options && options.encoding === null) {
          const encoder = new TextEncoder()
          return encoder.encode(content)
        }
        return content
      } catch (error) {
        throw new Error(`ファイルの読み取りに失敗しました: ${path} - ${(error as Error).message}`)
      }
    },

    /**
     * ファイルに書き込む
     */
    writeFile: async (path: string, data: string | Uint8Array, options?: any): Promise<void> => {
      try {
        const { relativePath } = normalizeModulePath(path)

        // キャッシュ更新
        const content = typeof data === 'string' ? data : new TextDecoder().decode(data)
        memoryCache.set(relativePath, content) // Note: storing string in cache for simplicity if possible, or raw data

        await handleWriteFile(path, data, true)
      } catch (error) {
        throw new Error(`ファイルの書き込みに失敗しました: ${path}`)
      }
    },

    /**
     * ファイルを同期的に読み取る
     * 事前にpreloadFiles()でキャッシュにロードしておく必要がある
     */
    readFileSync: (path: string, options?: any): string | Uint8Array => {
      const { relativePath } = normalizeModulePath(path)

      if (memoryCache.has(relativePath)) {
        const content = memoryCache.get(relativePath)!
        if (options && options.encoding === null) {
          const encoder = new TextEncoder()
          return typeof content === 'string' ? encoder.encode(content) : content
        }
        return content
      }

      console.warn(
        `⚠️  fs.readFileSync: File not in cache: ${path} (normalized: ${relativePath}). Returning Promise (will likely fail for sync callers). Call preloadFiles() first.`
      )
      // Fallback to async (will break strict sync callers like yargs/JSON.parse)
      return fsModule.readFile(path, options) as any
    },

    /**
     * ファイルに同期的に書き込む（非同期に変換）
     */
    writeFileSync: (path: string, data: string | Uint8Array, options?: any): void => {
      console.warn('⚠️  fs.writeFileSync detected: Converting to async operation (fire and forget).')
      fsModule.writeFile(path, data, options).catch(err => console.error(err))
    },

    /**
     * ファイル/ディレクトリの存在を確認
     */
    existsSync: (path: string): boolean => {
      const { relativePath } = normalizeModulePath(path)
      // Check cache first
      if (memoryCache.has(relativePath)) return true

      // Hack: we can't check IndexedDB synchronously if not in cache.
      // We assume if it's not in cache (and we preloaded), it might not exist or we don't know.
      // But for yargs, it checks existence.
      // If we preloaded everything, cache miss = not found.
      return false
    },

    /**
     * ファイルをプリロード（メモリキャッシュにロード）
     */
    preloadFiles: async (extensions: string[] = ['.json', '.txt', '.md']): Promise<void> => {
      try {
        // 全ファイルをロード（フィルタリング付き）
        // getProjectFilesは再帰的に全ファイルを取得すると仮定
        // TODO: 全ファイルは非効率。ライブでやる感じに変える。とりあえず今は動いてる。
        const files = await fileRepository.getProjectFiles(projectId)
        let count = 0
        for (const file of files) {
          // 拡張子フィルタ（空の場合は全ファイル）
          if (extensions.length === 0 || extensions.some(ext => file.path.endsWith(ext))) {
            if (file.content !== undefined) {
              memoryCache.set(file.path, file.content)
              count++
            }
          }
        }
        console.log(`[fsModule] Preloaded ${count} files into memory cache.`)
      } catch (error) {
        console.error('[fsModule] Failed to preload files:', error)
      }
    },

    /**
     * ファイルに非同期で書き込む
     */
    asyncWriteFile: async (
      path: string,
      data: string | Uint8Array,
      options?: any
    ): Promise<void> => {
      await fsModule.writeFile(path, data, options)
    },

    /**
     * ファイルを非同期で読み取る
     */
    asyncReadFile: async (path: string, options?: any): Promise<string | Uint8Array> => {
      return await fsModule.readFile(path, options)
    },

    /**
     * ファイルを非同期で削除
     */
    asyncRemoveFile: async (path: string): Promise<void> => {
      await fsModule.unlink(path)
    },

    /**
     * ディレクトリを作成
     * [NEW ARCHITECTURE] IndexedDBに保存すれば自動的にGitFileSystemに同期される
     */
    mkdir: async (path: string, options?: any): Promise<void> => {
      const { relativePath } = normalizeModulePath(path)
      const recursive = options?.recursive || false

      try {
        if (recursive) {
          // 再帰的にディレクトリを作成 - check each path with targeted lookup
          const parts = relativePath.split('/').filter(Boolean)
          let currentPath = ''

          for (const part of parts) {
            currentPath += `/${part}`
            const folder = await fileRepository.getFileByPath(projectId, currentPath)
            const folderExists = folder && folder.type === 'folder'

            if (!folderExists) {
              await fileRepository.createFile(projectId, currentPath, '', 'folder')
            }
          }
        } else {
          // 単一ディレクトリを作成
          const folder = await fileRepository.getFileByPath(projectId, relativePath)
          const folderExists = folder && folder.type === 'folder'

          if (!folderExists) {
            await fileRepository.createFile(projectId, relativePath, '', 'folder')
          }
        }
      } catch (error) {
        console.error('[fsModule] Failed to create directory in IndexedDB:', error)
        throw error
      }
    },

    /**
     * ディレクトリの内容を読み取る
     */
    readdir: async (path: string, options?: any): Promise<string[]> => {
      try {
        const { relativePath } = normalizeModulePath(path)
        const dirPath = relativePath.endsWith('/') ? relativePath : relativePath + '/'
        // Use prefix-based listing to avoid loading all files
        const files =
          typeof fileRepository.getFilesByPrefix === 'function'
            ? await fileRepository.getFilesByPrefix(projectId, dirPath)
            : await fileRepository.getProjectFiles(projectId)
        // 直下のファイル/フォルダ名のみ返す
        const children = files
          .filter(f => f.path.startsWith(dirPath) && f.path !== dirPath)
          .map(f => f.path.slice(dirPath.length).split('/')[0])
          .filter((v, i, arr) => v && arr.indexOf(v) === i)
        return children
      } catch (error) {
        throw new Error(`ディレクトリの読み取りに失敗しました: ${path}`)
      }
    },

    /**
     * 同期的にディレクトリの内容を読み取る
     * 注意: IndexedDBは同期でアクセスできないため、事前に`preloadFiles()`でキャッシュをロードしておく必要があります。
     */
    readdirSync: (path: string, options?: any): string[] => {
      const { relativePath } = normalizeModulePath(path)
      const dirPath = relativePath.endsWith('/') ? relativePath : relativePath + '/'

      // メモリキャッシュから直接取得
      const keys = Array.from(memoryCache.keys())
      const children = keys
        .filter(k => k.startsWith(dirPath) && k !== dirPath)
        .map(k => k.slice(dirPath.length).split('/')[0])
        .filter((v, i, arr) => v && arr.indexOf(v) === i)

      if (children.length > 0) return children

      // キャッシュにない場合は同期での取得はできないため警告して空配列を返す
      console.warn(
        `⚠️  fs.readdirSync: Directory not preloaded: ${path} (normalized: ${relativePath}). Returning empty array. Call preloadFiles() first.`
      )
      return []
    },

    /**
     * ファイルを削除
     * [NEW ARCHITECTURE] IndexedDBから削除すれば自動的にGitFileSystemからも削除される
     */
    unlink: async (path: string): Promise<void> => {
      const { relativePath } = normalizeModulePath(path)

      // キャッシュから削除
      if (memoryCache.has(relativePath)) {
        memoryCache.delete(relativePath)
      }

      try {
        const file = await fileRepository.getFileByPath(projectId, relativePath)
        if (file) {
          await fileRepository.deleteFile(file.id)
        } else {
          throw new Error(`File not found: ${path}`)
        }
      } catch (error) {
        console.error('[fsModule] Failed to delete file from IndexedDB:', error)
        throw error
      }
    },

    /**
     * ファイルに追記
     */
    appendFile: async (path: string, data: string, options?: any): Promise<void> => {
      try {
        const { relativePath } = normalizeModulePath(path)
        let existingContent = ''

        // キャッシュまたはDBから取得
        if (memoryCache.has(relativePath)) {
          const cacheContent = memoryCache.get(relativePath)!
          existingContent =
            typeof cacheContent === 'string' ? cacheContent : new TextDecoder().decode(cacheContent)
        } else {
          try {
            const file = await fileRepository.getFileByPath(projectId, relativePath)
            if (file) existingContent = file.content ?? ''
          } catch {
            // ファイルが存在しない場合は新規作成
          }
        }

        await fsModule.writeFile(path, existingContent + data, options)
      } catch (error) {
        throw new Error(`ファイルへの追記に失敗しました: ${path}`)
      }
    },

    /**
     * ファイル/ディレクトリの情報を取得
     */
    stat: async (path: string): Promise<any> => {
      try {
        const { relativePath } = normalizeModulePath(path)

        // キャッシュにあればファイルとして返す
        if (memoryCache.has(relativePath)) {
          const content = memoryCache.get(relativePath)!
          return {
            isFile: () => true,
            isDirectory: () => false,
            size: content.length,
            mtime: new Date(),
            ctime: new Date(),
          }
        }

        const file = await fileRepository.getFileByPath(projectId, relativePath)
        if (!file) throw new Error(`File not found: ${path}`)
        // 疑似的なstat情報を返す
        return {
          isFile: () => file.type === 'file',
          isDirectory: () => file.type === 'folder',
          size: file.content ? file.content.length : 0,
          mtime: file.updatedAt,
          ctime: file.createdAt,
        }
      } catch (error) {
        throw new Error(`ファイル情報の取得に失敗しました: ${path}`)
      }
    },
  }

  // fs.promisesプロパティを追加
  ;(fsModule as any).promises = fsModule

  return fsModule
}
