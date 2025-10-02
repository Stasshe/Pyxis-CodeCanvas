import {
  FileText,
  Search,
  GitBranch,
  Settings,
  FolderOpen,
  Play,
  LogIn,
  LogOut,
} from 'lucide-react';
import { useTheme } from '../context/ThemeContext';
import { useState } from 'react';
import { authRepository } from '@/engine/core/authRepository';
import { useGitHubUser } from '@/context/GitHubUserContext';
import { MenuTab } from '../types';

interface MenuBarProps {
  activeMenuTab: MenuTab;
  onMenuTabClick: (tab: MenuTab) => void;
  onProjectClick: () => void;
  gitChangesCount?: number; // Git変更ファイル数
}

export default function MenuBar({
  activeMenuTab,
  onMenuTabClick,
  onProjectClick,
  gitChangesCount = 0,
}: MenuBarProps) {
  const { colors } = useTheme();
  const { user, fetchUser, clearUser } = useGitHubUser();
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showPATInput, setShowPATInput] = useState(false);
  const [patInput, setPATInput] = useState('');
  const [isAuthenticating, setIsAuthenticating] = useState(false);

  // GitHub Personal Access Token (PAT) でサインイン
  const handleSignIn = async () => {
    if (!patInput.trim()) {
      alert('Personal Access Token を入力してください。');
      return;
    }

    setIsAuthenticating(true);

    try {
      // PATを使用してユーザー情報を取得
      const userResponse = await fetch('https://api.github.com/user', {
        headers: {
          Authorization: `Bearer ${patInput}`,
          Accept: 'application/vnd.github+json',
        },
      });

      if (!userResponse.ok) {
        throw new Error('GitHub認証に失敗しました。トークンが無効です。');
      }

      const userData = await userResponse.json();

      const githubUser = {
        login: userData.login,
        name: userData.name,
        email: userData.email,
        avatar_url: userData.avatar_url,
        id: userData.id,
      };

      // IndexedDBに保存（暗号化される）
      await authRepository.saveAuth({
        accessToken: patInput,
        user: githubUser,
        createdAt: Date.now(),
      });

      // GitHubUserContextを更新
      await fetchUser();

      setPATInput('');
      setShowPATInput(false);
      console.log('[MenuBar] GitHub authentication successful');
      alert('GitHub認証に成功しました！');
    } catch (error) {
      console.error('[MenuBar] Authentication failed:', error);
      alert(`GitHub認証に失敗しました: ${(error as Error).message}`);
    } finally {
      setIsAuthenticating(false);
    }
  };

  // サインアウト
  const handleSignOut = async () => {
    if (confirm('GitHubからサインアウトしますか？')) {
      await authRepository.clearAuth();
      clearUser();
      setShowUserMenu(false);
    }
  };

  return (
    <div
      style={{
        width: '3rem',
        background: colors.mutedBg,
        borderRight: `1px solid ${colors.border}`,
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
        height: '100%',
        userSelect: 'none',
      }}
    >
      {/* 上部のメニューボタン */}
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {['files', 'search', 'git', 'run', 'settings'].map(tab => {
          const Icon =
            tab === 'files'
              ? FileText
              : tab === 'search'
                ? Search
                : tab === 'git'
                  ? GitBranch
                  : tab === 'run'
                    ? Play
                    : Settings;
          const isActive = activeMenuTab === tab;
          return (
            <button
              key={tab}
              style={{
                height: '3rem',
                width: '3rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: isActive ? colors.accentBg : 'transparent',
                color: isActive ? colors.accentFg : colors.sidebarIconFg,
                position: tab === 'git' ? 'relative' : undefined,
                border: 'none',
                cursor: 'pointer',
              }}
              onClick={() => onMenuTabClick(tab as MenuTab)}
              title={
                tab === 'files'
                  ? 'ファイル'
                  : tab === 'search'
                    ? '検索'
                    : tab === 'git'
                      ? 'Git'
                      : tab === 'run'
                        ? '実行'
                        : '設定'
              }
            >
              <Icon size={20} />
              {tab === 'git' && gitChangesCount > 0 && (
                <span
                  style={{
                    position: 'absolute',
                    right: '0.25rem',
                    bottom: '0.125rem',
                    background: colors.red,
                    color: 'white',
                    fontSize: '0.75rem',
                    borderRadius: '9999px',
                    minWidth: '16px',
                    height: '1rem',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    paddingLeft: '0.25rem',
                    paddingRight: '0.25rem',
                  }}
                >
                  {gitChangesCount > 99 ? '99+' : gitChangesCount}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {/* 伸縮領域 */}
      <div style={{ flex: 1, minHeight: 0 }}></div>
      {/* 下部ボタン群 */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          borderTop: `1px solid ${colors.border}`,
        }}
      >
        {/* GitHub認証ボタン */}
        <div style={{ position: 'relative' }}>
          {user ? (
            <>
              <button
                style={{
                  height: '3rem',
                  width: '3rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  padding: 0,
                }}
                onClick={() => setShowUserMenu(!showUserMenu)}
                title={`${user.name || user.login} - クリックしてメニューを開く`}
              >
                <img
                  src={user.avatar_url}
                  alt={user.login}
                  style={{
                    width: '2rem',
                    height: '2rem',
                    borderRadius: '50%',
                    objectFit: 'cover',
                  }}
                />
              </button>
              {showUserMenu && (
                <div
                  style={{
                    position: 'absolute',
                    bottom: '100%',
                    left: '3rem',
                    background: colors.cardBg,
                    border: `1px solid ${colors.border}`,
                    borderRadius: '0.375rem',
                    padding: '0.5rem',
                    minWidth: '12rem',
                    zIndex: 1000,
                    boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
                  }}
                >
                  <div style={{ padding: '0.5rem', borderBottom: `1px solid ${colors.border}` }}>
                    <div style={{ fontSize: '0.875rem', fontWeight: 'bold', color: colors.fg }}>
                      {user.name || user.login}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: colors.mutedFg }}>@{user.login}</div>
                  </div>
                  <button
                    style={{
                      width: '100%',
                      padding: '0.5rem',
                      marginTop: '0.25rem',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                      background: 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      color: colors.fg,
                      fontSize: '0.875rem',
                    }}
                    onClick={handleSignOut}
                  >
                    <LogOut size={16} />
                    <span>サインアウト</span>
                  </button>
                </div>
              )}
            </>
          ) : (
            <>
              <button
                style={{
                  height: '3rem',
                  width: '3rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'transparent',
                  color: colors.sidebarIconFg,
                  border: 'none',
                  cursor: 'pointer',
                }}
                onClick={() => setShowPATInput(!showPATInput)}
                title="GitHubにサインイン（PAT）"
              >
                <LogIn size={20} />
              </button>
              {showPATInput && (
                <div
                  style={{
                    position: 'absolute',
                    bottom: '100%',
                    left: '3rem',
                    background: colors.cardBg,
                    border: `1px solid ${colors.border}`,
                    borderRadius: '0.375rem',
                    padding: '1rem',
                    minWidth: '20rem',
                    zIndex: 1000,
                    boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
                  }}
                >
                  <div style={{ marginBottom: '0.5rem' }}>
                    <div
                      style={{
                        fontSize: '0.875rem',
                        fontWeight: 'bold',
                        color: colors.fg,
                        marginBottom: '0.25rem',
                      }}
                    >
                      GitHub Personal Access Token
                    </div>
                    <div
                      style={{ fontSize: '0.75rem', color: colors.mutedFg, marginBottom: '0.5rem' }}
                    >
                      <a
                        href="https://github.com/settings/tokens/new?scopes=repo"
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: colors.primary, textDecoration: 'underline' }}
                      >
                        ここをクリック
                      </a>
                      してPATを作成（repo スコープが必要）
                    </div>
                  </div>
                  <input
                    type="password"
                    value={patInput}
                    onChange={e => setPATInput(e.target.value)}
                    placeholder="ghp_xxxxxxxxxxxx"
                    style={{
                      width: '100%',
                      padding: '0.5rem',
                      background: colors.bg,
                      border: `1px solid ${colors.border}`,
                      borderRadius: '0.25rem',
                      color: colors.fg,
                      fontSize: '0.875rem',
                      marginBottom: '0.5rem',
                    }}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        handleSignIn();
                      }
                    }}
                  />
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button
                      style={{
                        flex: 1,
                        padding: '0.5rem',
                        background: colors.primary,
                        color: 'white',
                        border: 'none',
                        borderRadius: '0.25rem',
                        cursor: isAuthenticating ? 'not-allowed' : 'pointer',
                        fontSize: '0.875rem',
                        opacity: isAuthenticating ? 0.5 : 1,
                      }}
                      onClick={handleSignIn}
                      disabled={isAuthenticating}
                    >
                      {isAuthenticating ? '認証中...' : 'サインイン'}
                    </button>
                    <button
                      style={{
                        padding: '0.5rem 1rem',
                        background: 'transparent',
                        color: colors.fg,
                        border: `1px solid ${colors.border}`,
                        borderRadius: '0.25rem',
                        cursor: 'pointer',
                        fontSize: '0.875rem',
                      }}
                      onClick={() => {
                        setShowPATInput(false);
                        setPATInput('');
                      }}
                    >
                      キャンセル
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
        {/* プロジェクトボタン */}
        <button
          style={{
            height: '3rem',
            width: '3rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'transparent',
            color: colors.sidebarIconFg,
            border: 'none',
            cursor: 'pointer',
          }}
          onClick={onProjectClick}
          title="プロジェクト管理"
        >
          <FolderOpen size={20} />
        </button>
      </div>
    </div>
  );
}
