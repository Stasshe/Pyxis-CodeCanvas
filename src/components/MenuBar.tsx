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
import { authRepository } from '@/engine/user/authRepository';
import { useGitHubUser } from '@/context/GitHubUserContext';
import { useTranslation } from '@/context/I18nContext';
import { useKeyBinding } from '@/hooks/useKeyBindings';
import { MenuTab } from '../types';

interface MenuBarProps {
  activeMenuTab: MenuTab;
  onMenuTabClick: (tab: MenuTab) => void;
  onProjectClick: () => void;
  gitChangesCount?: number;
}

export default function MenuBar({
  activeMenuTab,
  onMenuTabClick,
  onProjectClick,
  gitChangesCount = 0,
}: MenuBarProps) {
  const { colors } = useTheme();
  const { user, fetchUser, clearUser } = useGitHubUser();
  const { t } = useTranslation();
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showPATInput, setShowPATInput] = useState(false);
  const [patInput, setPATInput] = useState('');
  const [isAuthenticating, setIsAuthenticating] = useState(false);

  const handleSignIn = async () => {
    if (!patInput.trim()) {
      alert(t('auth.patPrompt'));
      return;
    }

    setIsAuthenticating(true);

    try {
      const userResponse = await fetch('https://api.github.com/user', {
        headers: {
          Authorization: `Bearer ${patInput}`,
          Accept: 'application/vnd.github+json',
        },
      });

      if (!userResponse.ok) {
        throw new Error(t('auth.authFailed'));
      }

      const userData = await userResponse.json();

      const githubUser = {
        login: userData.login,
        name: userData.name,
        email: userData.email,
        avatar_url: userData.avatar_url,
        id: userData.id,
      };

      await authRepository.saveAuth({
        accessToken: patInput,
        user: githubUser,
        createdAt: Date.now(),
      });

      await fetchUser();

      setPATInput('');
      setShowPATInput(false);
      console.log('[MenuBar] GitHub authentication successful');
      alert(t('auth.authSuccess'));
    } catch (error) {
      console.error('[MenuBar] Authentication failed:', error);
      alert(`${t('auth.authFailed')}: ${(error as Error).message}`);
    } finally {
      setIsAuthenticating(false);
    }
  };

  const handleSignOut = async () => {
    if (confirm(t('auth.signOutConfirm'))) {
      await authRepository.clearAuth();
      clearUser();
      setShowUserMenu(false);
    }
  };

  const menuTabs: Array<{ id: MenuTab; label: string }> = [
    { id: 'files', label: t('menu.files') },
    { id: 'search', label: t('menu.search') },
    { id: 'git', label: t('menu.git') },
    { id: 'run', label: t('menu.run') },
    { id: 'settings', label: t('menu.settings') },
  ];

  // グローバル検索ショートカット (Ctrl+Shift+F)
  useKeyBinding(
    'globalSearch',
    () => {
      onMenuTabClick('search');
    },
    [onMenuTabClick]
  );

  return (
    <div
      className="select-none"
      style={{
        width: '3rem',
        background: colors.background,
        borderRight: `1px solid ${colors.border}`,
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
        height: '100%',
        userSelect: 'none',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {menuTabs.map(({ id, label }) => {
          const Icon =
            id === 'files'
              ? FileText
              : id === 'search'
                ? Search
                : id === 'git'
                  ? GitBranch
                  : id === 'run'
                    ? Play
                    : Settings;
          const isActive = activeMenuTab === id;
          return (
            <button
              key={id}
              style={{
                height: '3rem',
                width: '3rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: isActive ? colors.accentBg : 'transparent',
                color: isActive ? colors.accentFg : colors.sidebarIconFg,
                position: id === 'git' ? 'relative' : undefined,
                border: 'none',
                cursor: 'pointer',
              }}
              onClick={() => onMenuTabClick(id)}
              title={label}
            >
              <Icon size={20} />
              {id === 'git' && gitChangesCount > 0 && (
                <span
                  style={{
                    position: 'absolute',
                    right: '0.25rem',
                    bottom: '0.125rem',
                    background: colors.red,
                    color: colors.background,
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
      <div style={{ flex: 1, minHeight: 0 }}></div>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          borderTop: `1px solid ${colors.border}`,
        }}
      >
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
                title={`${user.name || user.login} - ${t('auth.clickToOpenMenu')}`}
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
                    <div
                      style={{ fontSize: '0.875rem', fontWeight: 'bold', color: colors.foreground }}
                    >
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
                      color: colors.foreground,
                      fontSize: '0.875rem',
                    }}
                    onClick={handleSignOut}
                  >
                    <LogOut size={16} />
                    <span>{t('auth.signOut')}</span>
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
                title={t('auth.signIn')}
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
                      {t('auth.patPrompt')}
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
                        {t('auth.patDescription', { fallback: 'Click here' })}
                      </a>
                    </div>
                  </div>
                  <input
                    type="password"
                    value={patInput}
                    onChange={e => setPATInput(e.target.value)}
                    placeholder={t('auth.patPlaceholder')}
                    style={{
                      width: '100%',
                      padding: '0.5rem',
                      background: colors.background,
                      border: `1px solid ${colors.border}`,
                      borderRadius: '0.25rem',
                      color: colors.foreground,
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
                        color: colors.background,
                        border: 'none',
                        borderRadius: '0.25rem',
                        cursor: isAuthenticating ? 'not-allowed' : 'pointer',
                        fontSize: '0.875rem',
                        opacity: isAuthenticating ? 0.5 : 1,
                      }}
                      onClick={handleSignIn}
                      disabled={isAuthenticating}
                    >
                      {isAuthenticating ? t('action.authenticating') : t('auth.signIn')}
                    </button>
                    <button
                      style={{
                        padding: '0.5rem 1rem',
                        background: 'transparent',
                        color: colors.foreground,
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
                      {t('action.cancel')}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
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
          title={t('menu.project')}
        >
          <FolderOpen size={20} />
        </button>
      </div>
    </div>
  );
}
