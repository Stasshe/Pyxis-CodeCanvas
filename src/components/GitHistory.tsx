'use client';

import React, { useState, useEffect, useRef } from 'react';
import { 
  GitCommit, 
  GitBranch, 
  ChevronRight, 
  ChevronDown, 
  FileText, 
  FilePlus, 
  FileMinus,
  User,
  Calendar,
  Hash
} from 'lucide-react';
import { GitCommit as GitCommitType } from '@/types/git';
import { GitCommands } from '@/utils/cmd/git';

interface GitHistoryProps {
  commits: GitCommitType[];
  currentProject?: string;
  currentBranch: string;
  onFileOperation?: (path: string, type: 'file' | 'folder' | 'delete', content?: string) => Promise<void>;
}

interface CommitChanges {
  added: string[];
  modified: string[];
  deleted: string[];
}

interface ExtendedCommit extends GitCommitType {
  x: number;
  y: number;
  branchColor: string;
  changes?: CommitChanges;
}

export default function GitHistory({ commits, currentProject, currentBranch, onFileOperation }: GitHistoryProps) {
  const [extendedCommits, setExtendedCommits] = useState<ExtendedCommit[]>([]);
  const [expandedCommits, setExpandedCommits] = useState<Set<string>>(new Set());
  const [commitChanges, setCommitChanges] = useState<Map<string, CommitChanges>>(new Map());
  const svgRef = useRef<SVGSVGElement>(null);
  const gitCommands = currentProject ? new GitCommands(currentProject, onFileOperation) : null;

  // ブランチカラーのパレット
  const branchColors = [
    '#3b82f6', // blue
    '#10b981', // emerald
    '#f59e0b', // amber
    '#ef4444', // red
    '#8b5cf6', // violet
    '#06b6d4', // cyan
    '#f97316', // orange
    '#84cc16', // lime
  ];

  // コミットの位置とブランチカラーを計算
  useEffect(() => {
    if (commits.length === 0) return;

    const branchMap = new Map<string, number>();
    let branchIndex = 0;
    const ROW_HEIGHT = 60;
    const BRANCH_WIDTH = 30;

    const processedCommits: ExtendedCommit[] = commits.map((commit, index) => {
      // ブランチのインデックスを取得または作成
      if (!branchMap.has(commit.branch)) {
        branchMap.set(commit.branch, branchIndex++);
      }
      
      const branchIdx = branchMap.get(commit.branch) || 0;
      const colorIndex = branchIdx % branchColors.length;

      return {
        ...commit,
        x: branchIdx * BRANCH_WIDTH + 20,
        y: index * ROW_HEIGHT + 30,
        branchColor: branchColors[colorIndex]
      };
    });

    setExtendedCommits(processedCommits);
  }, [commits]);

  // コミットの変更ファイルを取得
  const getCommitChanges = async (commitHash: string) => {
    if (!gitCommands || commitChanges.has(commitHash)) return;

    try {
      // 現在のコミットとその親コミットを比較
      const currentCommit = commits.find(c => c.hash === commitHash);
      if (!currentCommit || currentCommit.parentHashes.length === 0) {
        // 親コミットがない場合（初回コミット）は空の変更として扱う
        console.log('[GitHistory] No parent commits found for:', commitHash);
        setCommitChanges(prev => new Map(prev).set(commitHash, { added: [], modified: [], deleted: [] }));
        return;
      }

      // 最初の親コミットと比較（マージコミットの場合も最初の親を使用）
      const parentHash = currentCommit.parentHashes[0];
      console.log('[GitHistory] Comparing commits:', parentHash, 'vs', commitHash);
      
      const diffOutput = await gitCommands.diffCommits(parentHash, commitHash);
      console.log('[GitHistory] Raw diff output:', diffOutput);
      
      const changes = parseDiffOutput(diffOutput);
      setCommitChanges(prev => new Map(prev).set(commitHash, changes));
    } catch (error) {
      console.error('Failed to get commit changes:', error);
    }
  };

  // diff出力をパースして変更ファイルを抽出
  const parseDiffOutput = (diffOutput: string): CommitChanges => {
    const changes: CommitChanges = {
      added: [],
      modified: [],
      deleted: []
    };

    if (!diffOutput || diffOutput.trim() === '' || diffOutput === 'No differences between commits') {
      return changes;
    }

    const lines = diffOutput.split('\n');
    let currentFile = '';
    
    for (const line of lines) {
      // diff --git a/file b/file の形式でファイル名を取得
      if (line.startsWith('diff --git ')) {
        const match = line.match(/diff --git a\/(.+) b\/(.+)/);
        if (match) {
          currentFile = match[2]; // b/file の部分
        }
      }
      // 新規ファイル
      else if (line.startsWith('new file mode')) {
        if (currentFile && !changes.added.includes(currentFile)) {
          changes.added.push(currentFile);
        }
      }
      // 削除されたファイル
      else if (line.startsWith('deleted file mode')) {
        if (currentFile && !changes.deleted.includes(currentFile)) {
          changes.deleted.push(currentFile);
        }
      }
      // 変更されたファイル（新規・削除以外）
      else if (line.startsWith('index ') && currentFile) {
        // 新規ファイルでも削除ファイルでもない場合は変更されたファイル
        if (!changes.added.includes(currentFile) && !changes.deleted.includes(currentFile)) {
          if (!changes.modified.includes(currentFile)) {
            changes.modified.push(currentFile);
          }
        }
      }
    }

    console.log('[GitHistory] Parsed diff changes:', changes);
    return changes;
  };

  // コミットの展開/収納をトグル
  const toggleCommitExpansion = async (commitHash: string) => {
    const newExpanded = new Set(expandedCommits);
    if (newExpanded.has(commitHash)) {
      newExpanded.delete(commitHash);
    } else {
      newExpanded.add(commitHash);
      await getCommitChanges(commitHash);
    }
    setExpandedCommits(newExpanded);
  };

  // 相対時間を取得
  const getRelativeTime = (timestamp: number): string => {
    const now = Date.now();
    const diff = now - timestamp;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return 'たった今';
    if (minutes < 60) return `${minutes}分前`;
    if (hours < 24) return `${hours}時間前`;
    if (days < 7) return `${days}日前`;
    return new Date(timestamp).toLocaleDateString('ja-JP');
  };

  // ファイルタイプのアイコンを取得
  const getFileIcon = (type: 'added' | 'modified' | 'deleted') => {
    switch (type) {
      case 'added': return <FilePlus className="w-3 h-3 text-green-500" />;
      case 'modified': return <FileText className="w-3 h-3 text-blue-500" />;
      case 'deleted': return <FileMinus className="w-3 h-3 text-red-500" />;
    }
  };

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 overflow-auto">
        <div className="relative">
          {/* SVG for git graph lines */}
          <svg
            ref={svgRef}
            className="absolute top-0 left-0 w-full h-full pointer-events-none"
            style={{ height: `${extendedCommits.length * 60 + 60}px` }}
          >
            {/* Draw branch lines */}
            {extendedCommits.map((commit, index) => {
              const nextCommit = extendedCommits[index + 1];
              if (!nextCommit) return null;

              // Same branch connection
              if (commit.branch === nextCommit.branch) {
                return (
                  <line
                    key={`line-${commit.hash}-${nextCommit.hash}`}
                    x1={commit.x}
                    y1={commit.y}
                    x2={nextCommit.x}
                    y2={nextCommit.y}
                    stroke={commit.branchColor}
                    strokeWidth="2"
                  />
                );
              }

              return null;
            })}

            {/* Draw commit points */}
            {extendedCommits.map((commit) => (
              <g key={`point-${commit.hash}`}>
                <circle
                  cx={commit.x}
                  cy={commit.y}
                  r="6"
                  fill={commit.branchColor}
                  stroke="white"
                  strokeWidth="2"
                />
                {commit.isMerge && (
                  <circle
                    cx={commit.x}
                    cy={commit.y}
                    r="3"
                    fill="white"
                  />
                )}
              </g>
            ))}
          </svg>

          {/* Commit list */}
          <div className="pl-16 space-y-1">
            {extendedCommits.map((commit) => (
              <div key={commit.hash} className="relative">
                {/* Main commit row */}
                <div 
                  className="flex items-center py-2 px-3 hover:bg-muted/50 rounded-sm cursor-pointer group"
                  style={{ minHeight: '56px' }}
                  onClick={() => toggleCommitExpansion(commit.hash)}
                >
                  {/* Branch indicator */}
                  <div 
                    className="absolute left-0 w-1 h-full rounded-r"
                    style={{ backgroundColor: commit.branchColor }}
                  />
                  
                  {/* Expand/collapse icon */}
                  <div className="mr-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    {expandedCommits.has(commit.hash) ? (
                      <ChevronDown className="w-4 h-4" />
                    ) : (
                      <ChevronRight className="w-4 h-4" />
                    )}
                  </div>

                  {/* Commit info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate mb-1">
                          {commit.message}
                        </p>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <User className="w-3 h-3" />
                            {commit.author}
                          </span>
                          <span className="flex items-center gap-1">
                            <Calendar className="w-3 h-3" />
                            {getRelativeTime(commit.timestamp)}
                          </span>
                          <span className="flex items-center gap-1">
                            <Hash className="w-3 h-3" />
                            {commit.shortHash}
                          </span>
                          {commit.branch !== currentBranch && (
                            <span className="flex items-center gap-1 px-1 bg-muted rounded text-xs">
                              <GitBranch className="w-3 h-3" />
                              {commit.branch}
                            </span>
                          )}
                        </div>
                      </div>
                      
                      {commit.isMerge && (
                        <div className="ml-2 flex items-center text-purple-500">
                          <GitCommit className="w-4 h-4" />
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Expanded commit changes */}
                {expandedCommits.has(commit.hash) && (
                  <div className="ml-6 mr-3 mb-2 p-3 bg-muted/30 rounded border-l-2 border-muted-foreground/20">
                    <div className="text-xs text-muted-foreground mb-2">変更されたファイル:</div>
                    {commitChanges.has(commit.hash) ? (
                      <div className="space-y-1">
                        {(() => {
                          const changes = commitChanges.get(commit.hash)!;
                          const allFiles = [
                            ...changes.added.map(f => ({ file: f, type: 'added' as const })),
                            ...changes.modified.map(f => ({ file: f, type: 'modified' as const })),
                            ...changes.deleted.map(f => ({ file: f, type: 'deleted' as const }))
                          ];

                          if (allFiles.length === 0) {
                            return (
                              <div className="text-xs text-muted-foreground italic">
                                変更ファイルが見つかりません
                              </div>
                            );
                          }

                          return allFiles.map(({ file, type }, index) => (
                            <div key={index} className="flex items-center gap-2 text-xs">
                              {getFileIcon(type)}
                              <span className="font-mono truncate">{file}</span>
                            </div>
                          ));
                        })()}
                      </div>
                    ) : (
                      <div className="text-xs text-muted-foreground">
                        変更情報を読み込み中...
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
