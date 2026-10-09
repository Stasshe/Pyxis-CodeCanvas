import { describe, expect, it } from 'vitest';
import { parseGitHubUrl } from '@/engine/cmd/global/gitOperations/github/utils';

describe('parseGitHubUrl', () => {
  it.each([
    ['https://github.com/owner/repository', 'owner', 'repository'],
    ['https://github.com/owner/repo.name', 'owner', 'repo.name'],
    ['https://github.com/owner/repo.name.git', 'owner', 'repo.name'],
    ['git@github.com:owner/repository', 'owner', 'repository'],
    ['git@github.com:owner/repo.name', 'owner', 'repo.name'],
    ['git@github.com:owner/repo.name.git', 'owner', 'repo.name'],
  ])('parses %s', (url, owner, repo) => {
    expect(parseGitHubUrl(url)).toEqual({ owner, repo });
  });

  it.each([
    'https://github.com/owner/repository/tree/main',
    'https://github.com/owner/repository?tab=readme',
    'https://github.com/owner/repository#readme',
    'https://github.com.evil.example/owner/repository',
    'git@github.com:owner/repository/extra',
  ])('rejects unsupported URL %s', url => {
    expect(parseGitHubUrl(url)).toBeNull();
  });
});
