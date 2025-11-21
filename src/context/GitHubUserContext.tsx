'use client';

/**
 * GitHub User Context
 * ログイン済みユーザーの情報をキャッシュして管理
 */

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

import { githubUserManager, GitHubUser, GitCommitAuthor } from '@/engine/user/githubUserManager';

export type { GitHubUser, GitCommitAuthor };

interface GitHubUserContextType {
  user: GitHubUser | null;
  isLoading: boolean;
  error: string | null;
  fetchUser: () => Promise<void>;
  clearUser: () => void;
  getCommitAuthor: () => Promise<GitCommitAuthor>;
}

const GitHubUserContext = createContext<GitHubUserContextType | undefined>(undefined);

export function GitHubUserProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<GitHubUser | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * GitHub APIからユーザー情報を取得（githubUserManager経由）
   */
  const fetchUser = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const userData = await githubUserManager.getUser();
      setUser(userData);
    } catch (err) {
      const errorMessage = (err as Error).message;
      console.error('[GitHubUserContext] Failed to fetch user:', errorMessage);
      setError(errorMessage);
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * ユーザー情報をクリア
   */
  const clearUser = useCallback(() => {
    setUser(null);
    setError(null);
  }, []);

  /**
   * Gitコミット用のAuthor情報を取得
   */
  /**
   * Git Commitの作者情報を取得（githubUserManager経由）
   */
  const getCommitAuthor = useCallback(async (): Promise<GitCommitAuthor> => {
    try {
      return await githubUserManager.getCommitAuthor();
    } catch (err) {
      console.error('[GitHubUserContext] Failed to get commit author:', err);
      return { name: 'User', email: 'user@pyxis.dev' };
    }
  }, []);

  /**
   * 初回マウント時にキャッシュがあれば取得
   */
  useEffect(() => {
    const initUser = async () => {
      const cached = githubUserManager.getCachedUser();
      if (cached) {
        setUser(cached);
      } else if (!user) {
        await fetchUser();
      }
    };

    initUser();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const value: GitHubUserContextType = {
    user,
    isLoading,
    error,
    fetchUser,
    clearUser,
    getCommitAuthor,
  };

  return <GitHubUserContext.Provider value={value}>{children}</GitHubUserContext.Provider>;
}

/**
 * GitHubUserContextを使用するカスタムフック
 */
export function useGitHubUser() {
  const context = useContext(GitHubUserContext);
  if (!context) {
    throw new Error('useGitHubUser must be used within GitHubUserProvider');
  }
  return context;
}
