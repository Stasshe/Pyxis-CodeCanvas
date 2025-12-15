/**
 * GitFileSystem - lightning-fsを管理し、git操作専用のAPIを提供
 * 全てのgit操作とlightning-fs操作はこのクラスを経由する
 *
 * パス形式: FSPath（/projects/{projectName}/... 形式）
 * lightning-fsは先頭スラッシュなしのパスを受け取るため、
 * 内部でAppPath（先頭スラッシュ付き）からGitPath（先頭スラッシュなし）への変換を行う
 */

import FS from '@isomorphic-git/lightning-fs'

import { getProjectRoot, toAppPath, toFSPath, toGitPath } from './pathResolver'

import { coreError, coreInfo, coreWarn } from '@/engine/core/coreLogger'

export class GitFileSystem {
  private fs: FS | null = null
  private static instance: GitFileSystem | null = null

  private constructor() {}

  /**
   * シングルトンインスタンス取得
   */
  static getInstance(): GitFileSystem {
    if (!GitFileSystem.instance) {
      GitFileSystem.instance = new GitFileSystem()
    }
    return GitFileSystem.instance
  }

  /**
   * ファイルシステム初期化
   */
  init(): FS {
    if (typeof window !== 'undefined' && !this.fs) {
      this.fs = new FS('pyxis-fs')

      // 基本ディレクトリ構造を非同期で作成
      setTimeout(async () => {
        try {
          coreInfo('[GitFileSystem] Initializing /projects directory...')
          await this.fs!.promises.mkdir('/projects', { recursive: true } as any)
          coreInfo('[GitFileSystem] Successfully initialized /projects directory')
        } catch (error) {
          if ((error as any).code === 'EEXIST') {
            coreInfo('[GitFileSystem] /projects directory already exists')
          } else {
            coreWarn('[GitFileSystem] Failed to initialize /projects directory:', error)
          }
        }
      }, 0)
    }
    return this.fs!
  }

  /**
   * ファイルシステム取得
   */
  getFS(): FS {
    if (!this.fs) {
      return this.init()
    }
    return this.fs
  }

  /**
   * プロジェクトディレクトリパス取得
   * pathResolverのgetProjectRootを使用
   */
  getProjectDir(projectName: string): string {
    return getProjectRoot(projectName)
  }

  /**
   * AppPath（先頭スラッシュ付き）をFSPath（プロジェクトディレクトリ + パス）に変換
   * pathResolverのtoFSPathを使用
   */
  private toFullPath(projectName: string, filePath: string): string {
    return toFSPath(projectName, filePath)
  }

  /**
   * パスを正規化（先頭の/を削除し、プロジェクトディレクトリと正しく連結）
   * @deprecated toFullPath を使用してください
   */
  private normalizePath(projectDir: string, filePath: string): string {
    // filePathの先頭の/を削除（GitPath形式に変換）
    const gitPath = toGitPath(filePath)
    // プロジェクトディレクトリと連結
    if (gitPath === '.') {
      return projectDir
    }
    return `${projectDir}/${gitPath}`
  }

  /**
   * ディレクトリが存在することを確認し、作成
   */
  async ensureDirectory(dirPath: string): Promise<void> {
    const fs = this.getFS()
    const pathSegments = dirPath.split('/').filter(segment => segment !== '')
    let currentPath = ''

    for (const segment of pathSegments) {
      currentPath += '/' + segment
      try {
        await fs.promises.stat(currentPath)
      } catch {
        try {
          await fs.promises.mkdir(currentPath)
        } catch (error) {
          if ((error as any).code !== 'EEXIST') {
            throw error
          }
        }
      }
    }
  }

  /**
   * ファイル書き込み
   */
  async writeFile(
    projectName: string,
    filePath: string,
    content: string | Uint8Array
  ): Promise<void> {
    const fs = this.getFS()
    const projectDir = this.getProjectDir(projectName)
    const fullPath = this.normalizePath(projectDir, filePath)

    // 親ディレクトリを確実に作成
    const parentDir = fullPath.substring(0, fullPath.lastIndexOf('/'))
    if (parentDir && parentDir !== projectDir) {
      await this.ensureDirectory(parentDir)
    }

    await fs.promises.writeFile(fullPath, content)
    coreInfo(`[GitFileSystem] File written: ${fullPath}`)
  }

  /**
   * ファイル読み込み
   */
  async readFile(projectName: string, filePath: string): Promise<string> {
    const fs = this.getFS()
    const projectDir = this.getProjectDir(projectName)
    const fullPath = this.normalizePath(projectDir, filePath)

    coreInfo(`[GitFileSystem] Reading file: ${filePath} -> ${fullPath}`)

    try {
      const content = await fs.promises.readFile(fullPath, { encoding: 'utf8' })
      return content as string
    } catch (error) {
      coreError(`[GitFileSystem] Failed to read file: ${fullPath}`, error)
      throw error
    }
  }

  /**
   * ファイル削除
   */
  async deleteFile(projectName: string, filePath: string): Promise<void> {
    const fs = this.getFS()
    const projectDir = this.getProjectDir(projectName)
    const fullPath = this.normalizePath(projectDir, filePath)

    try {
      const stat = await fs.promises.stat(fullPath)
      if (stat.isDirectory()) {
        await this.removeDirectoryRecursive(fullPath)
      } else {
        await fs.promises.unlink(fullPath)
      }
      coreInfo(`[GitFileSystem] Deleted: ${fullPath}`)
    } catch (error) {
      if ((error as any).code !== 'ENOENT') {
        throw error
      }
    }
  }

