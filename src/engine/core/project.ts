/**
 * project.ts - 新アーキテクチャ対応のプロジェクト管理フック
 *
 * 設計原則:
 * 1. IndexedDBが唯一の真実の源（Single Source of Truth）
 * 2. 全てのファイル操作はfileRepositoryを経由する
 * 3. GitFileSystemへの同期は自動的にバックグラウンドで実行される
 * 4. イベントリスナーによってUIは自動更新される
 * 5. 手動の状態更新は不要（イベントシステムに任せる）
 */

import { useEffect, useState } from 'react'

import { fileRepository } from './fileRepository'

import { LOCALSTORAGE_KEY } from '@/context/config'
import { terminalCommandRegistry } from '@/engine/cmd/terminalRegistry'
import { createChatSpace } from '@/engine/storage/chatStorageAdapter'
import type { FileItem } from '@/types'
import type { Project, ProjectFile } from '@/types/'

/**
 * プロジェクト作成時のGit初期化とコミット
 */
const initializeProjectGit = async (project: Project, files: ProjectFile[]) => {
  try {
    console.log('[Git] Initializing for project:', project.name)
    // GitFileSystemやsyncManagerへの直接同期はfileRepository側に委譲
    // ここではGitリポジトリの初期化と初回コミットのみ行う
    const git = terminalCommandRegistry.getGitCommands(project.name, project.id)
    try {
      await git.init()
      console.log('[Git] Repository initialized')
      await new Promise(resolve => setTimeout(resolve, 200))
      await git.add('.')
      console.log('[Git] Files staged')
      await new Promise(resolve => setTimeout(resolve, 200))
      await git.commit('Initial commit', {
        name: 'Pyxis User',
        email: 'user@pyxis.dev',
      })
      console.log('[Git] Initial commit completed')
    } catch (gitError) {
      console.warn('[Git] Initialization failed (non-critical):', gitError)
    }
  } catch (error) {
    console.error('[Git] Failed to initialize:', error)
  }
}

/**
 * ProjectFileをFileItem階層構造に変換
 */
const convertToFileItems = (files: ProjectFile[]): FileItem[] => {
  const uniqueFiles = files.reduce((acc, file) => {
    const existing = acc.find(f => f.path === file.path)
    if (!existing) {
      acc.push(file)
    } else if (file.updatedAt > existing.updatedAt) {
      const index = acc.indexOf(existing)
      acc[index] = file
    }
    return acc
  }, [] as ProjectFile[])

  const fileMap = new Map<string, FileItem>()
  const rootItems: FileItem[] = []

  uniqueFiles.forEach(file => {
    const item: FileItem = {
      id: file.id,
      name: file.name,
      type: file.type,
      path: file.path,
      content: file.content,
      isBufferArray: file.isBufferArray,
      bufferContent: file.bufferContent,
      children: file.type === 'folder' ? [] : undefined,
    }
    fileMap.set(file.path, item)
  })

  const ensureParentFolder = (parentPath: string) => {
    if (!parentPath || parentPath === '/') return
    if (!fileMap.has(parentPath)) {
      const name = parentPath.split('/').filter(Boolean).pop() || parentPath
      const grandParent = parentPath.substring(0, parentPath.lastIndexOf('/')) || '/'
      const folderItem: FileItem = {
        id: `auto-folder-${parentPath}`,
        name,
        type: 'folder',
        path: parentPath,
        content: '',
        isBufferArray: false,
        bufferContent: undefined,
        children: [],
      }
      fileMap.set(parentPath, folderItem)
      ensureParentFolder(grandParent)
    }
  }

  uniqueFiles.forEach(file => {
    const item = fileMap.get(file.path)
    if (!item) return

    if (file.parentPath === '/' || !file.parentPath || file.path === '/') {
      rootItems.push(item)
    } else {
      if (!fileMap.has(file.parentPath)) {
        ensureParentFolder(file.parentPath)
      }
      const parent = fileMap.get(file.parentPath)
      if (parent && parent.children) {
        parent.children.push(item)
      }
    }
  })

  fileMap.forEach((item, path) => {
    if (item.type === 'folder' && item.path.lastIndexOf('/') <= 0 && !rootItems.includes(item)) {
      rootItems.push(item)
    }
  })

  const sortItems = (items: FileItem[]): FileItem[] => {
    return items
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === 'folder' ? -1 : 1
        return a.name.localeCompare(b.name)
      })
      .map(item => ({
        ...item,
        children: item.children ? sortItems(item.children) : undefined,
      }))
  }

  return sortItems(rootItems)
}

/**
 * プロジェクト管理用カスタムフック
 */
