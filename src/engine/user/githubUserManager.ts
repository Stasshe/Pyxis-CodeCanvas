/**
 * GitHub User Manager (Singleton)
 * React Context外からもGitHubユーザー情報にアクセスできるようにする
 */

import { authRepository } from './authRepository'

export interface GitHubUser {
  login: string
  name: string | null
  email: string | null
  avatar_url: string
  bio: string | null
  company: string | null
  location: string | null
  blog: string | null
  twitter_username: string | null
  public_repos: number
  public_gists: number
  followers: number
  following: number
  created_at: string
  updated_at: string
}

export interface GitCommitAuthor {
  name: string
  email: string
}

class GitHubUserManager {
  private static instance: GitHubUserManager
  private user: GitHubUser | null = null
  private fetchPromise: Promise<GitHubUser | null> | null = null
  private lastFetchTime: number = 0
  private readonly CACHE_DURATION = 5 * 60 * 1000 // 5分間キャッシュ

  private constructor() {}

  static getInstance(): GitHubUserManager {
    if (!GitHubUserManager.instance) {
      GitHubUserManager.instance = new GitHubUserManager()
    }
    return GitHubUserManager.instance
  }

  /**
   * ユーザー情報を取得（キャッシュあり）
   */
  async getUser(): Promise<GitHubUser | null> {
    const now = Date.now()

    // キャッシュが有効な場合
    if (this.user && now - this.lastFetchTime < this.CACHE_DURATION) {
      console.log('[GitHubUserManager] Using cached user:', this.user.login)
      return this.user
    }

    // 既に取得中の場合は同じPromiseを返す
    if (this.fetchPromise) {
      console.log('[GitHubUserManager] Waiting for ongoing fetch...')
      return this.fetchPromise
    }

    // 新規取得
    this.fetchPromise = this.fetchUserInfo()
    const user = await this.fetchPromise
    this.fetchPromise = null

    return user
  }

  /**
   * GitHub APIからユーザー情報を取得
   */
  private async fetchUserInfo(): Promise<GitHubUser | null> {
    try {
      const token = await authRepository.getAccessToken()
      if (!token) {
        console.log('[GitHubUserManager] No token, clearing user')
        this.user = null
        this.lastFetchTime = 0
        return null
      }

      console.log('[GitHubUserManager] Fetching user info from GitHub API...')

      const response = await fetch('https://api.github.com/user', {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github.v3+json',
        },
      })

      if (!response.ok) {
        throw new Error(`GitHub API error: ${response.status}`)
      }

      const userData: GitHubUser = await response.json()
      console.log('[GitHubUserManager] User info fetched:', userData.login)

      this.user = userData
      this.lastFetchTime = Date.now()

      return userData
    } catch (error) {
      console.error('[GitHubUserManager] Failed to fetch user:', error)
      this.user = null
      this.lastFetchTime = 0
      return null
    }
  }

  /**
   * Gitコミット用のAuthor情報を取得
   */
  async getCommitAuthor(): Promise<GitCommitAuthor> {
    const user = await this.getUser()

    if (user) {
      return {
        name: user.name || user.login,
        email: user.email || `${user.login}@users.noreply.github.com`,
      }
    }

    // デフォルト
    return {
      name: 'User',
      email: 'user@pyxis.dev',
    }
  }

  /**
   * キャッシュをクリア
   */
  clearCache(): void {
    console.log('[GitHubUserManager] Clearing cache')
    this.user = null
    this.lastFetchTime = 0
    this.fetchPromise = null
  }

  /**
   * ユーザー情報を強制再取得
   */
  async refreshUser(): Promise<GitHubUser | null> {
    this.clearCache()
    return this.getUser()
  }

  /**
   * 現在のキャッシュされたユーザー情報を取得（APIコールなし）
   */
  getCachedUser(): GitHubUser | null {
    return this.user
  }
}

// シングルトンインスタンスをエクスポート
export const githubUserManager = GitHubUserManager.getInstance()
