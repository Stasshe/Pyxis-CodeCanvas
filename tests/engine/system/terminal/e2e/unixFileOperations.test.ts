import { beforeEach, describe, expect, it } from 'vitest';
import { terminalCommandRegistry } from '@/engine/system/terminal/terminalRegistry';
import { fsClient } from '@/engine/core/fs/index';
import { setupTestProject } from '../../../../_helpers/testProject';

describe('Unix file operation edge cases', () => {
  let shell: Awaited<ReturnType<typeof terminalCommandRegistry.getShell>>;
  let rootPath = '';

  beforeEach(async () => {
    await terminalCommandRegistry.clearAll();
    const project = await setupTestProject('UnixFileOperationsTest');
    rootPath = project.rootPath;
    shell = await terminalCommandRegistry.getShell(project.rootPath);
  });

  it('finds empty files and directories', async () => {
    await shell.run('mkdir empty-dir; touch empty-file; mkdir filled-dir; touch filled-dir/item');

    const result = await shell.run('find . -empty');

    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout.split('\n')).toContain('./empty-dir');
    expect(result.stdout.split('\n')).toContain('./empty-file');
    expect(result.stdout.split('\n')).not.toContain('./filled-dir');
  });

  it('keeps a pruned directory in results and stops before its children', async () => {
    await shell.run('mkdir -p tree/skip/nested; touch tree/skip/nested/file.txt');

    const result = await shell.run('find tree -name skip -prune');

    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain('tree/skip');
    expect(result.stdout).not.toContain('nested');
  });

  it('uses an explicit relative prefix for dash-leading find paths', async () => {
    await shell.run('touch -- -leaf');

    const explicitPath = await shell.run('find ./-leaf');
    const parsedAsPredicate = await shell.run('find -- -leaf');

    expect(explicitPath.code, explicitPath.stderr).toBe(0);
    expect(explicitPath.stdout).toBe('./-leaf\n');
    expect(parsedAsPredicate.code).toBe(1);
    expect(parsedAsPredicate.stderr).toContain("find: unknown predicate '-leaf'");
    expect(parsedAsPredicate.stdout).toBe('');
  });

  it('honors short-circuit expression evaluation when pruning', async () => {
    await shell.run('mkdir -p tree/skip/nested tree/keep; touch tree/skip/nested/file.txt');

    const skippedPrune = await shell.run('find tree -true -o -prune');
    const executedPrune = await shell.run('find tree -prune -a -true');
    const excludedPath = await shell.run('find tree -path tree/skip -prune -o -print');

    expect(skippedPrune.code, skippedPrune.stderr).toBe(0);
    expect(skippedPrune.stdout).toContain('tree/skip/nested/file.txt');
    expect(executedPrune.code, executedPrune.stderr).toBe(0);
    expect(executedPrune.stdout).toBe('tree\n');
    expect(excludedPath.code, excludedPath.stderr).toBe(0);
    expect(excludedPath.stdout).not.toContain('tree/skip');
    expect(excludedPath.stdout).toContain('tree/keep');
  });

  it('uses tree depth as the number of levels below the root', async () => {
    await shell.run('mkdir -p tree/child; touch tree/root.txt tree/child/leaf.txt');

    const result = await shell.run('tree -L 1 tree');

    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain('root.txt');
    expect(result.stdout).toContain('child/');
    expect(result.stdout).not.toContain('leaf.txt');
  });

  it('rejects directory modes instead of silently ignoring them', async () => {
    const result = await shell.run('mkdir -m 700 mode-dir');

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('setting directory modes is not supported');
    expect(result.stdout).toBe('');
  });

  it('reports every stat operand and preserves valid output when one is missing', async () => {
    await shell.run('touch first-file second-file');

    const result = await shell.run('stat first-file missing-file second-file');

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("stat: cannot stat 'missing-file'");
    expect(result.stdout).toContain('File: first-file');
    expect(result.stdout).toContain('File: second-file');
  });

  it('round trips empty gzip files and reports failures with a nonzero status', async () => {
    await shell.run('touch empty-file');

    const compressed = await shell.run('gzip -k -v empty-file');
    await shell.run('rm empty-file');
    const decompressed = await shell.run('gzip -d -k empty-file.gz');
    const missing = await shell.run('gzip missing-file');

    expect(compressed.code, compressed.stderr).toBe(0);
    expect(compressed.stdout).toContain('-Inf%');
    expect(decompressed.code, decompressed.stderr).toBe(0);
    expect(missing.code).toBe(1);
    expect(missing.stdout).toBe('');
    expect(missing.stderr).toContain('gzip: missing-file:');
  });

  it('extracts zip archives to the destination passed with -d', async () => {
    await shell.run('mkdir -p archive-dir/empty; printf data > archive-dir/file.txt');
    const created = await shell.run('zip -r bundle.zip archive-dir');
    const extracted = await shell.run('unzip -d restored bundle.zip');
    const contents = await shell.run('cat restored/archive-dir/file.txt');
    const missing = await shell.run('unzip missing.zip');

    expect(created.code, created.stderr).toBe(0);
    expect(extracted.code, extracted.stderr).toBe(0);
    expect(contents.stdout).toBe('data');
    expect(missing.code).toBe(1);
    expect(missing.stderr).toContain('unzip: missing.zip:');
  });

  it('accepts declared help flags and rejects ignored df arguments', async () => {
    const lsHelp = await shell.run('ls --help');
    const treeHelp = await shell.run('tree --help');
    const invalidDf = await shell.run('df --invalid');

    expect(lsHelp.code, lsHelp.stderr).toBe(0);
    expect(lsHelp.stdout).toContain('Usage: ls');
    expect(treeHelp.code, treeHelp.stderr).toBe(0);
    expect(treeHelp.stdout).toContain('Usage: tree');
    expect(invalidDf.code).not.toBe(0);
    expect(invalidDf.stderr).toContain('options and operands are not supported');
  });

  it('removes dangling symlinks without treating them as missing targets', async () => {
    await fsClient.symlink('missing-target', `${rootPath}/dangling-link`);

    const result = await shell.run('rm dangling-link');

    expect(result.code, result.stderr).toBe(0);
    await expect(fsClient.lstat(`${rootPath}/dangling-link`)).rejects.toThrow();
  });

  it('finds symlink entries by type without walking their targets', async () => {
    await shell.run('mkdir symlink-target; touch symlink-target/inside.txt');
    await fsClient.symlink('symlink-target', `${rootPath}/directory-link`);

    const result = await shell.run('find . -type l');

    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toBe('./directory-link\n');
    expect(result.stdout).not.toContain('inside.txt');
  });

  it('finds dangling symlink roots without following them', async () => {
    await fsClient.symlink('missing-target', `${rootPath}/dangling-link`);

    const result = await shell.run('find dangling-link -type l');

    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toBe('dangling-link\n');
  });

  it('allows path wildcards to cross directory separators', async () => {
    await shell.run('mkdir -p nested/deeper; touch nested/deeper/file.txt');

    const pathMatch = await shell.run("find . -path '*deeper*'");
    const insensitiveMatch = await shell.run("find . -ipath '*NESTED*'");

    expect(pathMatch.code, pathMatch.stderr).toBe(0);
    expect(pathMatch.stdout).toContain('./nested/deeper');
    expect(pathMatch.stdout).toContain('./nested/deeper/file.txt');
    expect(insensitiveMatch.code, insensitiveMatch.stderr).toBe(0);
    expect(insensitiveMatch.stdout).toContain('./nested/deeper/file.txt');
  });

  it('stats and moves dangling symlinks as directory entries', async () => {
    await fsClient.symlink('missing-target', `${rootPath}/dangling-link`);

    const status = await shell.run('stat dangling-link');
    const moved = await shell.run('mv dangling-link moved-link');

    expect(status.code, status.stderr).toBe(0);
    expect(status.stdout).toContain('Type: symlink');
    expect(moved.code, moved.stderr).toBe(0);
    await expect(fsClient.lstat(`${rootPath}/dangling-link`)).rejects.toThrow();
    await expect(fsClient.lstat(`${rootPath}/moved-link`)).resolves.toMatchObject({
      type: 'symlink',
    });
  });

  it('preserves recursive directory links and follows file links during copy', async () => {
    await shell.run(
      'mkdir link-target; printf data > link-target/item.txt; touch link-file-target'
    );
    await fsClient.symlink('link-target', `${rootPath}/directory-link`);
    await fsClient.symlink('link-file-target', `${rootPath}/file-link`);

    const directoryCopy = await shell.run('cp -r directory-link copied-directory-link');
    const fileCopy = await shell.run('cp file-link copied-file');
    const copiedContent = await shell.run('cat copied-file');

    expect(directoryCopy.code, directoryCopy.stderr).toBe(0);
    await expect(fsClient.lstat(`${rootPath}/copied-directory-link`)).resolves.toMatchObject({
      type: 'symlink',
    });
    expect(fileCopy.code, fileCopy.stderr).toBe(0);
    expect(copiedContent.stdout).toBe('');
    await expect(fsClient.lstat(`${rootPath}/copied-file`)).resolves.toMatchObject({
      type: 'file',
    });
  });

  it('preserves nested and dangling symlinks in recursive directory copies', async () => {
    await shell.run('mkdir source-dir; touch source-dir/target.txt');
    await fsClient.symlink('target.txt', `${rootPath}/source-dir/file-link`);
    await fsClient.symlink('missing-target', `${rootPath}/source-dir/dangling-link`);

    const result = await shell.run('cp -r source-dir copied-dir');

    expect(result.code, result.stderr).toBe(0);
    await expect(fsClient.lstat(`${rootPath}/copied-dir/file-link`)).resolves.toMatchObject({
      type: 'symlink',
    });
    await expect(fsClient.lstat(`${rootPath}/copied-dir/dangling-link`)).resolves.toMatchObject({
      type: 'symlink',
    });
  });

  it('classifies and describes symlinks in ls output without inventing inode values', async () => {
    await shell.run('mkdir target-dir links; touch target-file');
    await fsClient.symlink('../target-dir', `${rootPath}/links/directory-link`);
    await fsClient.symlink('../target-file', `${rootPath}/links/file-link`);

    const classified = await shell.run('ls -F links');
    const detailed = await shell.run('ls -ld links/directory-link');
    const inode = await shell.run('ls -i links');

    expect(classified.code, classified.stderr).toBe(0);
    expect(classified.stdout).toContain('directory-link@');
    expect(classified.stdout).toContain('file-link@');
    expect(detailed.code, detailed.stderr).toBe(0);
    expect(detailed.stdout).toContain('directory-link -> ../target-dir');
    expect(detailed.stdout).toMatch(/^l/);
    expect(inode.code).not.toBe(0);
    expect(inode.stderr).toContain('inode numbers are not available');
  });

  it('does not traverse directory symlinks when calculating du totals', async () => {
    await shell.run("mkdir du-target; printf '%02048d' 0 > du-target/large-file");
    await fsClient.symlink('du-target', `${rootPath}/du-link`);

    const directorySize = await shell.run('du -s du-target');
    const linkSize = await shell.run('du -s du-link');
    const linkContents = await shell.run('du du-link');

    expect(directorySize.code, directorySize.stderr).toBe(0);
    expect(directorySize.stdout).toContain('2\tdu-target');
    expect(linkSize.code, linkSize.stderr).toBe(0);
    expect(linkSize.stdout).toContain('0\tdu-link');
    expect(linkContents.stdout).not.toContain('large-file');
  });
});
