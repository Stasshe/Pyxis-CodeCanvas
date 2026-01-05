'use client';

import {
  Calendar,
  ChevronDown,
  ChevronRight,
  FileDiff,
  FileMinus,
  FilePlus,
  FileText,
  GitBranch,
  GitCommit,
  Hash,
  Loader2,
} from 'lucide-react';
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useTranslation } from '@/context/I18nContext';
import { useTheme } from '@/context/ThemeContext';
import { terminalCommandRegistry } from '@/engine/cmd/terminalRegistry';
import { useDiffTabHandlers } from '@/hooks/useDiffTabHandlers';
import type { GitCommit as GitCommitType } from '@/types/git';

interface GitHistoryProps {
  commits: GitCommitType[];
  currentProject?: string;
  currentProjectId?: string;
  currentBranch: string;
  hasMore?: boolean;
  isLoadingMore?: boolean;
  onLoadMore?: () => void;
}

interface CommitChanges {
  added: string[];
  modified: string[];
  deleted: string[];
}

interface ExtendedCommit extends GitCommitType {
  x: number;
  y: number;
  lane: number;
  laneColor: string;
  changes?: CommitChanges;
}

/**
 * トポロジカルソート（Kahn's algorithm inspired by VSCode SCM）
 *
 * Gitグラフでは、子コミットが親コミットより前（上）に表示される必要があります。
 * このアルゴリズムは以下のステップで動作します：
 * 1. 各コミットの「子の数」（入次数）をカウント - 子から指されている数
 * 2. 子を持たないコミット（入次数0 = 最新のコミット）から処理を開始
 * 3. 処理したコミットの親の入次数を減らし、0になったら次の候補に
 * 4. 同じ入次数のコミットはtimestampで新しい順にソート
 */
function topoSortCommits(commits: GitCommitType[]): GitCommitType[] {
  if (commits.length === 0) return [];

  const commitMap = new Map<string, GitCommitType>();
  commits.forEach(c => commitMap.set(c.hash, c));

  // 各コミットを指す子の数をカウント（入次数）
  // 親コミットは子から指されているので、親の入次数を増やす
  const inDegree = new Map<string, number>();

  commits.forEach(c => {
    inDegree.set(c.hash, 0);
  });

  // 親子関係を構築（表示されているコミットのみ）
  // 子→親の辺があるので、親の入次数を増やす
  commits.forEach(c => {
    c.parentHashes.forEach(parentHash => {
      if (commitMap.has(parentHash)) {
        // 親コミットの入次数を増やす（子から指されている）
        inDegree.set(parentHash, (inDegree.get(parentHash) || 0) + 1);
      }
    });
  });

  // 入次数が0のコミット（子がいないコミット = 最新のコミット）を収集
  // timestampで新しい順にソート
  const queue: GitCommitType[] = commits
    .filter(c => (inDegree.get(c.hash) || 0) === 0)
    .sort((a, b) => b.timestamp - a.timestamp);

  const result: GitCommitType[] = [];
  const visited = new Set<string>();

  while (queue.length > 0) {
    // キューの先頭から取得（既にソート済み）
    const commit = queue.shift()!;

    if (visited.has(commit.hash)) continue;
    visited.add(commit.hash);
    result.push(commit);

    // このコミットの親の入次数を減らし、0になったものをキューに追加
    const newReadyCommits: GitCommitType[] = [];
    commit.parentHashes.forEach(parentHash => {
      const parent = commitMap.get(parentHash);
      if (parent && !visited.has(parentHash)) {
        const newDegree = (inDegree.get(parentHash) || 0) - 1;
        inDegree.set(parentHash, newDegree);
        if (newDegree === 0) {
          newReadyCommits.push(parent);
        }
      }
    });

    // 新たにキューに追加するコミットをソートしてマージ
    if (newReadyCommits.length > 0) {
      newReadyCommits.sort((a, b) => b.timestamp - a.timestamp);
      // キューにマージ（timestampで新しい順を維持）
      const merged: GitCommitType[] = [];
      let i = 0;
      let j = 0;
      while (i < queue.length && j < newReadyCommits.length) {
        if (queue[i].timestamp >= newReadyCommits[j].timestamp) {
          merged.push(queue[i++]);
        } else {
          merged.push(newReadyCommits[j++]);
        }
      }
      while (i < queue.length) merged.push(queue[i++]);
      while (j < newReadyCommits.length) merged.push(newReadyCommits[j++]);
      queue.length = 0;
      queue.push(...merged);
    }
  }

  // 循環がある場合、残りのコミットを追加
  commits.forEach(c => {
    if (!visited.has(c.hash)) {
      result.push(c);
    }
  });

  return result;
}

