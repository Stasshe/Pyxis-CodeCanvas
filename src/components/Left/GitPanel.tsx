'use client';

import React, { useState, useEffect } from 'react';
import { useTheme } from '@/context/ThemeContext';
import { generateCommitMessage } from '@/engine/commitMsgAI';
import {
  GitBranch,
  GitCommit,
  RefreshCw,
  Plus,
  Check,
  X,
  GitMerge,
  Clock,
  User,
  Minus,
  RotateCcw,
} from 'lucide-react';
import { GitRepository, GitCommit as GitCommitType, GitStatus } from '@/types/git';
import { GitCommands } from '@/engine/cmd/git';
import GitHistory from './GitHistory';
import { LOCALSTORAGE_KEY } from '@/context/config';

interface GitPanelProps {
  currentProject?: string;
  currentProjectId?: string;
  onRefresh?: () => void;
  gitRefreshTrigger?: number;
  onGitStatusChange?: (changesCount: number) => void; // Git変更状態のコールバック
  onDiffFileClick?: (params: { commitId: string; filePath: string }) => void;
  onDiffAllFilesClick?: (params: { commitId: string; parentCommitId: string }) => void;
}

export default function GitPanel({
  currentProject,
  currentProjectId,
  onRefresh,
  gitRefreshTrigger,
  onGitStatusChange,
  onDiffFileClick,
  onDiffAllFilesClick,
}: GitPanelProps) {
  const { colors } = useTheme();
  const [gitRepo, setGitRepo] = useState<GitRepository | null>(null);
  const [commitMessage, setCommitMessage] = useState('');
  const [isCommitting, setIsCommitting] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);

  // Git操作用のコマンドインスタンス（新アーキテクチャ）
  const gitCommands =
    currentProject && currentProjectId ? new GitCommands(currentProject, currentProjectId) : null;

  // Git状態を取得
  const fetchGitStatus = async () => {
    if (!gitCommands || !currentProject) return;

    try {
      setIsLoading(true);
      setError(null);

      console.log('[GitPanel] Fetching git status...');

      // ファイルシステムの同期を確実にする
      const fs = (gitCommands as any).fs;
      if (fs && (fs as any).sync) {
        try {
          await (fs as any).sync();
          console.log('[GitPanel] FileSystem synced before status check');
        } catch (syncError) {
          console.warn('[GitPanel] FileSystem sync failed:', syncError);
        }
      }

      // ファイルシステムの変更が確実に反映されるまで待機
      await new Promise(resolve => setTimeout(resolve, 200));

      // Git状態を並行して取得
      const [statusResult, logResult, branchResult] = await Promise.all([
        gitCommands.status(),
        gitCommands.getFormattedLog(20),
        gitCommands.branch(),
      ]);

      console.log('[GitPanel] Git status result:', statusResult);

      // コミット履歴をパース
      const commits = parseGitLog(logResult);

      // ブランチ情報をパース
      const branches = parseGitBranches(branchResult);

      // ステータス情報をパース
      const status = parseGitStatus(statusResult);

      console.log('[GitPanel] Parsed status:', {
        staged: status.staged,
        unstaged: status.unstaged,
        untracked: status.untracked,
        commits: commits.length,
        branches: branches.length,
      });

      setGitRepo({
        initialized: true,
        branches,
        commits, // 直接パースしたコミットを使用（ブランチ情報含む）
        status,
        currentBranch: status.branch,
      });

      // 変更ファイル数を計算してコールバックで通知
      if (onGitStatusChange) {
        const changesCount =
          status.staged.length + status.unstaged.length + status.untracked.length;
        console.log('[GitPanel] Notifying changes count:', changesCount);
        onGitStatusChange(changesCount);
      }
    } catch (error) {
      console.error('Failed to fetch git status:', error);
      setError(error instanceof Error ? error.message : 'Git操作でエラーが発生しました');
      setGitRepo(null);
      // エラー時は変更ファイル数を0にリセット
      if (onGitStatusChange) {
        onGitStatusChange(0);
      }
    } finally {
      setIsLoading(false);
    }
  };

  // Git logをパースしてコミット配列に変換（ブランチ情報付き）
  const parseGitLog = (logOutput: string): GitCommitType[] => {
    if (!logOutput.trim()) {
      return [];
    }

    const lines = logOutput.split('\n').filter(line => line.trim());
    const commits: GitCommitType[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const parts = line.split('|');

      // 6つのパーツがあることを確認（ブランチ情報を含む）
      if (parts.length === 6) {
        const hash = parts[0]?.trim();
        const message = parts[1]?.trim();
        const author = parts[2]?.trim();
        const date = parts[3]?.trim();
        const parentHashesStr = parts[4]?.trim();
        const branch = parts[5]?.trim();

        // 全てのフィールドが有効であることを確認
        if (hash && hash.length >= 7 && message && author && date && branch) {
          try {
            const timestamp = new Date(date).getTime();
            if (!isNaN(timestamp)) {
              // 親コミットのハッシュをパース
              const parentHashes =
                parentHashesStr && parentHashesStr !== ''
                  ? parentHashesStr.split(',').filter(h => h.trim() !== '')
                  : [];

              commits.push({
                hash,
                shortHash: hash.substring(0, 7),
                message: message.replace(/｜/g, '|'), // 安全な文字を元に戻す
                author: author.replace(/｜/g, '|'),
                date,
                timestamp,
                branch: branch, // 実際のブランチ情報を使用
                isMerge: message.toLowerCase().includes('merge'),
                parentHashes,
              });
            }
          } catch (dateError) {
            // Date parsing error, skip this commit
          }
        }
      } else if (parts.length === 5) {
        // 古いフォーマット（ブランチ情報なし）との互換性
        const hash = parts[0]?.trim();
        const message = parts[1]?.trim();
        const author = parts[2]?.trim();
        const date = parts[3]?.trim();
        const parentHashesStr = parts[4]?.trim();

        if (hash && hash.length >= 7 && message && author && date) {
          try {
            const timestamp = new Date(date).getTime();
            if (!isNaN(timestamp)) {
              const parentHashes =
                parentHashesStr && parentHashesStr !== ''
                  ? parentHashesStr.split(',').filter(h => h.trim() !== '')
                  : [];

              commits.push({
                hash,
                shortHash: hash.substring(0, 7),
                message: message.replace(/｜/g, '|'),
                author: author.replace(/｜/g, '|'),
                date,
                timestamp,
                branch: 'main', // デフォルトはmain
                isMerge: message.toLowerCase().includes('merge'),
                parentHashes,
              });
            }
          } catch (dateError) {
            // Date parsing error, skip this commit
          }
        }
      }
    }

    return commits.sort((a, b) => b.timestamp - a.timestamp);
  };

  // Git branchをパース
  const parseGitBranches = (branchOutput: string) => {
    return branchOutput
      .split('\n')
      .filter(line => line.trim())
      .map(line => ({
        name: line.replace(/^\*\s*/, '').trim(),
        isCurrent: line.startsWith('*'),
        isRemote: line.includes('remotes/'),
        lastCommit: undefined,
      }));
  };

  // Git statusをパース
  const parseGitStatus = (statusOutput: string): GitStatus => {
    console.log('[GitPanel] Parsing git status output:', statusOutput);
    const lines = statusOutput.split('\n');
    const status: GitStatus = {
      staged: [],
      unstaged: [],
      untracked: [],
      branch: 'main',
      ahead: 0,
      behind: 0,
    };

    let inChangesToBeCommitted = false;
    let inChangesNotStaged = false;
    let inUntrackedFiles = false;

    for (const line of lines) {
      const trimmed = line.trim();

      if (trimmed.includes('On branch')) {
        status.branch = trimmed.replace('On branch ', '').trim();
        console.log('[GitPanel] Found branch:', status.branch);
      } else if (trimmed === 'Changes to be committed:') {
        inChangesToBeCommitted = true;
        inChangesNotStaged = false;
        inUntrackedFiles = false;
        console.log('[GitPanel] Entering staged files section');
      } else if (trimmed === 'Changes not staged for commit:') {
        inChangesToBeCommitted = false;
        inChangesNotStaged = true;
        inUntrackedFiles = false;
        console.log('[GitPanel] Entering unstaged files section');
      } else if (trimmed === 'Untracked files:') {
        inChangesToBeCommitted = false;
        inChangesNotStaged = false;
        inUntrackedFiles = true;
        console.log('[GitPanel] Entering untracked files section');
      } else if (
        trimmed.startsWith('modified:') ||
        trimmed.startsWith('new file:') ||
        trimmed.startsWith('deleted:')
      ) {
        const fileName = trimmed.split(':')[1]?.trim();
        if (fileName) {
          if (inChangesToBeCommitted) {
            status.staged.push(fileName);
            console.log('[GitPanel] Found staged file:', fileName);
          } else if (inChangesNotStaged) {
            status.unstaged.push(fileName);
            console.log('[GitPanel] Found unstaged file:', fileName);
          }
        }
      } else if (
        inUntrackedFiles &&
        trimmed &&
        !trimmed.startsWith('(') &&
        !trimmed.includes('git add') &&
        !trimmed.includes('use "git add"') &&
        !trimmed.includes('to include')
      ) {
        // フォルダ（末尾に/があるもの）は除外
        if (!trimmed.endsWith('/')) {
          status.untracked.push(trimmed);
          console.log('[GitPanel] Found untracked file:', trimmed);
        }
      }
    }

    console.log('[GitPanel] Final parsed status:', {
      staged: status.staged,
      unstaged: status.unstaged,
      untracked: status.untracked,
      total: status.staged.length + status.unstaged.length + status.untracked.length,
    });

    return status;
  };

  // ファイルをステージング
  const handleStageFile = async (file: string) => {
    if (!gitCommands) return;

    try {
      console.log('[GitPanel] Staging file:', file);
      await gitCommands.add(file);

      // ステージング後十分な時間待ってから状態を更新
      setTimeout(() => {
        console.log('[GitPanel] Refreshing status after staging');
        fetchGitStatus();
      }, 200);
    } catch (error) {
      console.error('Failed to stage file:', error);
    }
  };

  // ファイルをアンステージング
  const handleUnstageFile = async (file: string) => {
    if (!gitCommands) return;

    try {
      await gitCommands.reset({ filepath: file });
      fetchGitStatus();
    } catch (error) {
      console.error('Failed to unstage file:', error);
    }
  };

  // 全ファイルをステージング
  const handleStageAll = async () => {
    if (!gitCommands) return;

    try {
      console.log('[GitPanel] Staging all files');
      await gitCommands.add('.');

      // ステージング後十分な時間待ってから状態を更新
      setTimeout(() => {
        console.log('[GitPanel] Refreshing status after staging all');
        fetchGitStatus();
      }, 300);
    } catch (error) {
      console.error('Failed to stage all files:', error);
    }
  };

  // 全ファイルをアンステージング
  const handleUnstageAll = async () => {
    if (!gitCommands) return;

    try {
      await gitCommands.reset();
      fetchGitStatus();
    } catch (error) {
      console.error('Failed to unstage all files:', error);
    }
  };

  // ファイルの変更を破棄
  const handleDiscardChanges = async (file: string) => {
    if (!gitCommands) return;

    try {
      console.log('[GitPanel] Starting discard changes for file:', file);
      const result = await gitCommands.discardChanges(file);
      console.log('[GitPanel] Discard changes result:', result);

      // 少し待ってからGit状態を更新（ファイルシステムの同期を待つ）
      setTimeout(async () => {
        console.log('[GitPanel] Refreshing git status after discard...');
        await fetchGitStatus();

        // 親コンポーネントにも更新を通知
        if (onRefresh) {
          console.log('[GitPanel] Calling onRefresh after discard...');
          onRefresh();
        }
      }, 200);
    } catch (error) {
      console.error('Failed to discard changes:', error);
    }
  };

  // コミット実行
  const handleCommit = async () => {
    if (!gitCommands || !commitMessage.trim()) return;
    try {
      setIsCommitting(true);
      await gitCommands.commit(commitMessage.trim());
      setCommitMessage('');
      //この後の更新処理は、他で自動でやるのでしない。書くと表示バグる
    } catch (error) {
      console.error('Failed to commit:', error);
    } finally {
      setIsCommitting(false);
    }
  };

  // コミットメッセージ自動生成
  const handleGenerateCommitMessage = async () => {
    if (!gitCommands || !apiKey) return;
    setIsGenerating(true);
    try {
      // 実際のdiff内容を取得
      const diffText = await gitCommands.diff({ staged: false });
      const message = await generateCommitMessage(diffText, apiKey);
      setCommitMessage(message);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Gemini APIエラー');
    } finally {
      setIsGenerating(false);
    }
  };

  // APIキーをlocalStorageから初期化
  useEffect(() => {
    const savedKey = localStorage.getItem(LOCALSTORAGE_KEY.GEMINI_API_KEY) || '';
    setApiKey(savedKey);
  }, []);

  const hasApiKey = !!apiKey;

  // APIキー入力時にlocalStorageへ保存
  const handleApiKeyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setApiKey(value);
    localStorage.setItem(LOCALSTORAGE_KEY.GEMINI_API_KEY, value);
  };

  // 初期化とプロジェクト変更時の更新
  useEffect(() => {
    if (currentProject) {
      fetchGitStatus();
    }
  }, [currentProject]);

  // Git更新トリガーが変更されたときの更新
  useEffect(() => {
    if (currentProject && gitRefreshTrigger !== undefined && gitRefreshTrigger > 0) {
      console.log('[GitPanel] Git refresh trigger fired:', gitRefreshTrigger);
      // ファイル同期完了を待つために適度な遅延
      const timer = setTimeout(() => {
        console.log('[GitPanel] Executing delayed git status fetch');
        fetchGitStatus();
      }, 200);
      return () => clearTimeout(timer);
    }
  }, [gitRefreshTrigger]);

  if (!currentProject) {
    return (
      <div style={{ padding: '1rem', textAlign: 'center', color: colors.mutedFg }}>
        <GitBranch
          style={{
            width: '2rem',
            height: '2rem',
            display: 'block',
            margin: '0 auto 0.5rem',
            opacity: 0.5,
            color: colors.mutedFg,
          }}
        />
        <p style={{ fontSize: '0.875rem' }}>プロジェクトを選択してください</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div style={{ padding: '1rem', textAlign: 'center', color: colors.mutedFg }}>
        <RefreshCw
          style={{
            width: '1.5rem',
            height: '1.5rem',
            display: 'block',
            margin: '0 auto 0.5rem',
            animation: 'spin 1s linear infinite',
            color: colors.mutedFg,
          }}
        />
        <p style={{ fontSize: '0.875rem' }}>Git状態を読み込み中...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: '1rem', textAlign: 'center', color: colors.red }}>
        <X
          style={{
            width: '2rem',
            height: '2rem',
            display: 'block',
            margin: '0 auto 0.5rem',
            color: colors.red,
          }}
        />
        <p style={{ fontSize: '0.875rem', marginBottom: '0.5rem' }}>エラーが発生しました</p>
        <p style={{ fontSize: '0.75rem', color: colors.mutedFg }}>{error}</p>
        <button
          onClick={fetchGitStatus}
          style={{
            marginTop: '0.5rem',
            padding: '0.5rem 1rem',
            fontSize: '0.75rem',
            background: colors.mutedBg,
            color: colors.foreground,
            borderRadius: '0.375rem',
            border: 'none',
            cursor: 'pointer',
          }}
        >
          再試行
        </button>
      </div>
    );
  }

  if (!gitRepo) {
    return (
      <div style={{ padding: '1rem', textAlign: 'center', color: colors.mutedFg }}>
        <GitBranch
          style={{
            width: '2rem',
            height: '2rem',
            display: 'block',
            margin: '0 auto 0.5rem',
            opacity: 0.5,
            color: colors.mutedFg,
          }}
        />
        <p style={{ fontSize: '0.875rem' }}>Git情報を取得できませんでした</p>
      </div>
    );
  }

  const hasChanges =
    gitRepo.status.staged.length > 0 ||
    gitRepo.status.unstaged.length > 0 ||
    gitRepo.status.untracked.length > 0;

  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: colors.cardBg,
      }}
    >
      {/* ヘッダー */}
      <div style={{ padding: '0.25rem', borderBottom: `1px solid ${colors.border}` }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: '0.5rem',
          }}
        >
          <h3
            style={{
              fontWeight: 500,
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              fontSize: '1rem',
              color: colors.foreground,
            }}
          >
            <GitBranch style={{ width: '1rem', height: '1rem', color: colors.primary }} />
            Git
            <div style={{ fontSize: '0.75rem', color: colors.mutedFg }}>
              <span style={{ fontWeight: 500 }}>{gitRepo.currentBranch}</span>
              {gitRepo.commits.length > 0 && (
                <span style={{ marginLeft: '0.5rem' }}>• {gitRepo.commits.length} コミット</span>
              )}
            </div>
          </h3>
          <button
            onClick={fetchGitStatus}
            style={{
              padding: '0.25rem',
              background: 'transparent',
              borderRadius: '0.375rem',
              border: 'none',
              cursor: 'pointer',
            }}
            className="select-none"
            title="更新"
            onMouseEnter={e => (e.currentTarget.style.background = colors.mutedBg)}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            <RefreshCw
              style={{ width: '1rem', height: '1rem', color: colors.mutedFg }}
              className="select-none"
            />
          </button>
        </div>
      </div>
      {/* コミット */}
      {gitRepo.status.staged.length > 0 && (
        <div style={{ padding: '0.3rem', borderBottom: `1px solid ${colors.border}` }}>
          {/* <h4 style={{ fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem', color: colors.foreground }}>コミット</h4> */}
          {/* APIキー入力欄（未保存時のみ表示） */}
          {!hasApiKey && (
            <input
              type="text"
              value={apiKey}
              onChange={handleApiKeyChange}
              placeholder="Gemini APIキーを入力"
              style={{
                width: '100%',
                marginBottom: '0.5rem',
                fontSize: '0.75rem',
                border: `1px solid ${colors.border}`,
                borderRadius: '0.375rem',
                padding: '0.25rem 0.5rem',
                background: colors.background,
                color: colors.foreground,
              }}
            />
          )}
          <textarea
            value={commitMessage}
            onChange={e => setCommitMessage(e.target.value)}
            placeholder="コミットメッセージを入力..."
            style={{
              width: '100%',
              height: '4rem',
              fontSize: '0.75rem',
              border: `1px solid ${colors.border}`,
              borderRadius: '0.375rem',
              padding: '0.25rem 0.5rem',
              resize: 'none',
              background: colors.background,
              color: colors.foreground,
            }}
            className="select-text"
          />
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
            <button
              onClick={handleGenerateCommitMessage}
              disabled={!apiKey || isGenerating}
              style={{
                flex: 1,
                background: '#22c55e',
                color: 'white',
                borderRadius: '0.375rem',
                padding: '0.5rem 1rem',
                fontSize: '0.75rem',
                fontWeight: 500,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.5rem',
                border: 'none',
                cursor: isGenerating || !apiKey ? 'not-allowed' : 'pointer',
                opacity: isGenerating || !apiKey ? 0.5 : 1,
              }}
              className="select-none"
            >
              {isGenerating ? (
                <RefreshCw
                  style={{
                    width: '0.75rem',
                    height: '0.75rem',
                    animation: 'spin 1s linear infinite',
                  }}
                  className="select-none"
                />
              ) : (
                <Plus
                  style={{ width: '0.75rem', height: '0.75rem' }}
                  className="select-none"
                />
              )}
              {isGenerating ? '生成中...' : '自動生成'}
            </button>
            <button
              onClick={handleCommit}
              disabled={!commitMessage.trim() || isCommitting}
              style={{
                flex: 1,
                background: colors.primary,
                color: colors.background,
                borderRadius: '0.375rem',
                padding: '0.5rem 1rem',
                fontSize: '0.75rem',
                fontWeight: 500,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.5rem',
                border: 'none',
                cursor: isCommitting || !commitMessage.trim() ? 'not-allowed' : 'pointer',
                opacity: isCommitting || !commitMessage.trim() ? 0.5 : 1,
              }}
              className="select-none"
            >
              {isCommitting ? (
                <RefreshCw
                  style={{
                    width: '0.75rem',
                    height: '0.75rem',
                    animation: 'spin 1s linear infinite',
                  }}
                  className="select-none"
                />
              ) : (
                <GitCommit
                  style={{ width: '0.75rem', height: '0.75rem' }}
                  className="select-none"
                />
              )}
              {isCommitting ? 'コミット中...' : 'コミット'}
            </button>
          </div>
        </div>
      )}

      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {/* 変更ファイル（スクロール可能・最大高さ45%） */}
        <div
          style={{
            padding: '0.75rem',
            borderBottom: `1px solid ${colors.border}`,
            maxHeight: '45%',
            overflowY: 'auto',
            minHeight: 0,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '0.5rem',
            }}
          >
            <h4 style={{ fontSize: '0.875rem', fontWeight: 500, color: colors.foreground }}>
              変更
            </h4>
            {hasChanges && (
              <div style={{ display: 'flex', gap: '0.25rem' }}>
                <button
                  onClick={handleStageAll}
                  style={{
                    padding: '0.25rem',
                    background: 'transparent',
                    borderRadius: '0.375rem',
                    border: 'none',
                    fontSize: '0.75rem',
                    cursor: 'pointer',
                  }}
                  title="全てステージング"
                  className="select-none"
                  onMouseEnter={e => (e.currentTarget.style.background = colors.mutedBg)}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <Plus
                    style={{ width: '0.75rem', height: '0.75rem', color: colors.primary }}
                    className="select-none"
                  />
                </button>
                <button
                  onClick={handleUnstageAll}
                  style={{
                    padding: '0.25rem',
                    background: 'transparent',
                    borderRadius: '0.375rem',
                    border: 'none',
                    fontSize: '0.75rem',
                    cursor: 'pointer',
                  }}
                  title="全てアンステージング"
                  className="select-none"
                  onMouseEnter={e => (e.currentTarget.style.background = colors.mutedBg)}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <Minus
                    style={{ width: '0.75rem', height: '0.75rem', color: colors.primary }}
                    className="select-none"
                  />
                </button>
              </div>
            )}
          </div>

          {!hasChanges ? (
            <p style={{ fontSize: '0.75rem', color: colors.mutedFg }}>変更はありません</p>
          ) : (
            <div>
              {/* ステージされたファイル */}
              {gitRepo.status.staged.length > 0 && (
                <div>
                  <p style={{ fontSize: '0.75rem', color: '#22c55e', marginBottom: '0.25rem' }}>
                    ステージ済み ({gitRepo.status.staged.length})
                  </p>
                  {gitRepo.status.staged.map(file => (
                    <div
                      key={`staged-${file}`}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        fontSize: '0.75rem',
                        padding: '0.25rem 0',
                      }}
                    >
                      <span
                        style={{
                          color: '#22c55e',
                          flex: 1,
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                        className="select-text"
                      >
                        {file}
                      </span>
                      <button
                        onClick={() => handleUnstageFile(file)}
                        style={{
                          padding: '0.25rem',
                          background: 'transparent',
                          borderRadius: '0.375rem',
                          marginLeft: '0.25rem',
                          border: 'none',
                          cursor: 'pointer',
                        }}
                        title="アンステージング"
                        className="select-none"
                        onMouseEnter={e => (e.currentTarget.style.background = colors.mutedBg)}
                        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                      >
                        <Minus
                          style={{ width: '0.75rem', height: '0.75rem', color: colors.primary }}
                          className="select-none"
                        />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* 変更されたファイル */}
              {gitRepo.status.unstaged.length > 0 && (
                <div>
                  <p style={{ fontSize: '0.75rem', color: '#f59e42', marginBottom: '0.25rem' }}>
                    変更済み ({gitRepo.status.unstaged.length})
                  </p>
                  {gitRepo.status.unstaged.map(file => (
                    <div
                      key={`unstaged-${file}`}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        fontSize: '0.75rem',
                        padding: '0.25rem 0',
                      }}
                    >
                      <span
                        style={{
                          color: '#f59e42',
                          flex: 1,
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          cursor: 'pointer',
                          textDecoration: 'underline',
                        }}
                        className="select-text"
                        title="diffを表示"
                        onClick={async () => {
                          if (onDiffFileClick && gitRepo.commits.length > 0) {
                            // 最新コミットのhashを取得
                            const latestCommit = gitRepo.commits[0];
                            // working directoryと最新コミットのdiff
                            onDiffFileClick({ commitId: latestCommit.hash, filePath: file });
                          }
                        }}
                      >
                        {file}
                      </span>
                      <div style={{ display: 'flex', gap: '0.25rem' }}>
                        <button
                          onClick={() => handleStageFile(file)}
                          style={{
                            padding: '0.25rem',
                            background: 'transparent',
                            borderRadius: '0.375rem',
                            border: 'none',
                            cursor: 'pointer',
                          }}
                          title="ステージング"
                          className="select-none"
                          onMouseEnter={e => (e.currentTarget.style.background = colors.mutedBg)}
                          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                        >
                          <Plus
                            style={{ width: '0.75rem', height: '0.75rem', color: colors.primary }}
                            className="select-none"
                          />
                        </button>
                        <button
                          onClick={() => handleDiscardChanges(file)}
                          style={{
                            padding: '0.25rem',
                            background: 'transparent',
                            borderRadius: '0.375rem',
                            border: 'none',
                            cursor: 'pointer',
                            color: colors.red,
                          }}
                          title="変更を破棄"
                          className="select-none"
                          onMouseEnter={e => (e.currentTarget.style.background = colors.mutedBg)}
                          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                        >
                          <RotateCcw
                            style={{ width: '0.75rem', height: '0.75rem', color: colors.red }}
                            className="select-none"
                          />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* 未追跡ファイル */}
              {gitRepo.status.untracked.length > 0 && (
                <div>
                  <p
                    style={{ fontSize: '0.75rem', color: colors.primary, marginBottom: '0.25rem' }}
                  >
                    未追跡 ({gitRepo.status.untracked.length})
                  </p>
                  {gitRepo.status.untracked.map(file => (
                    <div
                      key={`untracked-${file}`}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        fontSize: '0.75rem',
                        padding: '0.25rem 0',
                      }}
                    >
                      <span
                        style={{
                          color: colors.primary,
                          flex: 1,
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                        className="select-text"
                      >
                        {file}
                      </span>
                      <div style={{ display: 'flex', gap: '0.25rem' }}>
                        <button
                          onClick={() => handleStageFile(file)}
                          style={{
                            padding: '0.25rem',
                            background: 'transparent',
                            borderRadius: '0.375rem',
                            border: 'none',
                            cursor: 'pointer',
                          }}
                          title="ステージング"
                          className="select-none"
                          onMouseEnter={e => (e.currentTarget.style.background = colors.mutedBg)}
                          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                        >
                          <Plus
                            style={{ width: '0.75rem', height: '0.75rem', color: colors.primary }}
                            className="select-none"
                          />
                        </button>
                        <button
                          onClick={() => handleDiscardChanges(file)}
                          style={{
                            padding: '0.25rem',
                            background: 'transparent',
                            borderRadius: '0.375rem',
                            border: 'none',
                            cursor: 'pointer',
                            color: colors.red,
                          }}
                          title="ファイルを削除"
                          className="select-none"
                          onMouseEnter={e => (e.currentTarget.style.background = colors.mutedBg)}
                          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                        >
                          <RotateCcw
                            style={{ width: '0.75rem', height: '0.75rem', color: colors.red }}
                            className="select-none"
                          />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* コミット履歴 */}
        <div style={{ padding: '0.75rem', borderBottom: `1px solid ${colors.border}` }}>
          <h4
            style={{
              fontSize: '0.875rem',
              fontWeight: 500,
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              color: colors.foreground,
            }}
          >
            <Clock style={{ width: '1rem', height: '1rem', color: colors.mutedFg }} />
            履歴 ({gitRepo.commits.length})
          </h4>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
          {gitRepo.commits.length === 0 ? (
            <div style={{ padding: '0.75rem' }}>
              <p style={{ fontSize: '0.75rem', color: colors.mutedFg }}>コミット履歴がありません</p>
            </div>
          ) : (
            <GitHistory
              commits={gitRepo.commits}
              currentProject={currentProject}
              currentProjectId={currentProjectId}
              currentBranch={gitRepo.currentBranch}
              onDiffFileClick={onDiffFileClick}
              onDiffAllFilesClick={onDiffAllFilesClick}
            />
          )}
        </div>
      </div>
    </div>
  );
}
