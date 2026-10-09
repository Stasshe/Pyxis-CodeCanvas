import * as Comlink from 'comlink';
import { scoreFileMatch } from './fileSearchUtils';

type FilePayload = { id: string; name: string; path: string; type?: string };
export type OperationSearchResult = { id: string; score: number };
export interface OperationWorkerApi {
  updateFiles(files: FilePayload[], version: number): Promise<void>;
  search(tokens: string[]): Promise<OperationSearchResult[]>;
}

let files: FilePayload[] = [];

function performSearch(tokens: string[]): OperationSearchResult[] {
  if (!tokens || tokens.length === 0) {
    // return all files with default score
    return files.filter(f => f.type === 'file').map(f => ({ id: f.id, score: 100 }));
  }

  const results: OperationSearchResult[] = [];

  for (const f of files) {
    if (f.type && f.type !== 'file') continue;

    let matchedAll = true;
    let totalScore = 0;

    for (const token of tokens) {
      const score = scoreFileMatch(f.name || '', f.path || '', token);
      if (score === null) {
        matchedAll = false;
        break;
      }
      totalScore += score;
    }

    if (matchedAll) {
      results.push({ id: f.id, score: totalScore / tokens.length });
    }
  }

  const fileById = new Map(files.map(file => [file.id, file]));
  results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const fileA = fileById.get(a.id);
    const fileB = fileById.get(b.id);
    const pathA = fileA?.path ?? a.id;
    const pathB = fileB?.path ?? b.id;
    const pathOrder = pathA.localeCompare(pathB, undefined, { sensitivity: 'base', numeric: true });
    if (pathOrder !== 0) return pathOrder;
    return a.id.localeCompare(b.id);
  });

  return results;
}

const api: OperationWorkerApi = {
  async updateFiles(nextFiles, _version) {
    files = nextFiles;
  },

  async search(tokens) {
    return performSearch(tokens);
  },
};

Comlink.expose(api);
