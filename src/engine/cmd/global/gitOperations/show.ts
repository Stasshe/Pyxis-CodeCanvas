import type FS from '@isomorphic-git/lightning-fs'
import git from 'isomorphic-git'

/**
 * git show コマンドの実装
 * - <commit>:<file> でコミット時点のファイル内容を表示
 * - origin/branch、upstream/branch などのリモートブランチに対応
 * - コミットハッシュやブランチ名に対応
 */
export async function show(fs: FS, dir: string, args: string[]): Promise<string> {
  try {
    if (args.length === 0) {
      return 'git show: missing commit or file'
    }

    const arg = args[0]

    // パターン解析: <commit>:<file> または単体のcommit
    const colonIndex = arg.indexOf(':')

    if (colonIndex !== -1) {
      // <commit>:<file> 形式
      const commitRef = arg.substring(0, colonIndex)
      const filePath = arg.substring(colonIndex + 1)

      return await showCommitFile(fs, dir, commitRef, filePath)
    } else {
      // 単体のcommit参照（ハッシュまたはブランチ名）
      return await showCommit(fs, dir, arg)
    }
  } catch (error) {
    throw new Error(`git show: ${(error as Error).message}`)
  }
}

/**
 * コミット時点のファイル内容を表示
 * <commit>:<file> 形式に対応
 */
async function showCommitFile(
  fs: FS,
  dir: string,
  commitRef: string,
  filePath: string
): Promise<string> {
  try {
    // commitRef を解決（ハッシュ、ブランチ名、リモートブランチなど）
    const commitOid = await resolveRef(fs, dir, commitRef)

    if (!commitOid) {
      return `fatal: ${commitRef}: unknown revision or path not in the working tree.`
    }

    // ファイルが存在するかチェック
    const normalizedPath = filePath.startsWith('/') ? filePath.slice(1) : filePath

    try {
      const { blob } = await git.readBlob({
        fs,
        dir,
        oid: commitOid,
        filepath: normalizedPath,
      })

      const content = typeof blob === 'string' ? blob : new TextDecoder().decode(blob as Uint8Array)

      return content
    } catch (readError) {
      const err = readError as Error
      if (err.message.includes('not found') || err.message.includes('Could not find')) {
        return `fatal: Path '${filePath}' does not exist in '${commitRef}'`
      }
      throw err
    }
  } catch (error) {
    throw new Error(`Failed to show file: ${(error as Error).message}`)
  }
}

/**
 * コミット情報全体を表示（log形式）
 * コミットハッシュやブランチ名で呼び出される
 */
async function showCommit(fs: FS, dir: string, commitRef: string): Promise<string> {
  try {
    // commitRef を解決
    const commitOid = await resolveRef(fs, dir, commitRef)

    if (!commitOid) {
      return `fatal: ${commitRef}: unknown revision or path not in the working tree.`
    }

    // コミット情報を取得
    const commit = await git.readCommit({
      fs,
      dir,
      oid: commitOid,
    })

    const { author, message } = commit.commit

    // コミット情報をフォーマット
    let result = `commit ${commitOid}\n`

    if (author) {
      const authorDate = new Date(author.timestamp * 1000).toLocaleString()
      result += `Author: ${author.name} <${author.email}>\n`
      result += `Date:   ${authorDate}\n`
    }

    result += `\n    ${message}\n`

    // 親コミットがあれば表示
    if (commit.commit.parent && commit.commit.parent.length > 0) {
      result += `\nParent: ${commit.commit.parent.join(', ')}\n`
    }

    return result
  } catch (error) {
    throw new Error(`Failed to show commit: ${(error as Error).message}`)
  }
}

/**
 * リファレンス（ブランチ、タグ、リモートブランチなど）を解決して、コミットOIDを取得
 * - origin/main, upstream/develop などのリモートブランチに対応
 * - HEAD~1, HEAD~2 などの相対参照に対応
 * - 短縮系コミットハッシュ（7文字以上）に対応
 */
async function resolveRef(fs: FS, dir: string, ref: string): Promise<string | null> {
  try {
    // コミットハッシュかどうかを判定（4文字以上の16進数）
    const isCommitHash = /^[a-f0-9]{4,}$/i.test(ref)

    if (isCommitHash) {
      // コミットハッシュの場合は expandOid を使用（短縮形ハッシュに対応）
      try {
        const oid = await git.expandOid({
          fs,
          dir,
          oid: ref,
        })
        return oid
      } catch {
        // 短縮系ハッシュが見つからない場合
        return null
      }
    }

    // HEAD~1 などの相対参照の場合
    if (ref.startsWith('HEAD')) {
      try {
        const oid = await git.resolveRef({
          fs,
          dir,
          ref,
        })
        return oid
      } catch {
        return null
      }
    }

    // リモートブランチの場合（origin/main など）
    if (ref.includes('/')) {
      // refs/remotes/origin/main 形式で試す
      try {
        const oid = await git.resolveRef({
          fs,
          dir,
          ref: `refs/remotes/${ref}`,
        })
        return oid
      } catch {
        // リモートが存在しない場合、通常のref解決を試す
      }
    }

    // 直接解決を試みる（ブランチ、タグなど）
    try {
      const oid = await git.resolveRef({
        fs,
        dir,
        ref,
      })
      return oid
    } catch {
      // 失敗した場合はnull
      return null
    }
  } catch {
    return null
  }
}