/**
 * VSCodeスタイルのレーン割り当てアルゴリズム
 *
 * 新しいコミットから古いコミットへの順序で処理し、
 * 各コミットに適切なレーンを割り当てます。
 *
 * ルール：
 * 1. 子コミットから見て、第1親はそのレーンを継承
 * 2. マージの第2親以降は新しいレーンに配置
 * 3. ブランチの終端（親を持たないコミット）でレーンを解放
 */
function assignLanes(
  commits: GitCommitType[],
  branchColors: string[]
): { commitLanes: Map<string, number>; commitColors: Map<string, string>; maxLane: number } {
  const commitLanes = new Map<string, number>();
  const commitColors = new Map<string, string>();

  // アクティブなレーン管理
  let totalLanes = 0;
  // 空いているレーンのセット（O(1)でのアクセス用）
  const availableLanes = new Set<number>();

  // 各コミットの子を追跡
  const childrenMap = new Map<string, string[]>();
  const commitMap = new Map<string, GitCommitType>();
  commits.forEach(c => {
    commitMap.set(c.hash, c);
    childrenMap.set(c.hash, []);
  });

  // 子関係を構築
  commits.forEach(c => {
    c.parentHashes.forEach(parentHash => {
      if (childrenMap.has(parentHash)) {
        childrenMap.get(parentHash)?.push(c.hash);
      }
    });
  });

  // 予約済みレーン: 親コミットがこのレーンを使う予定
  const reservedLanes = new Map<string, number>();

  // 空いているレーンを取得するヘルパー関数（excludeを除く）
  const getAvailableLane = (exclude?: number): number => {
    for (const lane of availableLanes) {
      if (lane !== exclude) {
        return lane;
      }
    }
    // 空いているレーンがない場合、新しいレーンを作成
    return totalLanes;
  };

  for (const commit of commits) {
    let assignedLane: number;
    let assignedColor: string;

    // このコミットにレーンが予約されているかチェック
    if (reservedLanes.has(commit.hash)) {
      assignedLane = reservedLanes.get(commit.hash)!;
      assignedColor = branchColors[assignedLane % branchColors.length];
      reservedLanes.delete(commit.hash);
      // 予約されていたレーンを使用中にする（availableLanesから削除）
      availableLanes.delete(assignedLane);
    } else {
      // 新しいレーンを割り当て
      assignedLane = getAvailableLane();
      if (assignedLane === totalLanes) {
        totalLanes++;
      } else {
        availableLanes.delete(assignedLane);
      }
      assignedColor = branchColors[assignedLane % branchColors.length];
    }

    commitLanes.set(commit.hash, assignedLane);
    commitColors.set(commit.hash, assignedColor);

    // 親コミットのレーンを予約
    if (commit.parentHashes.length > 0) {
      // 第1親: このコミットのレーンを継承
      const firstParent = commit.parentHashes[0];
      if (commitMap.has(firstParent) && !reservedLanes.has(firstParent)) {
        reservedLanes.set(firstParent, assignedLane);
      }

      // 第2親以降: 新しいレーン
      for (let i = 1; i < commit.parentHashes.length; i++) {
        const parentHash = commit.parentHashes[i];
        if (commitMap.has(parentHash) && !reservedLanes.has(parentHash)) {
          // 空いているレーンを探す（現在のレーン以外）
          const newLane = getAvailableLane(assignedLane);
          if (newLane === totalLanes) {
            totalLanes++;
          } else {
            availableLanes.delete(newLane);
          }
          reservedLanes.set(parentHash, newLane);
        }
      }
    }

    // このコミットに子がいなければレーンを解放
    const childCount = childrenMap.get(commit.hash)?.length || 0;
    // 子の中でこのコミットを第1親として持つものの数
    const firstParentChildCount = (childrenMap.get(commit.hash) || []).filter(childHash => {
      const child = commitMap.get(childHash);
      return child && child.parentHashes[0] === commit.hash;
    }).length;

    // 全ての子が処理済みで、もうこのレーンを使う子がいなければ解放
    if (childCount === 0 || firstParentChildCount === 0) {
      // ただし、まだ処理されていない親への接続がある場合は解放しない
      const hasUnprocessedParent = commit.parentHashes.some(
        p => commitMap.has(p) && !commitLanes.has(p)
      );
      if (!hasUnprocessedParent && firstParentChildCount === 0) {
        availableLanes.add(assignedLane);
      }
    }
  }

  const maxLane = totalLanes > 0 ? totalLanes - 1 : 0;
  return { commitLanes, commitColors, maxLane };
}

