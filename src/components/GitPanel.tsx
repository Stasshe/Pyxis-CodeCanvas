'use client';

import React, { useState, useEffect } from 'react';
import { GitBranch, GitCommit, RefreshCw, Plus, Check, X, GitMerge, Clock, User, Minus, RotateCcw } from 'lucide-react';
import { GitRepository, GitCommit as GitCommitType, GitStatus } from '@/types/git';
import { GitCommands } from '@/utils/cmd/git';
import GitHistory from './GitHistory';

interface GitPanelProps {
  currentProject?: string;
  onRefresh?: () => void;
  gitRefreshTrigger?: number;
  onFileOperation?: (path: string, type: 'file' | 'folder' | 'delete', content?: string) => Promise<void>;
  onGitStatusChange?: (changesCount: number) => void; // Git変更状態のコールバック
}

export default function GitPanel({ currentProject, onRefresh, gitRefreshTrigger, onFileOperation, onGitStatusChange }: GitPanelProps) {
  const [gitRepo, setGitRepo] = useState<GitRepository | null>(null);
  const [commitMessage, setCommitMessage] = useState('');
  const [isCommitting, setIsCommitting] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Git操作用のコマンドインスタンス
  const gitCommands = currentProject ? new GitCommands(currentProject, onFileOperation) : null;

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
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Git状態を並行して取得
      const [statusResult, logResult, branchResult] = await Promise.all([
        gitCommands.status(),
        gitCommands.getFormattedLog(20),
        gitCommands.branch()
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
        branches: branches.length
      });

      setGitRepo({
        initialized: true,
        branches,
        commits, // 直接パースしたコミットを使用（ブランチ情報含む）
        status,
        currentBranch: status.branch
      });

      // 変更ファイル数を計算してコールバックで通知
      if (onGitStatusChange) {
        const changesCount = status.staged.length + status.unstaged.length + status.untracked.length;
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
              const parentHashes = parentHashesStr && parentHashesStr !== '' 
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
                parentHashes
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
              const parentHashes = parentHashesStr && parentHashesStr !== '' 
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
                parentHashes
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
    return branchOutput.split('\n')
      .filter(line => line.trim())
      .map(line => ({
        name: line.replace(/^\*\s*/, '').trim(),
        isCurrent: line.startsWith('*'),
        isRemote: line.includes('remotes/'),
        lastCommit: undefined
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
      behind: 0
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
      } else if (trimmed.startsWith('modified:') || trimmed.startsWith('new file:') || trimmed.startsWith('deleted:')) {
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
      } else if (inUntrackedFiles && trimmed && 
                 !trimmed.startsWith('(') && 
                 !trimmed.includes('git add') && 
                 !trimmed.includes('use "git add"') &&
                 !trimmed.includes('to include')) {
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
      total: status.staged.length + status.unstaged.length + status.untracked.length
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
      }, 500);
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
      }, 600);
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
      const result = await gitCommands.discardChanges(file);
      
      // 少し待ってからGit状態を更新（ファイルシステムの同期を待つ）
      setTimeout(async () => {
        await fetchGitStatus();
        
        // 親コンポーネントにも更新を通知
        if (onRefresh) {
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
      fetchGitStatus();
      onRefresh?.();
    } catch (error) {
      console.error('Failed to commit:', error);
    } finally {
      setIsCommitting(false);
    }
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
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [gitRefreshTrigger]);

  if (!currentProject) {
    return (
      <div className="p-4 text-center text-muted-foreground">
        <GitBranch className="w-8 h-8 mx-auto mb-2 opacity-50" />
        <p className="text-sm">プロジェクトを選択してください</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="p-4 text-center text-muted-foreground">
        <RefreshCw className="w-6 h-6 mx-auto mb-2 animate-spin" />
        <p className="text-sm">Git状態を読み込み中...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 text-center text-red-500">
        <X className="w-8 h-8 mx-auto mb-2" />
        <p className="text-sm mb-2">エラーが発生しました</p>
        <p className="text-xs text-muted-foreground">{error}</p>
        <button
          onClick={fetchGitStatus}
          className="mt-2 px-3 py-1 text-xs bg-muted hover:bg-muted/80 rounded"
        >
          再試行
        </button>
      </div>
    );
  }

  if (!gitRepo) {
    return (
      <div className="p-4 text-center text-muted-foreground">
        <GitBranch className="w-8 h-8 mx-auto mb-2 opacity-50" />
        <p className="text-sm">Git情報を取得できませんでした</p>
      </div>
    );
  }

  const hasChanges = gitRepo.status.staged.length > 0 || 
                   gitRepo.status.unstaged.length > 0 || 
                   gitRepo.status.untracked.length > 0;

  return (
    <div className="h-full flex flex-col bg-card">
      {/* ヘッダー */}
      <div className="p-3 border-b border-border">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-medium flex items-center gap-2">
            <GitBranch className="w-4 h-4" />
            Git
          </h3>
          <button
            onClick={fetchGitStatus}
            className="p-1 hover:bg-muted rounded"
            title="更新"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
        
        <div className="text-xs text-muted-foreground">
          <span className="font-medium">{gitRepo.currentBranch}</span>
          {gitRepo.commits.length > 0 && (
            <span className="ml-2">• {gitRepo.commits.length} コミット</span>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* 変更ファイル */}
        <div className="p-3 border-b border-border">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-medium">変更</h4>
            {hasChanges && (
              <div className="flex gap-1">
                <button
                  onClick={handleStageAll}
                  className="p-1 hover:bg-muted rounded text-xs"
                  title="全てステージング"
                >
                  <Plus className="w-3 h-3" />
                </button>
                <button
                  onClick={handleUnstageAll}
                  className="p-1 hover:bg-muted rounded text-xs"
                  title="全てアンステージング"
                >
                  <Minus className="w-3 h-3" />
                </button>
              </div>
            )}
          </div>

          {!hasChanges ? (
            <p className="text-xs text-muted-foreground">変更はありません</p>
          ) : (
            <div className="space-y-1">
              {/* ステージされたファイル */}
              {gitRepo.status.staged.length > 0 && (
                <div>
                  <p className="text-xs text-green-600 mb-1">ステージ済み ({gitRepo.status.staged.length})</p>
                  {gitRepo.status.staged.map((file) => (
                    <div key={`staged-${file}`} className="flex items-center justify-between text-xs py-1">
                      <span className="text-green-600 flex-1 truncate">{file}</span>
                      <button
                        onClick={() => handleUnstageFile(file)}
                        className="p-1 hover:bg-muted rounded ml-1"
                        title="アンステージング"
                      >
                        <Minus className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* 変更されたファイル */}
              {gitRepo.status.unstaged.length > 0 && (
                <div>
                  <p className="text-xs text-orange-600 mb-1">変更済み ({gitRepo.status.unstaged.length})</p>
                  {gitRepo.status.unstaged.map((file) => (
                    <div key={`unstaged-${file}`} className="flex items-center justify-between text-xs py-1">
                      <span className="text-orange-600 flex-1 truncate">{file}</span>
                      <div className="flex gap-1">
                        <button
                          onClick={() => handleStageFile(file)}
                          className="p-1 hover:bg-muted rounded"
                          title="ステージング"
                        >
                          <Plus className="w-3 h-3" />
                        </button>
                        <button
                          onClick={() => handleDiscardChanges(file)}
                          className="p-1 hover:bg-muted rounded text-red-500"
                          title="変更を破棄"
                        >
                          <RotateCcw className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* 未追跡ファイル */}
              {gitRepo.status.untracked.length > 0 && (
                <div>
                  <p className="text-xs text-blue-600 mb-1">未追跡 ({gitRepo.status.untracked.length})</p>
                  {gitRepo.status.untracked.map((file) => (
                    <div key={`untracked-${file}`} className="flex items-center justify-between text-xs py-1">
                      <span className="text-blue-600 flex-1 truncate">{file}</span>
                      <div className="flex gap-1">
                        <button
                          onClick={() => handleStageFile(file)}
                          className="p-1 hover:bg-muted rounded"
                          title="ステージング"
                        >
                          <Plus className="w-3 h-3" />
                        </button>
                        <button
                          onClick={() => handleDiscardChanges(file)}
                          className="p-1 hover:bg-muted rounded text-red-500"
                          title="ファイルを削除"
                        >
                          <RotateCcw className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* コミット */}
        {gitRepo.status.staged.length > 0 && (
          <div className="p-3 border-b border-border">
            <h4 className="text-sm font-medium mb-2">コミット</h4>
            <textarea
              value={commitMessage}
              onChange={(e) => setCommitMessage(e.target.value)}
              placeholder="コミットメッセージを入力..."
              className="w-full h-16 text-xs border border-border rounded px-2 py-1 resize-none bg-background"
            />
            <button
              onClick={handleCommit}
              disabled={!commitMessage.trim() || isCommitting}
              className="w-full mt-2 bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed px-3 py-1 rounded text-xs font-medium transition-colors flex items-center justify-center gap-2"
            >
              {isCommitting ? (
                <RefreshCw className="w-3 h-3 animate-spin" />
              ) : (
                <GitCommit className="w-3 h-3" />
              )}
              {isCommitting ? 'コミット中...' : 'コミット'}
            </button>
          </div>
        )}

        {/* コミット履歴 */}
        <div className="flex-1 flex flex-col">
          <div className="p-3 border-b border-border">
            <h4 className="text-sm font-medium flex items-center gap-2">
              <Clock className="w-4 h-4" />
              履歴 ({gitRepo.commits.length})
            </h4>
          </div>
          
          <div className="flex-1 overflow-hidden">
            {gitRepo.commits.length === 0 ? (
              <div className="p-3">
                <p className="text-xs text-muted-foreground">コミット履歴がありません</p>
              </div>
            ) : (
              <GitHistory
                commits={gitRepo.commits}
                currentProject={currentProject}
                currentBranch={gitRepo.currentBranch}
                onFileOperation={onFileOperation}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
