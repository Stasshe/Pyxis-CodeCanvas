// ZIPエクスポート・ダウンロード機能
import JSZip from 'jszip'

import { gitFileSystem } from '@/engine/core/gitFileSystem'
import type { Project } from '@/types'

// 現在のプロジェクトのみZIPエクスポート
export async function downloadWorkspaceZip({
  currentProject,
  includeGit = false,
}: {
  currentProject: Project
  includeGit?: boolean
}) {
  const dbName = 'PyxisProjects'
  const req = window.indexedDB.open(dbName)
  const db: IDBDatabase = await new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })

  // projectsストア
  const projectsTx = db.transaction('projects', 'readonly')
  const projectsStore = projectsTx.objectStore('projects')
  const projectReq = projectsStore.get(currentProject.id)
  const project: any = await new Promise((resolve, reject) => {
    projectReq.onsuccess = () => resolve(projectReq.result)
    projectReq.onerror = () => reject(projectReq.error)
  })

  // filesストア
  const filesTx = db.transaction('files', 'readonly')
  const filesStore = filesTx.objectStore('files')
  // プロジェクトIDで絞り込み
  const filesReq = filesStore.getAll()
  const allFiles: any[] = await new Promise((resolve, reject) => {
    filesReq.onsuccess = () => resolve(filesReq.result)
    filesReq.onerror = () => reject(filesReq.error)
  })
  db.close()

  const projectDir = project.name || project.id
  const zip = new JSZip()
  // プロジェクト情報（README的な）
  zip.file(`${projectDir}/.project.json`, JSON.stringify(project, null, 2))
  // ファイル群
  const projectFiles = allFiles.filter(f => f.projectId === currentProject.id)
  for (const file of projectFiles) {
    if (file.type === 'file') {
      // バイナリファイル（bufferContent）がある場合はそれを使用
      if (file.isBufferArray && file.bufferContent) {
        zip.file(`${projectDir}${file.path}`, file.bufferContent)
      } else {
        zip.file(`${projectDir}${file.path}`, file.content)
      }
    }
  }

  // .gitを含める場合（仮想ファイルシステムから.git配下のファイルを再帰的に取得して追加）
  if (includeGit) {
    try {
      const fs = gitFileSystem.getFS()
      if (!fs) return
      const gitDir = `${gitFileSystem.getProjectDir(project.name || project.id)}/.git`

      // .gitディレクトリが存在するか確認
      let stat
      try {
        stat = await fs.promises.stat(gitDir)
      } catch {
        stat = null
      }
      if (stat && stat.isDirectory()) {
        // .git配下のファイルを再帰的に取得
        const getAllGitFiles = async (
          dir: string
        ): Promise<Array<{ path: string; content: Uint8Array }>> => {
          let result: Array<{ path: string; content: Uint8Array }> = []
          let files: string[] = []
          if (!fs) return result
          try {
            files = await fs.promises.readdir(dir)
          } catch {
            return result
          }
          for (const file of files) {
            const filePath = `${dir}/${file}`
            let stat
            if (!fs) continue
            try {
              stat = await fs.promises.stat(filePath)
            } catch {
              continue
            }
            if (stat.isDirectory()) {
              const subFiles = await getAllGitFiles(filePath)
              result = result.concat(subFiles)
            } else {
              let content: Uint8Array = new Uint8Array()
              if (!fs) continue
              try {
                // バイナリとして取得
                content = await fs.promises.readFile(filePath)
              } catch {
                content = new Uint8Array()
              }
              // ZIP内のパスはプロジェクトディレクトリからの相対パス
              const relativePath = filePath.replace(
                gitFileSystem.getProjectDir(project.name || project.id),
                ''
              )
              result.push({ path: `${projectDir}${relativePath}`, content })
            }
          }
          return result
        }
        const gitFiles = await getAllGitFiles(gitDir)
        console.log(
          '[ZIP DEBUG] .git files:',
          gitFiles.map(f => f.path)
        )
        for (const gitFile of gitFiles) {
          zip.file(gitFile.path, gitFile.content)
        }
      }
    } catch (err) {
      console.warn('Failed to include .git files in ZIP:', err)
    }
  }

  // ZIPバイナリ生成
  const blob = await zip.generateAsync({ type: 'blob' })
  // ダウンロード
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${projectDir}_export.zip`
  document.body.appendChild(a)
  a.click()
  setTimeout(() => {
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, 1000)
}
