'use client';

import React, { useState, useRef, useContext, useEffect } from 'react';
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
  Hash,
  FileDiff,
} from 'lucide-react';
import { GitCommit as GitCommitType } from '@/types/git';
import { GitCommands } from '@/engine/cmd/git';
import { useTheme } from '@/context/ThemeContext';
import { useTranslation } from '@/context/I18nContext';

interface GitHistoryProps {
  commits: GitCommitType[];
  currentProject?: string;
  currentProjectId?: string;
  currentBranch: string;
  onDiffFileClick?: (params: { commitId: string; filePath: string; editable?: boolean }) => void;
  onDiffAllFilesClick?: (params: { commitId: string; parentCommitId: string }) => void;
}

interface CommitChanges {
  added: string[];
  modified: string[];
  deleted: string[];
}

interface ExtendedCommit extends GitCommitType {
  x: number;
  y: number;
  lane: number; // このコミットが描画されるレーン番号
  laneColor: string; // このコミットの線の色
  changes?: CommitChanges;
}

export default function GitHistory({
  commits,
  currentProject,
  currentProjectId,
  currentBranch,
  onDiffFileClick,
  onDiffAllFilesClick,
}: GitHistoryProps) {
  const [extendedCommits, setExtendedCommits] = useState<ExtendedCommit[]>([]);
  const [expandedCommits, setExpandedCommits] = useState<Set<string>>(new Set());
  const [commitChanges, setCommitChanges] = useState<Map<string, CommitChanges>>(new Map());
  // 重複コミットの表示切り替え
  const [showDuplicates, setShowDuplicates] = useState(false);
  // 重複グループ情報
  const [duplicateGroups, setDuplicateGroups] = useState<Map<string, GitCommitType[]>>(new Map());
  const svgRef = useRef<SVGSVGElement>(null);
  const gitCommands =
    currentProject && currentProjectId ? new GitCommands(currentProject, currentProjectId) : null;

  // トポロジカルソート: 親→子の順に並べる
  const topoSortCommits = (commits: GitCommitType[]): GitCommitType[] => {
    // timestamp昇順（古い順）で処理する
    const sorted = commits.slice().sort((a, b) => a.timestamp - b.timestamp);
    const visited = new Set<string>();
    const result: GitCommitType[] = [];
    const map = new Map<string, GitCommitType>();
    sorted.forEach(c => map.set(c.hash, c));
    const visit = (c: GitCommitType) => {
      if (visited.has(c.hash)) return;
      visited.add(c.hash);
      if (c.parentHashes) {
        c.parentHashes.forEach(ph => {
          const parent = map.get(ph);
          if (parent) visit(parent);
        });
      }
      result.push(c);
    };
    sorted.forEach(c => visit(c));
    // 重複除去
    const seen = new Set<string>();
    return result.filter(c => {
      if (seen.has(c.hash)) return false;
      seen.add(c.hash);
      return true;
    });
  };

  // 重複コミットを除去（同じ内容のコミットはリモート優先）
  // 重複グループを返しつつ、表示用コミットリストを返す
  const deduplicateCommits = (
    commits: GitCommitType[]
  ): { deduplicated: GitCommitType[]; groups: Map<string, GitCommitType[]> } => {
    const contentMap = new Map<string, GitCommitType[]>();
    commits.forEach(commit => {
      const key = commit.tree
        ? `tree:${commit.tree}`
        : `meta:${commit.author}|${commit.timestamp}|${commit.message}`;
      if (!contentMap.has(key)) {
        contentMap.set(key, []);
      }
      contentMap.get(key)!.push(commit);
    });
    const deduplicated: GitCommitType[] = [];
    contentMap.forEach((group, key) => {
      if (group.length === 1) {
        deduplicated.push(group[0]);
      } else {
        // 重複あり: リモート参照があるコミットを優先
        const remoteCommit = group.find(
          c =>
            Array.isArray(c.refs) &&
            c.refs.some((ref: string) => ref.startsWith('origin/') || ref.startsWith('upstream/'))
        );
        if (remoteCommit) {
          deduplicated.push(remoteCommit);
        } else {
          deduplicated.push(group[0]);
        }
      }
    });
    return { deduplicated, groups: contentMap };
  };

  // ThemeContextから色を取得
  const { colors } = useTheme();

  // ブランチカラーのパレット（ThemeContextから取得、なければデフォルト）
  const branchColors = colors.gitBranchColors || [
    '#3b82f6', // blue
    '#10b981', // emerald
    '#f59e0b', // amber
    '#ef4444', // red
    '#8b5cf6', // violet
    '#06b6d4', // cyan
    '#f97316', // orange
    '#84cc16', // lime
  ];

  // コミット行の高さを動的に計算するヘルパー関数（小さめ）
  const getCommitRowHeight = (commitHash: string): number => {
    const baseHeight = 28; // 基本の行高さ
    const FILE_ITEM_HEIGHT = 24; // ファイル1つあたりの高さ
    const MAX_FILES_DISPLAY = 10; // 最大表示ファイル数
    const HEADER_FOOTER_HEIGHT = 32; // ヘッダー・フッター・パディング(最小)

    if (!expandedCommits.has(commitHash)) {
      return baseHeight;
    }

    // 変更ファイル数を取得
    const changes = commitChanges.get(commitHash);
    if (!changes) {
      return baseHeight + HEADER_FOOTER_HEIGHT; // デフォルトの展開高さ
    }

    const totalFiles = changes.added.length + changes.modified.length + changes.deleted.length;
    const displayFiles = Math.min(totalFiles, MAX_FILES_DISPLAY);
    // ファイルが1つもなければ最低限の高さだけ
    if (displayFiles === 0) {
      return baseHeight + HEADER_FOOTER_HEIGHT;
    }
    // ファイルが1つ以上なら、その分だけ高さを増やす
    const expandedHeight = HEADER_FOOTER_HEIGHT + displayFiles * FILE_ITEM_HEIGHT;
    return baseHeight + expandedHeight;
  };

  // コミットの位置とレーンを計算（展開状態を考慮）
  const [svgHeight, setSvgHeight] = useState<number>(0);

  useEffect(() => {
    if (commits.length === 0) return;

    // 重複コミットを除去（リモート優先）
    const { deduplicated, groups } = deduplicateCommits(commits);
    setDuplicateGroups(groups);

    // 表示用コミットリストを時系列（新しい順）でソート
    const sortedCommits = (showDuplicates ? commits : deduplicated)
      .slice()
      .sort((a, b) => b.timestamp - a.timestamp);

    // レーン割り当ては古い順に処理（親→子の順）
    // ただし、描画は新しい順
    const ROW_HEIGHT = 28;
    const LANE_WIDTH = 16;
    const EXPANDED_HEIGHT = 56;
    const Y_OFFSET = 10;

    // レーン割り当てアルゴリズム（古い順に処理）
    // 古い順で処理するため、timestamp昇順で一時ソート
    const sortedForLane = sortedCommits.slice().sort((a, b) => a.timestamp - b.timestamp);
    const commitMap = new Map<string, GitCommitType>();
    sortedForLane.forEach(c => commitMap.set(c.hash, c));

    const lanes: (string | null)[] = [];
    const commitLanes = new Map<string, number>();
    const commitColors = new Map<string, string>();

    for (const commit of sortedForLane) {
      let assignedLane = -1;
      let assignedColor: string | undefined;
      if (commit.parentHashes.length > 0) {
        const firstParentHash = commit.parentHashes[0];
        if (commitLanes.has(firstParentHash)) {
          const parentLane = commitLanes.get(firstParentHash)!;
          assignedLane = parentLane;
          assignedColor = commitColors.get(firstParentHash);
        }
      }
      if (assignedLane === -1) {
        assignedLane = lanes.findIndex(lane => lane === null);
        if (assignedLane === -1) {
          assignedLane = lanes.length;
          lanes.push(null);
        }
        assignedColor = branchColors[assignedLane % branchColors.length];
      }
      lanes[assignedLane] = commit.hash;
      commitLanes.set(commit.hash, assignedLane);
      commitColors.set(commit.hash, assignedColor!);
      if (commit.parentHashes.length > 1) {
        for (let i = 1; i < commit.parentHashes.length; i++) {
          const parentHash = commit.parentHashes[i];
          if (commitLanes.has(parentHash)) {
            const parentLane = commitLanes.get(parentHash)!;
            if (lanes[parentLane] === parentHash) {
              lanes[parentLane] = null;
            }
          }
        }
      }
      const hasChildren = sortedForLane.some(c => c.parentHashes.includes(commit.hash));
      if (!hasChildren) {
        lanes[assignedLane] = null;
      }
    }

    let currentY = Y_OFFSET;
    // 新しい順で描画
    const displayCommits = sortedCommits;
    const processedCommits: ExtendedCommit[] = displayCommits.map(commit => {
      const lane = commitLanes.get(commit.hash) || 0;
      const color = commitColors.get(commit.hash) || branchColors[0];
      const commitY = currentY;
      currentY += getCommitRowHeight(commit.hash);
      return {
        ...commit,
        x: lane * LANE_WIDTH + 10,
        y: commitY,
        lane,
        laneColor: color,
      };
    });
    const calculatedHeight = currentY + 30;
    setSvgHeight(calculatedHeight);
    setExtendedCommits(processedCommits);
  }, [commits, expandedCommits, commitChanges, branchColors, showDuplicates]);

  // コミットの変更ファイルを取得
  const getCommitChanges = async (commitHash: string) => {
    if (!gitCommands || commitChanges.has(commitHash)) return;

    try {
      // 現在のコミットとその親コミットを比較
      const currentCommit = commits.find(c => c.hash === commitHash);
      if (!currentCommit || currentCommit.parentHashes.length === 0) {
        // 親コミットがない場合（初回コミット）は空の変更として扱う
        console.log('[GitHistory] No parent commits found for:', commitHash);
        setCommitChanges(prev =>
          new Map(prev).set(commitHash, { added: [], modified: [], deleted: [] })
        );
        return;
      }

      // 最初の親コミットと比較（マージコミットの場合も最初の親を使用）
      const parentHash = currentCommit.parentHashes[0];
      console.log('[GitHistory] Comparing commits (parent->child):', parentHash, '->', commitHash);

      // 親コミット→子コミットの順序で差分を取得（変更を正しく表示するため）
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
      deleted: [],
    };

    if (
      !diffOutput ||
      diffOutput.trim() === '' ||
      diffOutput === 'No differences between commits'
    ) {
      return changes;
    }

    const lines = diffOutput.split('\n');
    let currentFile = '';
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // diff --git a/file b/file の形式でファイル名を取得
      if (line.startsWith('diff --git ')) {
        const match = line.match(/diff --git a\/(.+) b\/(.+)/);
        if (match) {
          currentFile = match[2]; // b/file の部分
        } else {
          currentFile = '';
        }
      }
      // 削除されたファイル
      if (line.startsWith('deleted file mode')) {
        // diff --git の直後に deleted file mode が来ることが多い
        if (currentFile && !changes.deleted.includes(currentFile)) {
          changes.deleted.push(currentFile);
        }
        currentFile = '';
        continue;
      }
      // 新規ファイル
      if (line.startsWith('new file mode')) {
        if (currentFile && !changes.added.includes(currentFile)) {
          changes.added.push(currentFile);
        }
        continue;
      }
      // 変更されたファイル（新規・削除以外）
      if (line.startsWith('index ') && currentFile) {
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
  const { t } = useTranslation();
  const getRelativeTime = (timestamp: number): string => {
    const now = Date.now();
    const diff = now - timestamp;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return t('gitHistory.justNow');
    if (minutes < 60) return t('gitHistory.minutesAgo', { params: { minutes } });
    if (hours < 24) return t('gitHistory.hoursAgo', { params: { hours } });
    if (days < 7) return t('gitHistory.daysAgo', { params: { days } });
    return new Date(timestamp).toLocaleDateString('ja-JP');
  };

  // ファイルタイプのアイコンを取得
  const getFileIcon = (type: 'added' | 'modified' | 'deleted') => {
    switch (type) {
      case 'added':
        return <FilePlus className="w-2.5 h-2.5 text-green-500" />; // w-3 h-3 -> w-2.5 h-2.5
      case 'modified':
        return <FileText className="w-2.5 h-2.5 text-blue-500" />; // w-3 h-3 -> w-2.5 h-2.5
      case 'deleted':
        return <FileMinus className="w-2.5 h-2.5 text-red-500" />; // w-3 h-3 -> w-2.5 h-2.5
    }
  };

  return (
    <div
      className="h-full flex flex-col"
      style={{ background: colors.sidebarBg, color: colors.sidebarFg }}
    >
      {/* 重複コミット表示切り替えボタン */}
      <div
        className="px-2 py-1 border-b border-gray-700 flex items-center gap-2 text-xs"
        style={{ background: colors.sidebarBg }}
      >
        <button
          className="px-2 py-0.5 rounded border text-xs font-medium"
          style={{
            background: showDuplicates ? colors.gitBranchOtherBg : colors.gitBranchCurrentBg,
            color: showDuplicates ? colors.gitBranchOtherFg : colors.gitBranchCurrentFg,
            borderColor: showDuplicates
              ? colors.gitBranchOtherBorder
              : colors.gitBranchCurrentBorder,
            transition: 'background 0.2s',
          }}
          onClick={() => setShowDuplicates(v => !v)}
        >
          {showDuplicates ? t('gitHistory.hideDuplicates') : t('gitHistory.showDuplicates')}
        </button>
        {!showDuplicates &&
          Array.from(duplicateGroups.values()).filter(g => g.length > 1).length > 0 && (
            <span className="text-[11px] text-gray-400">
              {t('gitHistory.duplicateGroupsHidden', { params: { count: Array.from(duplicateGroups.values()).filter(g => g.length > 1).length } })}
            </span>
          )}
      </div>
      <div className="flex-1 overflow-auto">
        <div
          className="relative min-w-0"
          style={{ overflow: 'visible' }}
        >
          {/* SVG for git graph lines */}
          <svg
            ref={svgRef}
            className="absolute top-0 left-0 pointer-events-none flex-shrink-0"
            style={{
              height: `${svgHeight}px`,
              width: '60px',
              overflow: 'visible',
            }}
          >
            {/* Draw lane lines */}
            {extendedCommits.map((commit, index) => {
              const lines: React.ReactElement[] = [];
              const ROW_HEIGHT = 28;
              if (commit.parentHashes && commit.parentHashes.length > 0) {
                commit.parentHashes.forEach((parentHash, parentIndex) => {
                  const parentCommit = extendedCommits.find(c => c.hash === parentHash);
                  if (parentCommit) {
                    if (parentCommit.lane === commit.lane) {
                      lines.push(
                        <line
                          key={`line-${commit.hash}-${parentHash}-${parentIndex}`}
                          x1={commit.x}
                          y1={commit.y}
                          x2={parentCommit.x}
                          y2={parentCommit.y}
                          stroke={commit.laneColor}
                          strokeWidth="2"
                        />
                      );
                    } else {
                      const midY = (commit.y + parentCommit.y) / 2;
                      const midX = (commit.x + parentCommit.x) / 2;
                      lines.push(
                        <g key={`curve-${commit.hash}-${parentHash}-${parentIndex}`}>
                          <path
                            d={`M ${commit.x} ${commit.y} C ${commit.x} ${commit.y + 15} ${midX} ${midY - 15} ${midX} ${midY}`}
                            stroke={commit.laneColor}
                            strokeWidth="2"
                            fill="none"
                          />
                          <path
                            d={`M ${midX} ${midY} C ${midX} ${midY + 15} ${parentCommit.x} ${parentCommit.y - 15} ${parentCommit.x} ${parentCommit.y}`}
                            stroke={parentCommit.laneColor}
                            strokeWidth="2"
                            fill="none"
                          />
                        </g>
                      );
                    }
                  } else {
                    const virtualY = commit.y - ROW_HEIGHT;
                    lines.push(
                      <line
                        key={`virtual-parent-line-${commit.hash}-${parentHash}-${parentIndex}`}
                        x1={commit.x}
                        y1={commit.y}
                        x2={commit.x}
                        y2={virtualY}
                        stroke={commit.laneColor}
                        strokeWidth="1"
                        strokeDasharray="2,2"
                      />
                    );
                  }
                });
              }
              return lines;
            })}
            {/* Draw commit points */}
            {extendedCommits.map(commit => (
              <g key={`point-${commit.hash}`}>
                <circle
                  cx={commit.x}
                  cy={commit.y}
                  r="4"
                  fill={commit.laneColor}
                  stroke={colors.gitCommitStroke || 'white'}
                  strokeWidth="1.5"
                />
                {commit.isMerge && (
                  <circle
                    cx={commit.x}
                    cy={commit.y}
                    r="2"
                    fill={colors.gitMergeDot || 'white'}
                  />
                )}
              </g>
            ))}
          </svg>
          {/* Commit list */}
          <div className="pl-8">
            {extendedCommits.map(commit => {
              // 重複グループの他のコミットを取得
              let duplicateGroup: GitCommitType[] = [];
              for (const group of duplicateGroups.values()) {
                if (group.some(c => c.hash === commit.hash) && group.length > 1) {
                  duplicateGroup = group;
                  break;
                }
              }
              return (
                <div
                  key={commit.hash}
                  className="relative"
                  style={{
                    height: `${getCommitRowHeight(commit.hash)}px`,
                  }}
                >
                  {/* Main commit row */}
                  <div
                    className="flex items-center px-1.5 rounded-sm cursor-pointer group"
                    style={{
                      height: '28px',
                      background: expandedCommits.has(commit.hash)
                        ? colors.gitCommitExpandedBg
                        : undefined,
                      color: colors.sidebarFg,
                      border: '1px solid transparent',
                      fontSize: '12px',
                      transition: 'border-color 0.2s',
                    }}
                    onMouseEnter={e => {
                      e.currentTarget.style.border = `1.5px solid ${colors.gitCommitMeta || '#a1a1aa'}`;
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.border = '1.5px solid transparent';
                    }}
                    onClick={() => {
                      toggleCommitExpansion(commit.hash);
                    }}
                  >
                    {/* Expand/collapse icon */}
                    <div
                      className="mr-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center justify-center"
                      style={{ width: '14px' }}
                    >
                      {expandedCommits.has(commit.hash) ? (
                        <ChevronDown
                          style={{ color: colors.gitCommitChevron || 'var(--muted-foreground)' }}
                          className="w-3 h-3"
                        />
                      ) : (
                        <ChevronRight
                          style={{ color: colors.gitCommitChevron || 'var(--muted-foreground)' }}
                          className="w-3 h-3"
                        />
                      )}
                    </div>
                    {/* Commit info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 text-xs overflow-hidden">
                            {/* コミットメッセージ */}
                            <span
                              className="font-medium truncate max-w-20 lg:max-w-32 flex-shrink-0"
                              title={commit.message}
                              style={{
                                color: colors.gitCommitMsg || colors.sidebarFg,
                                fontSize: '12px',
                              }}
                            >
                              {commit.message.length > 24
                                ? `${commit.message.substring(0, 24)}...`
                                : commit.message}
                            </span>
                            {/* Diffタブを開くアイコン */}
                            {commit.parentHashes &&
                              commit.parentHashes.length > 0 &&
                              onDiffAllFilesClick && (
                                <button
                                  className="ml-1 p-0.5 rounded hover:bg-gray-700"
                                  title="このコミットの全ファイルdiffを表示"
                                  style={{
                                    verticalAlign: 'middle',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                  }}
                                  onClick={e => {
                                    e.stopPropagation();
                                    onDiffAllFilesClick({
                                      commitId: commit.hash,
                                      parentCommitId: commit.parentHashes[0],
                                    });
                                  }}
                                >
                                  <FileDiff className="w-3 h-3 text-blue-400" />
                                </button>
                              )}
                            {/* メタデータ */}
                            <span
                              className="flex items-center gap-1 flex-shrink-0"
                              style={{
                                color: colors.gitCommitMeta || 'var(--muted-foreground)',
                                fontSize: '11px',
                              }}
                            >
                              <Calendar className="w-2 h-2" />
                              <span className="whitespace-nowrap">
                                {getRelativeTime(commit.timestamp)}
                              </span>
                            </span>
                            <span
                              className="flex items-center gap-1 flex-shrink-0 hidden sm:flex"
                              style={{
                                color: colors.gitCommitMeta || 'var(--muted-foreground)',
                                fontSize: '11px',
                              }}
                            >
                              <Hash className="w-2 h-2" />
                              <span className="font-mono">{commit.shortHash}</span>
                            </span>
                            {/* refs: このコミットを指すブランチ・タグ名をラベル表示 */}
                            {Array.isArray(commit.refs) && commit.refs.length > 0 && (
                              <div className="flex gap-0.5 flex-wrap">
                                {commit.refs.map((refName: string) => {
                                  const isCurrentBranch = refName === currentBranch;
                                  const isRemote =
                                    refName.startsWith('origin/') ||
                                    refName.startsWith('upstream/');
                                  return (
                                    <span
                                      key={refName}
                                      className={`flex items-center gap-0.5 px-1 py-0.5 rounded text-[10px] font-medium flex-shrink-0 whitespace-nowrap border`}
                                      style={{
                                        background: isCurrentBranch
                                          ? colors.gitBranchCurrentBg
                                          : isRemote
                                            ? colors.gitBranchOtherBg
                                            : colors.gitBranchCurrentBg,
                                        color: isCurrentBranch
                                          ? colors.gitBranchCurrentFg
                                          : isRemote
                                            ? colors.gitBranchOtherFg
                                            : colors.gitBranchCurrentFg,
                                        borderColor: isCurrentBranch
                                          ? colors.gitBranchCurrentBorder
                                          : isRemote
                                            ? colors.gitBranchOtherBorder
                                            : colors.gitBranchCurrentBorder,
                                      }}
                                    >
                                      <GitBranch className="w-2 h-2" />
                                      {refName}
                                    </span>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        </div>
                        {commit.isMerge && (
                          <div
                            className="ml-1.5 flex items-center"
                            style={{ color: colors.gitMergeIcon || '#a855f7' }}
                          >
                            <GitCommit className="w-3 h-3" />
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                  {/* 重複コミットグループの表示（重複がある場合のみ） */}
                  {!showDuplicates && duplicateGroup.length > 1 && (
                    <div className="ml-6 mt-1 text-[11px] text-gray-400">
                      <span>（{duplicateGroup.length - 1}件の重複コミットを非表示中）</span>
                    </div>
                  )}
                  {/* Expanded commit changes */}
                  {expandedCommits.has(commit.hash) && (
                    <div
                      className="ml-4 mr-1 p-2 rounded-md border-l-2"
                      style={{
                        background: colors.gitCommitExpandedBg,
                        borderColor: colors.gitCommitExpandedBorder,
                        color: colors.sidebarFg,
                        fontSize: '11px',
                        marginTop: '2px',
                      }}
                    >
                        <div
                          className="text-[11px] mb-1 font-medium"
                          style={{ color: colors.gitCommitMeta || 'var(--muted-foreground)' }}
                        >
                          {t('gitHistory.changedFiles')}
                        </div>
                      {commitChanges.has(commit.hash) ? (
                        <div
                          className="space-y-0.5 overflow-y-auto"
                          style={{ maxHeight: '240px' }}
                        >
                          {(() => {
                            const changes = commitChanges.get(commit.hash)!;
                            const allFiles = [
                              ...changes.added.map(f => ({ file: f, type: 'added' as const })),
                              ...changes.modified.map(f => ({
                                file: f,
                                type: 'modified' as const,
                              })),
                              ...changes.deleted.map(f => ({ file: f, type: 'deleted' as const })),
                            ];
                            if (allFiles.length === 0) {
                              return (
                                <div
                                  className="text-[11px] italic py-0.5"
                                  style={{
                                    color: colors.gitCommitMeta || 'var(--muted-foreground)',
                                  }}
                                >
                                  {t('gitHistory.noChangedFiles')}
                                </div>
                              );
                            }
                            return (
                              <>
                                {allFiles.map(({ file, type }, index) => (
                                  <div
                                    key={index}
                                    className="flex items-center gap-1 text-[11px] py-0.5 cursor-pointer hover:underline"
                                    onClick={() => {
                                      if (onDiffFileClick) {
                                        onDiffFileClick({ commitId: commit.hash, filePath: file });
                                      }
                                    }}
                                    title="このファイルの差分を表示"
                                  >
                                    {getFileIcon(type)}
                                    <span
                                      className="font-mono truncate flex-1"
                                      style={{ color: colors.gitCommitFile || colors.sidebarFg }}
                                    >
                                      {file}
                                    </span>
                                  </div>
                                ))}
                                {allFiles.length > 10 && (
                                  <div
                                    className="text-[10px] italic py-0.5 text-center"
                                    style={{
                                      color: colors.gitCommitMeta || 'var(--muted-foreground)',
                                    }}
                                  >
                                    {t('gitHistory.allFilesScrollable', { params: { count: allFiles.length } })}
                                  </div>
                                )}
                              </>
                            );
                          })()}
                        </div>
                      ) : (
                        <div
                          className="text-[11px] py-0.5"
                          style={{ color: colors.gitCommitMeta || 'var(--muted-foreground)' }}
                        >
                          {t('gitHistory.loadingChanges')}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
