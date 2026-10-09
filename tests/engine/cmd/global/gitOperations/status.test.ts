import { describe, expect, it } from 'vitest';
import { parseGitLog, parseGitStatus } from '@/components/Left/GitPanel/gitUtils';
import {
  categorizeStatusFiles,
  formatStatusResult,
} from '@/engine/cmd/global/gitOperations/status';

describe('Git status formatting', () => {
  it('preserves colons in changed filenames and accepts an empty log', () => {
    const status = parseGitStatus(
      [
        'On branch main',
        'Changes to be committed:',
        '  modified:   src/file:with:colons.ts',
        '',
        'Changes not staged for commit:',
        '  deleted:    src/removed:old.ts',
      ].join('\n')
    );

    expect(status.staged).toEqual(['src/file:with:colons.ts']);
    expect(status.deleted).toEqual(['src/removed:old.ts']);
    expect(parseGitLog('\n  \n')).toEqual([]);
  });

  it('reports staged additions, edits, deletions, and remaining worktree edits accurately', async () => {
    const status = [
      ['added.ts', 0, 2, 2],
      ['edited.ts', 1, 2, 2],
      ['edited-again.ts', 1, 2, 3],
      ['staged-edit-reverted.ts', 1, 1, 3],
      ['staged-edit-deleted.ts', 1, 0, 3],
      ['staged-add-edited.ts', 0, 2, 3],
      ['staged-delete-recreated.ts', 1, 2, 0],
      ['deleted.ts', 1, 0, 0],
      ['unstaged.ts', 1, 2, 1],
      ['unstaged-deleted.ts', 1, 0, 1],
      ['untracked.ts', 0, 2, 0],
    ] satisfies Array<[string, number, number, number]>;

    const output = await formatStatusResult(status, 'main');

    expect(output).toContain('  new file:   added.ts');
    expect(output).toContain('  modified:   edited.ts');
    expect(output).toContain('  modified:   edited-again.ts');
    expect(output).toContain('  modified:   staged-edit-reverted.ts');
    expect(output).toContain('  modified:   staged-edit-deleted.ts');
    expect(output).toContain('  deleted:    staged-edit-deleted.ts');
    expect(output).toContain('  new file:   staged-add-edited.ts');
    expect(output).toContain('  modified:   staged-add-edited.ts');
    expect(output).toContain('  staged-delete-recreated.ts');
    expect(output).toContain('  deleted:    deleted.ts');
    expect(output).toContain('  modified:   unstaged.ts');
    expect(output).toContain('  deleted:    unstaged-deleted.ts');
    expect(output).toContain('  untracked.ts');
    expect(output).not.toContain('nothing added to commit but untracked files present');
    expect(output).not.toContain('new file:   edited.ts');
    expect(output).not.toContain('new file:   deleted.ts');

    expect(parseGitStatus(output)).toMatchObject({
      staged: [
        'added.ts',
        'staged-add-edited.ts',
        'edited.ts',
        'edited-again.ts',
        'staged-edit-reverted.ts',
        'staged-edit-deleted.ts',
        'staged-delete-recreated.ts',
        'deleted.ts',
      ],
      unstaged: [
        'edited-again.ts',
        'staged-edit-reverted.ts',
        'staged-add-edited.ts',
        'unstaged.ts',
      ],
      deleted: ['staged-edit-deleted.ts', 'unstaged-deleted.ts'],
      untracked: ['staged-delete-recreated.ts', 'untracked.ts'],
      branch: 'main',
    });
  });

  it('keeps untracked names that resemble status guidance', async () => {
    const files = [
      '(notes).txt',
      'git add later.txt',
      'to include.txt',
      'On branch fake',
      'Changes to be committed:',
      'modified: filename',
      'nothing added to commit but untracked files present (use "git add" to track)',
    ];
    const status = files.map(file => [file, 0, 2, 0] as [string, number, number, number]);
    const output = await formatStatusResult(status, 'main');

    expect(parseGitStatus(output).untracked).toEqual(files);
  });

  it('preserves commits with empty messages', () => {
    const hash = 'a'.repeat(40);
    const date = '2026-10-09T00:00:00.000Z';
    const [commit] = parseGitLog(`${hash}||Stasshe|${date}|||tree`);

    expect(commit).toMatchObject({ hash, message: '', author: 'Stasshe' });
  });

  it('categorizes staged and unstaged changes independently', () => {
    expect(
      categorizeStatusFiles([
        ['added.ts', 0, 2, 2],
        ['edited.ts', 1, 2, 2],
        ['edited-again.ts', 1, 2, 3],
        ['staged-edit-reverted.ts', 1, 1, 3],
        ['staged-edit-deleted.ts', 1, 0, 3],
        ['staged-add-edited.ts', 0, 2, 3],
        ['staged-delete-recreated.ts', 1, 2, 0],
        ['deleted.ts', 1, 0, 0],
        ['unstaged.ts', 1, 2, 1],
        ['unstaged-deleted.ts', 1, 0, 1],
      ])
    ).toEqual({
      untracked: ['staged-delete-recreated.ts'],
      modified: [
        'edited-again.ts',
        'staged-edit-reverted.ts',
        'staged-add-edited.ts',
        'unstaged.ts',
      ],
      stagedAdded: ['added.ts', 'staged-add-edited.ts'],
      stagedModified: [
        'edited.ts',
        'edited-again.ts',
        'staged-edit-reverted.ts',
        'staged-edit-deleted.ts',
      ],
      stagedDeleted: ['staged-delete-recreated.ts', 'deleted.ts'],
      deleted: ['staged-edit-deleted.ts', 'unstaged-deleted.ts'],
    });
  });
});
