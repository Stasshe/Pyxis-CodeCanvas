/**
 * GitHub関連のユーティリティ関数
 */

/**
 * GitHubのリポジトリ情報を解析
 */
export function parseGitHubUrl(url: string): { owner: string; repo: string } | null {
  // https://github.com/owner/repo.git 形式
  const httpsMatch = url.match(/https:\/\/github\.com\/([^\/]+)\/([^\/\.]+)(\.git)?/);
  if (httpsMatch) {
    return { owner: httpsMatch[1], repo: httpsMatch[2] };
  }

  // git@github.com:owner/repo.git 形式
  const sshMatch = url.match(/git@github\.com:([^\/]+)\/([^\/\.]+)(\.git)?/);
  if (sshMatch) {
    return { owner: sshMatch[1], repo: sshMatch[2] };
  }

  return null;
}