export const useProject = () => {
  const [currentProject, setCurrentProject] = useState<Project | null>(null)
  const [projectFiles, setProjectFiles] = useState<ProjectFile[]>([])
  const [loading, setLoading] = useState(false)

  const loadProject = async (project: Project) => {
    setLoading(true)
    try {
      await fileRepository.init()
      const files = await fileRepository.getFilesByPrefix(project.id, '/')
      setCurrentProject(project)
      setProjectFiles(files)
      try {
        const git = terminalCommandRegistry.getGitCommands(project.name, project.id)
        const currentBranch = await git.getCurrentBranch()
        if (currentBranch === '(no git)') {
          console.log('[Project] Git not initialized, initializing...')
          await initializeProjectGit(project, files)
        }
      } catch (gitError) {
        console.warn('[Project] Git check failed:', gitError)
        try {
          await initializeProjectGit(project, files)
        } catch (initError) {
          console.warn('[Project] Git initialization failed (non-critical):', initError)
        }
      }
    } catch (error) {
      console.error('[Project] Failed to load:', error)
    } finally {
      setLoading(false)
    }
  }

  const saveFile = async (path: string, content: string) => {
    if (!currentProject) {
      console.error('[Project] No current project')
      return
    }
    console.log('[Project] Saving file:', path)
    try {
      await fileRepository.init()
      // Query single file directly instead of pulling all project files
      const existingFile = await fileRepository.getFileByPath(currentProject.id, path)
      if (existingFile) {
        const updatedFile = {
          ...existingFile,
          content,
          isBufferArray: false,
          bufferContent: undefined,
          updatedAt: new Date(),
        }
        await fileRepository.saveFile(updatedFile)
        console.log('[Project] File updated (event system will update UI)')
      } else {
        await fileRepository.createFile(currentProject.id, path, content, 'file')
        console.log('[Project] File created (event system will update UI)')
      }
      // 同期処理はfileRepository側に委譲
    } catch (error) {
      console.error('[Project] Failed to save file:', error)
      throw error
    }
  }

  const createFile = async (path: string, type: 'file' | 'folder', content = '') => {
    if (!currentProject) return
    console.log('[Project] Creating:', type, path)
    try {
      if (type === 'file') {
        await ensureParentFolders(path)
      }
      await fileRepository.createFile(currentProject.id, path, content, type)
      console.log('[Project] Created (event system will update UI)')
      // 同期処理はfileRepository側に委譲
    } catch (error) {
      console.error('[Project] Failed to create:', error)
      throw error
    }
  }

  const ensureParentFolders = async (filePath: string) => {
    if (!currentProject) return
    if (filePath.lastIndexOf('/') <= 0) return
    const pathParts = filePath.split('/').filter(part => part !== '')
    let currentPath = ''
    for (let i = 0; i < pathParts.length - 1; i++) {
      currentPath += '/' + pathParts[i]
      // Query whether the folder exists directly from the repository instead of relying on cached projectFiles
      try {
        await fileRepository.init()
        const existingFolder = await fileRepository.getFileByPath(currentProject.id, currentPath)
        if (!existingFolder || existingFolder.type !== 'folder') {
          console.log('[Project] Creating missing folder:', currentPath)
          await fileRepository.createFile(currentProject.id, currentPath, '', 'folder')
        }
      } catch (error) {
        console.error('[Project] Failed to create parent folder:', currentPath, error)
        throw error
      }
    }
  }

  const deleteFile = async (fileId: string) => {
    if (!currentProject) return
    try {
      const fileToDelete = projectFiles.find(f => f.id === fileId)
      console.log('[Project] Deleting:', fileToDelete?.path)
      await fileRepository.deleteFile(fileId)
      // 子ファイルや同期処理もfileRepository側に委譲
      console.log('[Project] Deleted (event system will update UI)')
    } catch (error) {
      console.error('[Project] Failed to delete:', error)
      throw error
    }
  }

  const refreshProjectFiles = async () => {
    if (!currentProject) return

    try {
      const files = await fileRepository.getFilesByPrefix(currentProject.id, '/')
      setProjectFiles(files)
    } catch (error) {
      console.error('[Project] Failed to refresh:', error)
    }
  }

  const syncTerminalFileOperation = async (
    path: string,
    type: 'file' | 'folder' | 'delete',
    content = '',
    bufferContent?: ArrayBuffer
  ) => {
    if (!currentProject) {
      console.log('[Terminal] No current project')
      return
    }
    console.log('[Terminal] Syncing operation:', type, path)
    if (path === '.') {
      console.log('[Terminal] Dummy refresh operation')
      await refreshProjectFiles()
      return
    }
    try {
      await fileRepository.init()
      if (type === 'delete') {
        const fileToDelete = await fileRepository.getFileByPath(currentProject.id, path)
        if (fileToDelete) {
          await fileRepository.deleteFile(fileToDelete.id)
        } else {
          const childFiles = await fileRepository.getFilesByPrefix(currentProject.id, path + '/')
          for (const child of childFiles) {
            await fileRepository.deleteFile(child.id)
          }
        }
      } else {
        const existingFile = await fileRepository.getFileByPath(currentProject.id, path)
        if (existingFile) {
          const updatedFile = bufferContent
            ? {
                ...existingFile,
                content: '',
                isBufferArray: true,
                bufferContent,
                updatedAt: new Date(),
              }
            : {
                ...existingFile,
                content,
                isBufferArray: false,
                bufferContent: undefined,
                updatedAt: new Date(),
              }
          await fileRepository.saveFile(updatedFile)
        } else {
          await fileRepository.createFile(
            currentProject.id,
            path,
            bufferContent ? '' : content,
            type,
            !!bufferContent,
            bufferContent
          )
        }
      }
      console.log('[Terminal] Operation completed (event system will update UI)')
    } catch (error) {
      console.error('[Terminal] Failed to sync operation:', error)
      throw error
    }
  }

  const createProject = async (name: string, description?: string) => {
    try {
      setLoading(true)
      await fileRepository.init()

      console.log('[Project] Creating new project:', name)
      const newProject = await fileRepository.createProject(name, description)

      const files = await fileRepository.getFilesByPrefix(newProject.id, '/')

      setCurrentProject(newProject)
      setProjectFiles(files)

      await initializeProjectGit(newProject, files)

      try {
        await createChatSpace(newProject.id, `新規チャット`)
      } catch (error) {
        console.warn('[Project] Failed to create initial chat space (non-critical):', error)
      }

      return newProject
    } catch (error) {
      console.error('[Project] Failed to create:', error)
      throw error
    } finally {
      setLoading(false)
    }
  }

  const clearAIReview = async (filePath: string): Promise<void> => {
    if (!currentProject) {
      throw new Error('No project selected')
    }

    try {
      await fileRepository.clearAIReview(currentProject.id, filePath)
      await refreshProjectFiles()
    } catch (error) {
      console.error('[Project] Failed to clear AI review:', error)
      throw error
    }
  }

  const saveRecentProject = (project: Project) => {
    try {
      const recentProjectsStr = localStorage.getItem(LOCALSTORAGE_KEY.RECENT_PROJECTS)
      let recentProjects: Project[] = recentProjectsStr ? JSON.parse(recentProjectsStr) : []

      recentProjects = recentProjects.filter(p => p.id !== project.id)
      recentProjects.unshift(project)
      recentProjects = recentProjects.slice(0, 10)

      localStorage.setItem(LOCALSTORAGE_KEY.RECENT_PROJECTS, JSON.stringify(recentProjects))
    } catch (error) {
      console.error('[Project] Failed to save recent project:', error)
    }
  }

  const getRecentProjects = (): Project[] => {
    try {
      const recentProjectsStr = localStorage.getItem(LOCALSTORAGE_KEY.RECENT_PROJECTS)
      return recentProjectsStr ? JSON.parse(recentProjectsStr) : []
    } catch (error) {
      console.error('[Project] Failed to get recent projects:', error)
      return []
    }
  }

  useEffect(() => {
    if (!currentProject) return

    // console.log('[Project] Subscribing to file changes for:', currentProject.id);

    const unsubscribe = fileRepository.addChangeListener(event => {
      if (event.projectId !== currentProject.id) return

      // console.log('[Project] File change event:', event.type, event.file);

      switch (event.type) {
        case 'create':
          if ('content' in event.file) {
            setProjectFiles(prev => {
              if (prev.find(f => f.id === event.file.id)) return prev
              return [...prev, event.file as ProjectFile]
            })
          }
          break

        case 'update':
          if ('content' in event.file) {
            setProjectFiles(prev =>
              prev.map(f => (f.id === event.file.id ? (event.file as ProjectFile) : f))
            )
          }
          break

        case 'delete':
          setProjectFiles(prev => prev.filter(f => f.id !== event.file.id))
          break
      }
    })

    return () => {
      console.log('[Project] Unsubscribing from file changes')
      unsubscribe()
    }
  }, [currentProject])

  useEffect(() => {
    if (currentProject) {
      saveRecentProject(currentProject)
    }
  }, [currentProject])

  useEffect(() => {
    const initProject = async () => {
      try {
        await fileRepository.init()
        const projects = await fileRepository.getProjects()

        const recentProjects = getRecentProjects()
        const lastProject = recentProjects[0]

        if (lastProject && projects.find(p => p.id === lastProject.id)) {
          await loadProject(lastProject)
        } else if (projects.length > 0) {
          await loadProject(projects[0])
        } else {
          setTimeout(() => {
            createProject('Welcome-Project', 'Pyxis エディターへようこそ！')
          }, 1000)
        }
      } catch (error) {
        console.error('[Project] Failed to initialize:', error)
        setLoading(false)
      }
    }

    initProject()
  }, [])

  return {
    currentProject,
    projectFiles: convertToFileItems(projectFiles),
    loading,
    loadProject,
    saveFile,
    createFile,
    deleteFile,
    createProject,
    refreshProjectFiles,
    syncTerminalFileOperation,
    clearAIReview,
  }
}
