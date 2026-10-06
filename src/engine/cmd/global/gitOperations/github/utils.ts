export function parseGitHubUrl(url: string): { owner: string; repo: string } | null {
  const httpsMatch = url.match(/https:\/\/github\.com\/([^/]+)\/([^/.]+)(\.git)?/);
  if (httpsMatch) {
    return { owner: httpsMatch[1], repo: httpsMatch[2] };
  }

  const sshMatch = url.match(/git@github\.com:([^/]+)\/([^/.]+)(\.git)?/);
  if (sshMatch) {
    return { owner: sshMatch[1], repo: sshMatch[2] };
  }

  return null;
}
