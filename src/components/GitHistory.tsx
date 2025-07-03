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

  // コミットの位置とブランチカラーを計算（展開状態を考慮）
  const [svgHeight, setSvgHeight] = useState<number>(0);

  useEffect(() => {
    if (commits.length === 0) return;

    const branchMap = new Map<string, number>();
    let branchIndex = 0;
    const ROW_HEIGHT = 40; // コミット行の高さ
    const BRANCH_WIDTH = 20; // ブランチ間の幅
    const EXPANDED_HEIGHT = 80; // 展開時の追加高さ
    const Y_OFFSET = 18; // テキストの中央に合わせるためのオフセット

    let currentY = Y_OFFSET;
    const processedCommits: ExtendedCommit[] = commits.map((commit, index) => {
      // ブランチのインデックスを取得または作成
      if (!branchMap.has(commit.branch)) {
        branchMap.set(commit.branch, branchIndex++);
      }
      
      const branchIdx = branchMap.get(commit.branch) || 0;
      const colorIndex = branchIdx % branchColors.length;

      const commitY = currentY;
      
      // 次のコミットのY座標を計算（展開状態を考慮）
      currentY += ROW_HEIGHT;
      if (expandedCommits.has(commit.hash)) {
        currentY += EXPANDED_HEIGHT;
      }

      return {
        ...commit,
        x: branchIdx * BRANCH_WIDTH + 15,
        y: commitY,
        branchColor: branchColors[colorIndex]
      };
    });

    // SVGの高さを計算（最後のコミットの位置 + マージン）
    const calculatedHeight = currentY + 20;
    setSvgHeight(calculatedHeight);
    setExtendedCommits(processedCommits);
  }, [commits, expandedCommits]); // expandedCommitsを依存関係に追加

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
      case 'added': return <FilePlus className="w-2.5 h-2.5 text-green-500" />; // w-3 h-3 -> w-2.5 h-2.5
      case 'modified': return <FileText className="w-2.5 h-2.5 text-blue-500" />; // w-3 h-3 -> w-2.5 h-2.5
      case 'deleted': return <FileMinus className="w-2.5 h-2.5 text-red-500" />; // w-3 h-3 -> w-2.5 h-2.5
    }
  };

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 overflow-auto">
        <div className="relative min-w-0 overflow-hidden">
          {/* SVG for git graph lines */}
          <svg
            ref={svgRef}
            className="absolute top-0 left-0 pointer-events-none flex-shrink-0"
            style={{ 
              height: `${svgHeight}px`,
              width: '60px'
            }}
          >
            {/* Draw branch lines */}
            {extendedCommits.map((commit, index) => {
              const lines = [];
              
              // 同じブランチの連続するコミット間の縦線
              const nextCommit = extendedCommits[index + 1];
              if (nextCommit && commit.branch === nextCommit.branch) {
                lines.push(
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
              
              // 親コミットへの接続線（すべての親への接続）
              if (commit.parentHashes && commit.parentHashes.length > 0) {
                commit.parentHashes.forEach((parentHash, parentIndex) => {
                  const parentCommit = extendedCommits.find(c => c.hash === parentHash);
                  if (parentCommit) {
                    if (parentCommit.branch === commit.branch) {
                      // 同じブランチ内の接続（直線）
                      if (Math.abs(extendedCommits.indexOf(parentCommit) - index) > 1) {
                        // 連続していないコミット間の接続線
                        lines.push(
                          <line
                            key={`direct-line-${commit.hash}-${parentHash}-${parentIndex}`}
                            x1={commit.x}
                            y1={commit.y}
                            x2={parentCommit.x}
                            y2={parentCommit.y}
                            stroke={commit.branchColor}
                            strokeWidth="2"
                          />
                        );
                      }
                    } else {
                      // 異なるブランチ間の分岐線（曲線）
                      const midY = (commit.y + parentCommit.y) / 2;
                      const midX = (commit.x + parentCommit.x) / 2;
                      
                      lines.push(
                        <g key={`branch-line-${commit.hash}-${parentHash}-${parentIndex}`}>
                          {/* S字カーブで接続 */}
                          <path
                            d={`M ${commit.x} ${commit.y} C ${commit.x} ${commit.y + 15} ${midX} ${midY - 15} ${midX} ${midY}`}
                            stroke={commit.branchColor}
                            strokeWidth="2"
                            fill="none"
                          />
                          <path
                            d={`M ${midX} ${midY} C ${midX} ${midY + 15} ${parentCommit.x} ${parentCommit.y - 15} ${parentCommit.x} ${parentCommit.y}`}
                            stroke={parentCommit.branchColor}
                            strokeWidth="2"
                            fill="none"
                          />
                        </g>
                      );
                    }
                  }
                });
              }
              
              return lines;
            })}

            {/* Draw commit points */}
            {extendedCommits.map((commit) => (
              <g key={`point-${commit.hash}`}>
                <circle
                  cx={commit.x}
                  cy={commit.y}
                  r="4" // 6 -> 4に縮小
                  fill={commit.branchColor}
                  stroke="white"
                  strokeWidth="1.5" // 2 -> 1.5に縮小
                />
                {commit.isMerge && (
                  <circle
                    cx={commit.x}
                    cy={commit.y}
                    r="2" // 3 -> 2に縮小
                    fill="white"
                  />
                )}
              </g>
            ))}
          </svg>

          {/* Commit list */}
          <div className="pl-12 space-y-0.5"> {/* pl-16 -> pl-12, space-y-1 -> space-y-0.5 */}
            {extendedCommits.map((commit) => (
              <div key={commit.hash} className="relative">
                {/* Main commit row */}
                <div 
                  className="flex items-center py-1.5 px-2 hover:bg-muted/50 rounded-sm cursor-pointer group" // items-start -> items-center に戻す
                  style={{ minHeight: '36px' }}
                  onClick={() => toggleCommitExpansion(commit.hash)}
                >
                  {/* Branch indicator */}
                  <div 
                    className="absolute left-0 w-0.5 h-full rounded-r"
                    style={{ backgroundColor: commit.branchColor }}
                  />
                  
                  {/* Expand/collapse icon - SVGと同じ高さに配置 */}
                  <div className="mr-1.5 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center justify-center" style={{ height: '20px', width: '12px' }}>
                    {expandedCommits.has(commit.hash) ? (
                      <ChevronDown className="w-3 h-3 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="w-3 h-3 text-muted-foreground" />
                    )}
                  </div>

                  {/* Commit info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        {/* コミットメッセージとメタデータを同じ行に */}
                        <div className="flex items-center gap-2 text-xs overflow-hidden">
                          {/* コミットメッセージ（適度な長さで切り詰め） */}
                          <span className="font-medium truncate max-w-32 lg:max-w-48 flex-shrink-0" title={commit.message}>
                            {commit.message.length > 40 ? `${commit.message.substring(0, 40)}...` : commit.message}
                          </span>
                          
                          {/* メタデータ */}
                          <span className="flex items-center gap-1 text-muted-foreground flex-shrink-0">
                            <Calendar className="w-2.5 h-2.5" />
                            <span className="whitespace-nowrap">{getRelativeTime(commit.timestamp)}</span>
                          </span>
                          <span className="flex items-center gap-1 text-muted-foreground flex-shrink-0 hidden sm:flex">
                            <Hash className="w-2.5 h-2.5" />
                            <span className="font-mono">{commit.shortHash}</span>
                          </span>
                          
                          {/* ブランチ表示：各ブランチの最新コミットに表示 */}
                          {(() => {
                            // そのブランチの最新コミット（配列内で最初に現れるコミット）かどうかを判定
                            const firstCommitOfBranch = commits.find(c => c.branch === commit.branch);
                            const isLatestOfBranch = firstCommitOfBranch?.hash === commit.hash;
                            
                            if (!isLatestOfBranch) return null;
                            
                            const isCurrentBranch = commit.branch === currentBranch;
                            
                            return (
                              <span className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium flex-shrink-0 whitespace-nowrap ${
                                isCurrentBranch
                                  ? 'bg-blue-500/20 text-blue-600 border border-blue-500/30' 
                                  : 'bg-orange-500/20 text-orange-600 border border-orange-500/30'
                              }`}>
                                <GitBranch className="w-2.5 h-2.5" />
                                {commit.branch}
                              </span>
                            );
                          })()}
                        </div>
                      </div>
                      
                      {commit.isMerge && (
                        <div className="ml-1.5 flex items-center text-purple-500"> {/* pt-0.5を削除 */}
                          <GitCommit className="w-3 h-3" />
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Expanded commit changes */}
                {expandedCommits.has(commit.hash) && (
                  <div className="ml-4 mr-2 mb-1.5 p-2.5 bg-muted/30 rounded-md border-l-2 border-muted-foreground/30">
                    <div className="text-xs text-muted-foreground mb-2 font-medium">変更されたファイル:</div>
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
                              <div className="text-xs text-muted-foreground italic py-1">
                                変更ファイルが見つかりません
                              </div>
                            );
                          }

                          return allFiles.map(({ file, type }, index) => (
                            <div key={index} className="flex items-center gap-2 text-xs py-0.5">
                              {getFileIcon(type)}
                              <span className="font-mono truncate flex-1">{file}</span>
                            </div>
                          ));
                        })()}
                      </div>
                    ) : (
                      <div className="text-xs text-muted-foreground py-1">
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
