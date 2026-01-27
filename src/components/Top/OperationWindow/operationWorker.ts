type FilePayload = { id: string; name: string; path: string; type?: string };

// --- Copied scoreMatch from OperationUtils ---
function scoreMatch(text: string, query: string): number {
  if (!query) return 100;
  const t = text.toLowerCase();
  const q = query.toLowerCase();

  if (t === q) return 100;
  if (t.startsWith(q)) return 90;

  const idx = t.indexOf(q);
  if (idx !== -1) {
    const isBoundary = idx === 0 || text[idx - 1] === '/' || text[idx - 1] === '_' || text[idx - 1] === '-';
    return isBoundary ? 85 : 70;
  }

  let queryIdx = 0;
  for (let i = 0; i < text.length && queryIdx < query.length; i++) {
    if (text[i].toLowerCase() === query[queryIdx].toLowerCase()) {
      const isUpperCase = text[i] === text[i].toUpperCase() && text[i] !== text[i].toLowerCase();
      const isBoundary = i === 0 || text[i - 1] === '/' || text[i - 1] === '_' || text[i - 1] === '-';
      if (isUpperCase || isBoundary || queryIdx > 0) {
        queryIdx++;
      }
    }
  }
  if (queryIdx === query.length) return 60;

  return 0;
}

let files: FilePayload[] = [];
let filesVersion: number | null = null;

function performSearch(searchId: number, tokens: string[]) {
  if (!tokens || tokens.length === 0) {
    // return all files with default score
    const res = files
      .filter(f => f.type === 'file')
      .map(f => ({ id: f.id, score: 100 }));
    postMessage({ type: 'result', searchId, results: res });
    return;
  }

  const results: Array<{ id: string; score: number }> = [];

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

  postMessage({ type: 'result', searchId, results });
}

onmessage = (e: MessageEvent) => {
  const msg = e.data;
  if (!msg) return;

  try {
    if (msg.type === 'updateFiles') {
      files = msg.files || [];
      filesVersion = msg.filesVersion || null;
    } else if (msg.type === 'search') {
      performSearch(msg.searchId, msg.tokens || []);
    }
  } catch (err) {
    // return empty result on error
    postMessage({ type: 'result', searchId: msg && msg.searchId ? msg.searchId : 0, results: [] });
  }
};
