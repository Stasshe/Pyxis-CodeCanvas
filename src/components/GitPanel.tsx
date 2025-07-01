'use client';

import React, { useState, useEffect } from 'react';
import { GitBranch, GitCommit, RefreshCw, Plus, Check, X, GitMerge, Clock, User } from 'lucide-react';
import { GitRepository, GitCommit as GitCommitType, GitStatus } from '@/types/git';
import { GitCommands } from '@/utils/filesystem';

interface GitPanelProps {
  currentProject?: string;
  onRefresh?: () => void;
}

export default function GitPanel({ currentProject, onRefresh }: GitPanelProps) {
  const [gitRepo, setGitRepo] = useState<GitRepository | null>(null);
  const [commitMessage, setCommitMessage] = useState('');
  const [isCommitting, setIsCommitting] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  // Git操作用のコマンドインスタンス
  const gitCommands = currentProject ? new GitCommands(currentProject) : null;

  // Git状態を取得
  const fetchGitStatus = async () => {
    if (!gitCommands || !currentProject) return;

    try {
      setIsLoading(true);
      setError(null);
      console.log('Fetching git status for project:', currentProject);
      
      // まずGitリポジトリが初期化されているかチェック
      let isInitialized = false;
      try {
        console.log('Checking git status...');
        const statusResult = await gitCommands.status();
        console.log('Git status result:', statusResult);
        isInitialized = true;
        
        // Git状態を並行して取得（エラーが起きても続行）
        let logResult = '';
        let branchResult = '';
        
        try {
          logResult = await gitCommands.getFormattedLog(20);
          console.log('Git log result:', logResult);
        } catch (logError) {
          console.warn('Failed to get git log:', logError);
        }
        
        try {
          branchResult = await gitCommands.branch();
          console.log('Git branch result:', branchResult);
        } catch (branchError) {
          console.warn('Failed to get git branches:', branchError);
          branchResult = '* main'; // デフォルト値
        }

        // コミット履歴をパース
        const commits = parseGitLog(logResult);
        
        // ブランチ情報をパース
        const branches = parseGitBranches(branchResult);
        
        // ステータス情報をパース
        const status = parseGitStatus(statusResult);

        setGitRepo({
          initialized: true,
          branches,
          commits,
          status,
          currentBranch: status.branch
        });
      } catch (statusError) {
        console.log('Git status error:', statusError);
        // Gitリポジトリが初期化されていない場合
        if (statusError instanceof Error && statusError.message.includes('not a git repository')) {
          console.log('Git repository not initialized');
          setGitRepo({
            initialized: false,
            branches: [],
            commits: [],
            status: {
              staged: [],
              unstaged: [],
              untracked: [],
              branch: 'main',
              ahead: 0,
              behind: 0
            },
            currentBranch: 'main'
          });
        } else {
          // その他のエラー
          console.error('Git operation failed:', statusError);
          setError(statusError instanceof Error ? statusError.message : 'Git操作でエラーが発生しました');
          setGitRepo(null);
        }
      }
    } catch (error) {
      console.error('Failed to fetch git status:', error);
      setError(error instanceof Error ? error.message : 'Git状態の取得に失敗しました');
      setGitRepo(null);
    } finally {
      setIsLoading(false);
    }
  };

  // Git logをパースしてコミット配列に変換
  const parseGitLog = (logOutput: string): GitCommitType[] => {
    if (!logOutput || logOutput.trim() === '') {
      return [];
    }
    
    const lines = logOutput.split('\n').filter(line => line.trim());
    const commits: GitCommitType[] = [];
    
    console.log('Parsing git log lines:', lines);
    
    for (const line of lines) {
      // フォーマット: hash|message|author|date
      const parts = line.split('|');
      if (parts.length >= 4) {
        const hash = parts[0];
        const message = parts[1];
        const author = parts[2];
        const date = parts[3];
        
        console.log('Parsed commit:', { hash: hash.substring(0, 7), message, author });
        
        commits.push({
          hash,
          shortHash: hash.substring(0, 7),
          message,
          author,
          date,
          timestamp: new Date(date).getTime(),
          branch: gitRepo?.currentBranch || 'main',
          isMerge: message.toLowerCase().includes('merge'),
          parentHashes: []
        });
      }
    }
    
    const sortedCommits = commits.sort((a, b) => b.timestamp - a.timestamp);
    console.log('Final parsed commits:', sortedCommits);
    return sortedCommits;
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
      } else if (trimmed === 'Changes to be committed:') {
        inChangesToBeCommitted = true;
        inChangesNotStaged = false;
        inUntrackedFiles = false;
      } else if (trimmed === 'Changes not staged for commit:') {
        inChangesToBeCommitted = false;
        inChangesNotStaged = true;
        inUntrackedFiles = false;
      } else if (trimmed === 'Untracked files:') {
        inChangesToBeCommitted = false;
        inChangesNotStaged = false;
        inUntrackedFiles = true;
      } else if (trimmed.startsWith('modified:') || trimmed.startsWith('new file:') || trimmed.startsWith('deleted:')) {
        const fileName = trimmed.split(':')[1]?.trim();
        if (fileName) {
          if (inChangesToBeCommitted) {
            status.staged.push(fileName);
          } else if (inChangesNotStaged) {
            status.unstaged.push(fileName);
          }
        }
      } else if (inUntrackedFiles && trimmed && !trimmed.startsWith('(') && !trimmed.includes('git add')) {
        status.untracked.push(trimmed);
      }
    }

    return status;
  };

  // ファイルをステージング
  const handleStageFile = async (file: string) => {
    if (!gitCommands) return;
    
    try {
      await gitCommands.add(file);
      fetchGitStatus(); // 状態を更新
    } catch (error) {
      console.error('Failed to stage file:', error);
    }
  };

  // 全ファイルをステージング
  const handleStageAll = async () => {
    if (!gitCommands) return;
    
    try {
      await gitCommands.add('.');
      fetchGitStatus();
    } catch (error) {
      console.error('Failed to stage all files:', error);
    }
  };

  // Git初期化
  const handleInitializeGit = async () => {
    if (!gitCommands || !currentProject) return;
    
    try {
      setIsLoading(true);
      setError(null);
      console.log('Force initializing Git repository...');
      
      // Git初期化
      await gitCommands.init();
      console.log('Git init completed');
      
      // すべてのファイルをステージングして初期コミット
      try {
        await gitCommands.add('.');
        console.log('Files staged');
        
        await gitCommands.commit('Initial commit', {
          name: 'Pyxis User',
          email: 'user@pyxis.dev'
        });
        console.log('Initial commit completed');
      } catch (commitError) {
        console.warn('Initial commit failed, but git is initialized:', commitError);
      }
      
      // 状態を再取得
      fetchGitStatus();
      onRefresh?.();
    } catch (error) {
      console.error('Failed to initialize git:', error);
      setError(error instanceof Error ? error.message : 'Git初期化に失敗しました');
    } finally {
      setIsLoading(false);
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
      <div className="p-4">
        <div className="text-center text-destructive mb-4">
          <X className="w-8 h-8 mx-auto mb-2" />
          <p className="text-sm font-medium mb-2">Gitエラーが発生しました</p>
          <p className="text-xs text-muted-foreground mb-4 break-words">
            {error}
          </p>
        </div>
        
        <div className="space-y-2">
          <button
            onClick={() => {
              setError(null);
              fetchGitStatus();
            }}
            className="w-full bg-secondary text-secondary-foreground hover:bg-secondary/80 px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center justify-center gap-2"
          >
            <RefreshCw className="w-4 h-4" />
            再試行
          </button>
          
          <button
            onClick={handleInitializeGit}
            disabled={isLoading}
            className="w-full bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center justify-center gap-2"
          >
            <GitBranch className="w-4 h-4" />
            Gitリポジトリを強制初期化
          </button>
        </div>
      </div>
    );
  }

  if (!gitRepo?.initialized) {
    return (
      <div className="p-4">
        <div className="text-center text-muted-foreground mb-4">
          <GitBranch className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm mb-2">Gitリポジトリが初期化されていません</p>
          <p className="text-xs text-muted-foreground/70">
            プロジェクトでGitを使用するには初期化が必要です
          </p>
        </div>
        
        <button
          onClick={handleInitializeGit}
          disabled={isLoading}
          className="w-full bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center justify-center gap-2"
        >
          <GitBranch className="w-4 h-4" />
          Gitリポジトリを初期化
        </button>
      </div>
    );
  }

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
            className="p-1 text-muted-foreground hover:text-foreground transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
        <div className="text-xs text-muted-foreground">
          <span className="font-medium">{gitRepo.currentBranch}</span>
          {gitRepo.status.ahead > 0 && (
            <span className="ml-2 text-blue-500">↑{gitRepo.status.ahead}</span>
          )}
          {gitRepo.status.behind > 0 && (
            <span className="ml-1 text-orange-500">↓{gitRepo.status.behind}</span>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* コミット作成セクション */}
        <div className="p-3 border-b border-border">
          <div className="space-y-3">
            {/* ステージングエリア */}
            {(gitRepo.status.unstaged.length > 0 || gitRepo.status.untracked.length > 0) && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium">変更されたファイル</span>
                  <button
                    onClick={handleStageAll}
                    className="text-xs text-blue-500 hover:text-blue-400 flex items-center gap-1"
                  >
                    <Plus className="w-3 h-3" />
                    全て追加
                  </button>
                </div>
                <div className="space-y-1 max-h-24 overflow-y-auto">
                  {[...gitRepo.status.unstaged, ...gitRepo.status.untracked].map((file, index) => (
                    <div key={index} className="flex items-center justify-between text-xs p-1 rounded hover:bg-muted/50">
                      <span className="truncate flex-1">{file}</span>
                      <button
                        onClick={() => handleStageFile(file)}
                        className="text-green-500 hover:text-green-400 ml-2"
                      >
                        <Plus className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ステージ済みファイル */}
            {gitRepo.status.staged.length > 0 && (
              <div>
                <span className="text-sm font-medium text-green-500">ステージ済み ({gitRepo.status.staged.length})</span>
                <div className="space-y-1 max-h-16 overflow-y-auto mt-1">
                  {gitRepo.status.staged.map((file, index) => (
                    <div key={index} className="flex items-center text-xs text-green-500 p-1">
                      <Check className="w-3 h-3 mr-2" />
                      <span className="truncate">{file}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* コミットメッセージ入力 */}
            <div>
              <label className="text-sm font-medium block mb-1">コミットメッセージ</label>
              <textarea
                value={commitMessage}
                onChange={(e) => setCommitMessage(e.target.value)}
                placeholder="変更内容を説明してください..."
                className="w-full p-2 text-sm border border-border rounded bg-background resize-none"
                rows={2}
              />
              <button
                onClick={handleCommit}
                disabled={!commitMessage.trim() || gitRepo.status.staged.length === 0 || isCommitting}
                className="w-full mt-2 px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isCommitting ? 'コミット中...' : gitRepo.status.staged.length > 0 ? `${gitRepo.status.staged.length}個のファイルをコミット` : 'コミット'}
              </button>
            </div>
          </div>
        </div>

        {/* コミット履歴 */}
        <div className="p-3">
          <h4 className="text-sm font-medium mb-3 flex items-center justify-between">
            <span className="flex items-center gap-2">
              <Clock className="w-4 h-4" />
              コミット履歴
            </span>
            <span className="text-xs text-muted-foreground">
              {gitRepo.commits.length}件
            </span>
          </h4>
          <div className="space-y-2">
            {gitRepo.commits.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-4">
                コミット履歴がありません
              </p>
            ) : (
              gitRepo.commits.slice(0, 20).map((commit, index) => (
                <div
                  key={commit.hash}
                  className="relative flex gap-3 p-2 rounded hover:bg-muted/50 transition-colors"
                >
                  {/* コミットライン */}
                  <div className="flex flex-col items-center">
                    <div className={`w-2 h-2 rounded-full ${
                      commit.isMerge ? 'bg-purple-500' : 'bg-blue-500'
                    }`} />
                    {index < gitRepo.commits.length - 1 && (
                      <div className="w-0.5 h-6 bg-border mt-1" />
                    )}
                  </div>
                  
                  {/* コミット情報 */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-mono text-muted-foreground">
                        {commit.shortHash}
                      </span>
                      {commit.isMerge && (
                        <GitMerge className="w-3 h-3 text-purple-500" />
                      )}
                    </div>
                    <p className="text-sm font-medium leading-tight mb-1 truncate">
                      {commit.message}
                    </p>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <User className="w-3 h-3" />
                      <span>{commit.author}</span>
                      <span>•</span>
                      <span>{new Date(commit.timestamp).toLocaleDateString('ja-JP')}</span>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
