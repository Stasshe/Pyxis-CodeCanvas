import type { GitCommit as GitCommitType } from '@/types/git';

export interface CommitChanges {
  added: string[];
  modified: string[];
  deleted: string[];
}

export function topoSortCommits(commits: GitCommitType[]): GitCommitType[] {
  if (commits.length === 0) return [];

  const commitMap = new Map<string, GitCommitType>();
  commits.forEach(c => {
    commitMap.set(c.hash, c);
  });

  const inDegree = new Map<string, number>();

  commits.forEach(c => {
    inDegree.set(c.hash, 0);
  });

  commits.forEach(c => {
    c.parentHashes.forEach(parentHash => {
      if (commitMap.has(parentHash)) {
        inDegree.set(parentHash, (inDegree.get(parentHash) || 0) + 1);
      }
    });
  });

  const queue: GitCommitType[] = commits
    .filter(c => (inDegree.get(c.hash) || 0) === 0)
    .sort((a, b) => b.timestamp - a.timestamp);

  const result: GitCommitType[] = [];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const commit = queue.shift()!;

    if (visited.has(commit.hash)) continue;
    visited.add(commit.hash);
    result.push(commit);

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

    if (newReadyCommits.length > 0) {
      newReadyCommits.sort((a, b) => b.timestamp - a.timestamp);

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

  commits.forEach(c => {
    if (!visited.has(c.hash)) {
      result.push(c);
    }
  });

  return result;
}

interface Swimlane {
  id: string; // 追跡しているコミットのハッシュ
  color: string;
  lane: number;
}

export function assignLanes(
  commits: GitCommitType[],
  branchColors: string[]
): { commitLanes: Map<string, number>; commitColors: Map<string, string>; maxLane: number } {
  const commitLanes = new Map<string, number>();
  const commitColors = new Map<string, string>();

  if (commits.length === 0) {
    return { commitLanes, commitColors, maxLane: 0 };
  }

  const commitMap = new Map<string, GitCommitType>();
  commits.forEach(c => {
    commitMap.set(c.hash, c);
  });

  const defaultColor = '#3b82f6';
  const colors = branchColors.length > 0 ? branchColors : [defaultColor];

  let colorIndex = 0;
  let currentSwimlanes: Swimlane[] = [];
  let maxLane = 0;

  const getNextColor = (): string => {
    const color = colors[colorIndex];
    colorIndex = (colorIndex + 1) % colors.length;
    return color;
  };

  const getAvailableLane = (usedLanes: Set<number>): number => {
    let lane = 0;
    while (usedLanes.has(lane)) {
      lane++;
    }
    return lane;
  };

  for (const commit of commits) {
    const inputIndex = currentSwimlanes.findIndex(s => s.id === commit.hash);

    let commitLane: number;
    let commitColor: string;

    if (inputIndex !== -1) {
      commitLane = currentSwimlanes[inputIndex].lane;
      commitColor = currentSwimlanes[inputIndex].color;
    } else {
      const usedLanes = new Set(currentSwimlanes.map(s => s.lane));
      commitLane = getAvailableLane(usedLanes);
      commitColor = getNextColor();
    }

    commitLanes.set(commit.hash, commitLane);
    commitColors.set(commit.hash, commitColor);
    maxLane = Math.max(maxLane, commitLane);

    const outputSwimlanes: Swimlane[] = [];
    let firstParentAdded = false;

    if (commit.parentHashes.length > 0) {
      for (const swimlane of currentSwimlanes) {
        if (swimlane.id === commit.hash) {
          if (!firstParentAdded && commitMap.has(commit.parentHashes[0])) {
            outputSwimlanes.push({
              id: commit.parentHashes[0],
              color: commitColor,
              lane: commitLane,
            });
            firstParentAdded = true;
          }
        } else {
          outputSwimlanes.push({ ...swimlane });
        }
      }

      if (!firstParentAdded && commitMap.has(commit.parentHashes[0])) {
        outputSwimlanes.push({
          id: commit.parentHashes[0],
          color: commitColor,
          lane: commitLane,
        });
        firstParentAdded = true;
      }

      for (let i = 1; i < commit.parentHashes.length; i++) {
        const parentHash = commit.parentHashes[i];
        if (!commitMap.has(parentHash)) continue;

        const existingIndex = outputSwimlanes.findIndex(s => s.id === parentHash);
        if (existingIndex !== -1) continue;

        const usedLanes = new Set(outputSwimlanes.map(s => s.lane));
        const newLane = getAvailableLane(usedLanes);
        const newColor = getNextColor();

        outputSwimlanes.push({
          id: parentHash,
          color: newColor,
          lane: newLane,
        });
        maxLane = Math.max(maxLane, newLane);
      }
    } else {
      for (const swimlane of currentSwimlanes) {
        if (swimlane.id !== commit.hash) {
          outputSwimlanes.push({ ...swimlane });
        }
      }
    }

    currentSwimlanes = outputSwimlanes;
  }

  return { commitLanes, commitColors, maxLane };
}

export function parseDiffOutput(diffOutput: string): CommitChanges {
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
