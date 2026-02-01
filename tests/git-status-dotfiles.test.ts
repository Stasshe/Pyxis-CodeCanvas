import { parseGitStatus } from '@/components/Left/GitPanel/gitUtils';

describe('Git status parsing for dotfiles', () => {
  it('should parse deleted dotfiles in unstaged changes', () => {
    const statusOutput = `On branch main
Changes not staged for commit:
  (use "git add/rm <file>..." to update what will be committed)
  (use "git restore <file>..." to discard changes in working directory)

  deleted:    .gitignore
  deleted:    .env
  modified:   src/index.ts

Untracked files:
  (use "git add <file>..." to include in what will be committed)

  new-file.txt
`;

    const result = parseGitStatus(statusOutput);

    expect(result.branch).toBe('main');
    expect(result.deleted).toContain('.gitignore');
    expect(result.deleted).toContain('.env');
    expect(result.unstaged).toContain('src/index.ts');
    expect(result.untracked).toContain('new-file.txt');
    expect(result.deleted.length).toBe(2);
  });

  it('should parse staged deleted dotfiles', () => {
    const statusOutput = `On branch main
Changes to be committed:
  (use "git restore --staged <file>..." to unstage)

  deleted:    .gitignore
  new file:   src/index.ts
`;

    const result = parseGitStatus(statusOutput);

    expect(result.branch).toBe('main');
    expect(result.staged).toContain('.gitignore');
    expect(result.staged).toContain('src/index.ts');
    expect(result.staged.length).toBe(2);
  });

  it('should parse untracked dotfiles', () => {
    const statusOutput = `On branch main
Untracked files:
  (use "git add <file>..." to include in what will be committed)

  .env.local
  .DS_Store
  regular-file.txt
`;

    const result = parseGitStatus(statusOutput);

    expect(result.untracked).toContain('.env.local');
    expect(result.untracked).toContain('.DS_Store');
    expect(result.untracked).toContain('regular-file.txt');
    expect(result.untracked.length).toBe(3);
  });
});