  /**
   * ディレクトリを再帰的に削除
   */
  private async removeDirectoryRecursive(dirPath: string): Promise<void> {
    const fs = this.getFS()

    try {
      const files = await fs.promises.readdir(dirPath)

      for (const file of files) {
        const filePath = `${dirPath}/${file}`
        const stat = await fs.promises.stat(filePath)

        if (stat.isDirectory()) {
          await this.removeDirectoryRecursive(filePath)
        } else {
          await fs.promises.unlink(filePath)
        }
      }

      await fs.promises.rmdir(dirPath)
    } catch (error) {
      // エラーは無視
    }
  }

  /**
   * ディレクトリ内の全ファイルを再帰的に取得
   */
  async getAllFiles(
    projectName: string,
    relativePath = ''
  ): Promise<Array<{ path: string; content: string; type: 'file' | 'folder' }>> {
    const fs = this.getFS()
    const projectDir = this.getProjectDir(projectName)
    const result: Array<{ path: string; content: string; type: 'file' | 'folder' }> = []

    const traverse = async (currentPath: string, relPath: string) => {
      try {
        const entries = await fs.promises.readdir(currentPath)

        for (const entry of entries) {
          // .gitディレクトリは除外
          if (entry === '.git') continue

          const fullPath = `${currentPath}/${entry}`
          const relativeFilePath = relPath ? `${relPath}/${entry}` : `/${entry}`

          try {
            const stat = await fs.promises.stat(fullPath)

            if (stat.isDirectory()) {
              result.push({ path: relativeFilePath, content: '', type: 'folder' })
              await traverse(fullPath, relativeFilePath)
            } else if (stat.isFile()) {
              const content = await fs.promises.readFile(fullPath, { encoding: 'utf8' })
              result.push({
                path: relativeFilePath,
                content: content as string,
                type: 'file',
              })
            }
          } catch (error) {
            console.warn(`[GitFileSystem] Failed to stat ${fullPath}:`, error)
          }
        }
      } catch (error) {
        coreWarn(`[GitFileSystem] Failed to read directory ${currentPath}:`, error)
      }
    }

    await traverse(projectDir, '')
    return result
  }

  /**
   * ファイルシステムの同期を確実にする
   */
  async flush(): Promise<void> {
    const fs = this.getFS()
    if ((fs as any).sync) {
      try {
        await (fs as any).sync()
        coreInfo('[GitFileSystem] Cache flushed')
      } catch (error) {
        coreWarn('[GitFileSystem] Failed to flush cache:', error)
      }
    }
  }

  /**
   * プロジェクトディレクトリをクリア（.gitディレクトリは保持）
   */
  async clearProjectDirectory(projectName: string): Promise<void> {
    const fs = this.getFS()
    const projectDir = this.getProjectDir(projectName)

    try {
      const existingFiles = await fs.promises.readdir(projectDir)
      for (const file of existingFiles) {
        if (file !== '.git') {
          const fullPath = `${projectDir}/${file}`
          const stat = await fs.promises.stat(fullPath)

          if (stat.isDirectory()) {
            await this.removeDirectoryRecursive(fullPath)
          } else {
            await fs.promises.unlink(fullPath)
          }
        }
      }
      coreInfo(`[GitFileSystem] Cleared project directory: ${projectDir}`)
    } catch (error) {
      // ディレクトリが存在しない場合は無視
    }
  }

  /**
   * プロジェクト全体を削除（ディレクトリごと削除）
   */
  async deleteProject(projectName: string): Promise<void> {
    const fs = this.getFS()
    const projectDir = this.getProjectDir(projectName)

    try {
      // プロジェクトディレクトリを再帰的に削除
      await this.removeDirectoryRecursive(projectDir)
      coreInfo(`[GitFileSystem] Deleted project directory: ${projectDir}`)
    } catch (error) {
      // ディレクトリが存在しない場合は無視
      coreWarn(`[GitFileSystem] Failed to delete project directory ${projectDir}:`, error)
    }
  }

  /**
   * デバッグ: ファイルシステムの状態を確認
   */
  async debugFileSystem(): Promise<void> {
    const fs = this.getFS()

    try {
      coreInfo('=== GitFileSystem Debug ===')

      // ルートディレクトリの確認
      try {
        const rootFiles = await fs.promises.readdir('/')
        coreInfo('Root directory contents:', rootFiles)
      } catch (error) {
        coreWarn('Failed to read root directory:', error)
      }

      // /projectsディレクトリの確認
      try {
        const projectsFiles = await fs.promises.readdir('/projects')
        coreInfo('/projects directory contents:', projectsFiles)
      } catch (error) {
        coreWarn('/projects directory does not exist or cannot be read:', error)
      }

      coreInfo('=== End Debug ===')
    } catch (error) {
      coreError('Debug failed:', error)
    }
  }
}

// シングルトンインスタンスをエクスポート
export const gitFileSystem = GitFileSystem.getInstance()