// diffOutputをパースしてCommitChangesに変換
function parseDiffOutput(diffOutput: string): CommitChanges {
  const changes: CommitChanges = {
    added: [],
    modified: [],
    deleted: [],
  };

  if (!diffOutput || diffOutput.trim() === '' || diffOutput === 'No differences between commits') {
    return changes;
  }

  const lines = diffOutput.split('\n');
  let currentFile = '';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('diff --git ')) {
      const match = line.match(/diff --git a\/(.+) b\/(.+)/);
      if (match) {
        currentFile = match[2];
      } else {
        currentFile = '';
      }
    }
    if (line.startsWith('deleted file mode')) {
      if (currentFile && !changes.deleted.includes(currentFile)) {
        changes.deleted.push(currentFile);
      }
      currentFile = '';
      continue;
    }
    if (line.startsWith('new file mode')) {
      if (currentFile && !changes.added.includes(currentFile)) {
        changes.added.push(currentFile);
      }
      continue;
    }
    if (line.startsWith('index ') && currentFile) {
      if (!changes.added.includes(currentFile) && !changes.deleted.includes(currentFile)) {
        if (!changes.modified.includes(currentFile)) {
          changes.modified.push(currentFile);
        }
      }
    }
  }

  return changes;
}

function GitHistoryComponent({
  commits,
  currentProject,
  currentProjectId,
  currentBranch,
  hasMore,
  isLoadingMore,
  onLoadMore,
}: GitHistoryProps) {
  const [extendedCommits, setExtendedCommits] = useState<ExtendedCommit[]>([]);
  const [expandedCommits, setExpandedCommits] = useState<Set<string>>(new Set());
  const [commitChanges, setCommitChanges] = useState<Map<string, CommitChanges>>(new Map());
  const svgRef = useRef<SVGSVGElement>(null);

  const gitCommands = useMemo(
    () =>
      currentProject && currentProjectId
        ? terminalCommandRegistry.getGitCommands(currentProject, currentProjectId)
        : null,
    [currentProject, currentProjectId]
  );

  const { handleDiffFileClick, handleDiffAllFilesClick } = useDiffTabHandlers({
    name: currentProject,
    id: currentProjectId,
  });

  const { colors } = useTheme();

  const branchColors = useMemo(
    () =>
      colors.gitBranchColors || [
        '#3b82f6',
        '#10b981',
        '#f59e0b',
        '#ef4444',
        '#8b5cf6',
        '#06b6d4',
        '#f97316',
        '#84cc16',
      ],
    [colors.gitBranchColors]
  );

  const getCommitRowHeight = useCallback(
    (commitHash: string): number => {
      const baseHeight = 28;
      const FILE_ITEM_HEIGHT = 24;
      const MAX_FILES_DISPLAY = 10;
      const HEADER_FOOTER_HEIGHT = 32;

      if (!expandedCommits.has(commitHash)) {
        return baseHeight;
      }

      const changes = commitChanges.get(commitHash);
      if (!changes) {
        return baseHeight + HEADER_FOOTER_HEIGHT;
      }

      const totalFiles = changes.added.length + changes.modified.length + changes.deleted.length;
      const displayFiles = Math.min(totalFiles, MAX_FILES_DISPLAY);
      if (displayFiles === 0) {
        return baseHeight + HEADER_FOOTER_HEIGHT;
      }
      const expandedHeight = HEADER_FOOTER_HEIGHT + displayFiles * FILE_ITEM_HEIGHT;
      return baseHeight + expandedHeight;
    },
    [expandedCommits, commitChanges]
  );

  const [svgHeight, setSvgHeight] = useState<number>(0);

  useEffect(() => {
    if (commits.length === 0) return;

    // トポロジカルソートで正しい順序に並べ替え
    const sortedCommits = topoSortCommits(commits);

    const LANE_WIDTH = 16;
    const Y_OFFSET = 10;

    // レーン割り当て
    const { commitLanes, commitColors } = assignLanes(sortedCommits, branchColors);

    let currentY = Y_OFFSET;
    const processedCommits: ExtendedCommit[] = sortedCommits.map(commit => {
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
  }, [commits, expandedCommits, commitChanges, branchColors, getCommitRowHeight]);

  // コミットの変更ファイルを取得
  const getCommitChanges = useCallback(
    async (commitHash: string) => {
      if (!gitCommands || commitChanges.has(commitHash)) return;

      try {
        const currentCommit = commits.find(c => c.hash === commitHash);
        if (!currentCommit || currentCommit.parentHashes.length === 0) {
          setCommitChanges(prev =>
            new Map(prev).set(commitHash, { added: [], modified: [], deleted: [] })
          );
          return;
        }

        const parentHash = currentCommit.parentHashes[0];
        const diffOutput = await gitCommands.diffCommits(parentHash, commitHash);
        const changes = parseDiffOutput(diffOutput);
        setCommitChanges(prev => new Map(prev).set(commitHash, changes));
      } catch (err) {
        console.error('Failed to get commit changes:', err);
      }
    },
    [gitCommands, commitChanges, commits]
  );

  const toggleCommitExpansion = useCallback(
    async (commitHash: string) => {
      const newExpanded = new Set(expandedCommits);
      if (newExpanded.has(commitHash)) {
        newExpanded.delete(commitHash);
      } else {
        newExpanded.add(commitHash);
        await getCommitChanges(commitHash);
      }
      setExpandedCommits(newExpanded);
    },
    [expandedCommits, getCommitChanges]
  );

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

  const getFileIcon = (type: 'added' | 'modified' | 'deleted') => {
    switch (type) {
      case 'added':
        return <FilePlus className="w-2.5 h-2.5 text-green-500" />;
      case 'modified':
        return <FileText className="w-2.5 h-2.5 text-blue-500" />;
      case 'deleted':
        return <FileMinus className="w-2.5 h-2.5 text-red-500" />;
    }
  };

  /**
   * 2点間のベジェ曲線パスを生成
   */
  const createBezierPath = (x1: number, y1: number, x2: number, y2: number): string => {
    const midY = (y1 + y2) / 2;
    if (x1 === x2) {
      // 垂直線
      return `M ${x1} ${y1} L ${x2} ${y2}`;
    }
    // ベジェ曲線
    return `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`;
  };

  return (
    <div
      className="h-full flex flex-col"
      style={{ background: colors.sidebarBg, color: colors.sidebarFg }}
    >
      <div className="flex-1 overflow-auto">
        <div className="relative min-w-0" style={{ overflow: 'visible' }}>
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
            {/* 接続線を描画 */}
            {extendedCommits.map(commit => {
              const lines: React.ReactElement[] = [];

              if (commit.parentHashes && commit.parentHashes.length > 0) {
                commit.parentHashes.forEach((parentHash, parentIndex) => {
                  const parentCommit = extendedCommits.find(c => c.hash === parentHash);
                  if (parentCommit) {
                    // コミット間の接続線を描画
                    const path = createBezierPath(
                      commit.x,
                      commit.y,
                      parentCommit.x,
                      parentCommit.y
                    );

                    // 色はコミットから親に向かう線では、親に近い方の色を使う
                    const lineColor = parentIndex === 0 ? commit.laneColor : parentCommit.laneColor;

                    lines.push(
                      <path
                        key={`line-${commit.hash}-${parentHash}-${parentIndex}`}
                        d={path}
                        stroke={lineColor}
                        strokeWidth="2"
                        fill="none"
                      />
                    );
                  } else {
                    // 親が表示範囲外の場合、点線で下に延長
                    const virtualY = commit.y + 28;
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
            {/* コミットポイントを描画 */}
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
                  <circle cx={commit.x} cy={commit.y} r="2" fill={colors.gitMergeDot || 'white'} />
                )}
              </g>
            ))}
          </svg>
          {/* Commit list */}
          <div className="pl-8">
            {extendedCommits.map(commit => {
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
                              handleDiffAllFilesClick && (
                                <button
                                  className="ml-1 p-0.5 rounded hover:bg-gray-700"
                                  title={t('gitHistory.showAllFilesDiff')}
                                  style={{
                                    verticalAlign: 'middle',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                  }}
                                  onClick={async e => {
                                    e.stopPropagation();
                                    await handleDiffAllFilesClick({
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
                                      className={
                                        'flex items-center gap-0.5 px-1 py-0.5 rounded text-[10px] font-medium flex-shrink-0 whitespace-nowrap border'
                                      }
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
                        <>
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
                            return allFiles.length;
                          })() > 10 && (
                            <div
                              className="text-[10px] italic py-0.5 mb-1"
                              style={{
                                color: colors.gitCommitMeta || 'var(--muted-foreground)',
                              }}
                            >
                              {t('gitHistory.allFiles', {
                                params: {
                                  count: (() => {
                                    const changes = commitChanges.get(commit.hash)!;
                                    return (
                                      changes.added.length +
                                      changes.modified.length +
                                      changes.deleted.length
                                    );
                                  })(),
                                },
                              })}
                            </div>
                          )}
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
                                ...changes.deleted.map(f => ({
                                  file: f,
                                  type: 'deleted' as const,
                                })),
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
                                      onClick={async () => {
                                        if (handleDiffFileClick) {
                                          await handleDiffFileClick({
                                            commitId: commit.hash,
                                            filePath: file,
                                          });
                                        }
                                      }}
                                      title={t('gitHistory.showFileDiff')}
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
                                </>
                              );
                            })()}
                          </div>
                        </>
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
            {/* もっと読み込むボタン */}
            {hasMore && onLoadMore && (
              <div style={{ paddingLeft: '2rem', paddingTop: '0.75rem', paddingBottom: '0.75rem' }}>
                <button
                  onClick={onLoadMore}
                  disabled={isLoadingMore}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.5rem',
                    width: '100%',
                    padding: '0.5rem 0.75rem',
                    borderRadius: '0.375rem',
                    fontSize: '0.75rem',
                    fontWeight: 500,
                    border: 'none',
                    background: colors.mutedBg,
                    color: colors.foreground,
                    opacity: isLoadingMore ? 0.6 : 1,
                    cursor: isLoadingMore ? 'not-allowed' : 'pointer',
                    transition: 'opacity 0.2s',
                  }}
                  onMouseEnter={e => {
                    if (!isLoadingMore) {
                      e.currentTarget.style.opacity = '0.8';
                    }
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.opacity = isLoadingMore ? '0.6' : '1';
                  }}
                >
                  {isLoadingMore ? (
                    <>
                      <Loader2
                        style={{
                          width: '0.75rem',
                          height: '0.75rem',
                          animation: 'spin 1s linear infinite',
                        }}
                      />
                      {t('gitHistory.loadingMore')}
                    </>
                  ) : (
                    t('gitHistory.loadMore')
                  )}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// React.memoでラップしてエクスポート（propsが変わらない限り再レンダリングを防ぐ）
export default memo(GitHistoryComponent);
