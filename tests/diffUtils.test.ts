import { applyUnifiedDiffToContent, getStagedContent } from '../src/hooks/ui/diffUtils';

describe('applyUnifiedDiffToContent', () => {
  test('applies modification hunk correctly', () => {
    const oldContent = ['a', 'b', 'c'].join('\n');
    const diff = `diff --git a/foo b/foo
index 000000..000000 100644
--- a/foo
+++ b/foo
@@ -1,3 +1,3 @@
 a
-b
+c
 c
`;
    const result = applyUnifiedDiffToContent(oldContent, diff, 'foo');
    expect(result.split('\n')).toEqual(['a', 'c', 'c']);
  });

  test('reconstructs new file from + lines when head is empty', () => {
    const oldContent = '';
    const diff = `diff --git a/foo b/foo
new file mode 100644
index 000000..abcdef
--- /dev/null
+++ b/foo
@@ -0,0 +1,2 @@
+hello
+world
`;
    const result = applyUnifiedDiffToContent(oldContent, diff, 'foo');
    expect(result.split('\n')).toEqual(['hello', 'world']);
  });

  test('handles deletion (result empty)', () => {
    const oldContent = ['x', 'y'].join('\n');
    const diff = `diff --git a/foo b/foo
deleted file mode 100644
index abcdef..000000
--- a/foo
+++ /dev/null
@@ -1,2 +0,0 @@
-x
-y
`;
    const result = applyUnifiedDiffToContent(oldContent, diff, 'foo');
    expect(result).toBe('');
  });
});

describe('getStagedContent', () => {
  test('reconstructs staged content using git interface', async () => {
    const oldContent = ['a', 'b', 'c'].join('\n');
    const diff = `diff --git a/foo b/foo
index 000000..000000 100644
--- a/foo
+++ b/foo
@@ -1,3 +1,3 @@
 a
-b
+c-modified
 c
`;
    const git = {
      diff: jest.fn().mockResolvedValue(diff),
      getFileContentAtCommit: jest.fn().mockResolvedValue(oldContent),
    } as any;

    const staged = await getStagedContent(git, 'HEAD', 'foo');
    expect(staged.split('\n')).toEqual(['a', 'c-modified', 'c']);
    expect(git.diff).toHaveBeenCalledWith({ staged: true, filepath: 'foo' });
  });
});
