import * as Comlink from 'comlink';

type FilePayload = { id: string; name: string; path: string; type?: string };
export type OperationSearchResult = { id: string; score: number };
export interface OperationWorkerApi {
  updateFiles(files: FilePayload[], version: number): Promise<void>;
  search(tokens: string[]): Promise<OperationSearchResult[]>;
}

// --- Copied scoreMatch from OperationUtils ---
function scoreMatch(text: string, query: string): number {
  if (!query) return 100;
  const t = text.toLowerCase();
  const q = query.toLowerCase();

  if (t === q) return 100;
  if (t.startsWith(q)) return 90;

  const idx = t.indexOf(q);
  if (idx !== -1) {
    const isBoundary =
      idx === 0 || text[idx - 1] === '/' || text[idx - 1] === '_' || text[idx - 1] === '-';
    return isBoundary ? 85 : 70;
  }

  let queryIdx = 0;
  for (let i = 0; i < text.length && queryIdx < query.length; i++) {
    if (text[i].toLowerCase() === query[queryIdx].toLowerCase()) {
      const isUpperCase = text[i] === text[i].toUpperCase() && text[i] !== text[i].toLowerCase();
      const isBoundary =
        i === 0 || text[i - 1] === '/' || text[i - 1] === '_' || text[i - 1] === '-';
      if (isUpperCase || isBoundary || queryIdx > 0) {
        queryIdx++;
      }
    }
  }
  if (queryIdx === query.length) return 60;

  return 0;
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
      const fileName = f.name || '';
      const fileNameNoExt = fileName.substring(0, fileName.lastIndexOf('.')) || fileName;
      const pathParts = (f.path || '').split('/');

      const nameScore = scoreMatch(fileName, token);
      const nameNoExtScore = scoreMatch(fileNameNoExt, token);
      const pathScore = scoreMatch(f.path || '', token);
      const partScores = pathParts.map(part => scoreMatch(part, token));
      const bestPartScore = Math.max(...partScores, 0);

      const best = Math.max(nameScore, nameNoExtScore, pathScore, bestPartScore);

      if (best <= 0) {
        matchedAll = false;
        break;
      }

      totalScore += best;
    }

    if (matchedAll) {
      results.push({ id: f.id, score: totalScore / tokens.length });
    }
  }

  results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
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
