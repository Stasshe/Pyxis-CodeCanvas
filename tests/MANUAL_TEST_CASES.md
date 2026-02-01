# Manual Test Cases for Wildcard and Dotfile Fixes

## Test Case 1: Wildcard Expansion Excludes Dotfiles

### Setup
1. Create a test project with the following files:
   - `file1.txt`
   - `file2.js`
   - `.gitignore`
   - `.env`
   - `.hidden`

### Test Steps
1. Run `ls *` in terminal
2. Verify output includes `file1.txt` and `file2.js`
3. Verify output does NOT include `.gitignore`, `.env`, or `.hidden`

4. Run `rm -rf *` in terminal
5. Run `ls -la` to verify files
6. Verify `file1.txt` and `file2.js` are deleted
7. Verify `.gitignore`, `.env`, and `.hidden` still exist

### Expected Result
✅ Wildcards do NOT match dotfiles

## Test Case 2: Explicit Dotfile Pattern Matching

### Test Steps
1. Run `ls .*` in terminal
2. Verify output includes `.gitignore`, `.env`, and `.hidden`
3. Verify output does NOT include `file1.txt` or `file2.js`

4. Run `rm .gitignore`
5. Verify `.gitignore` is deleted
6. Check Git Panel - `.gitignore` should appear in "deleted" section (if it was tracked)

### Expected Result
✅ Explicit dot patterns DO match dotfiles
✅ Deleted tracked dotfiles appear in Git Panel

## Test Case 3: Git Status Shows Deleted Dotfiles

### Setup
1. Create a test project
2. Add `.gitignore` with some content
3. Run `git add .gitignore`
4. Run `git commit -m "Add gitignore"`

### Test Steps
1. Delete `.gitignore` using `rm .gitignore` (explicit)
2. Open Git Panel
3. Check if `.gitignore` appears in the "Deleted" section

### Expected Result
✅ Deleted tracked dotfile appears in Git Panel's deleted section
✅ Can stage the deletion with + icon
✅ Can discard the deletion (restore file) with discard icon

## Test Case 4: Untracked Dotfiles

### Setup
1. Create a test project
2. Create `.env.local` (untracked)

### Test Steps
1. Open Git Panel
2. Check if `.env.local` appears in "Untracked files" section

### Expected Result
✅ Untracked dotfiles appear in Git Panel

## Test Case 5: Question Mark Wildcard

### Setup
1. Create files: `a.txt`, `b.txt`, `.txt`

### Test Steps
1. Run `ls ?.txt`
2. Verify output includes `a.txt` and `b.txt`
3. Verify output does NOT include `.txt`

### Expected Result
✅ `?` wildcard does NOT match dotfiles

## Implementation Notes

The fix ensures POSIX-compliant wildcard behavior:
- `*` and `?` wildcards do NOT match files starting with `.`
- To match dotfiles, the pattern must explicitly start with `.`
- Examples:
  - `*` matches `file.txt` but not `.hidden`
  - `.*` matches `.hidden` but not `file.txt`
  - `.g*` matches `.gitignore` and `.github` but not `git.txt`
  - `?` matches `a` but not `.`

This prevents accidental deletion of configuration files and dotfiles, which is the standard behavior in Unix shells.
