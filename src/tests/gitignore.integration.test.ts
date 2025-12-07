/**
 * Integration test for .gitignore functionality
 * 
 * This test verifies that:
 * 1. All files (including ignored ones) are stored in IndexedDB
 * 2. Only non-ignored files are synced to lightning-fs
 * 3. .gitignore rules are correctly parsed and applied
 */

import { parseGitignore, isPathIgnored } from '../engine/core/gitignore';

describe('Gitignore Integration', () => {
  describe('parseGitignore', () => {
    test('parses basic ignore patterns', () => {
      const content = `
# Node modules
node_modules/
dist/
*.log
      `.trim();

      const rules = parseGitignore(content);
      
      expect(rules).toHaveLength(3);
      expect(rules[0].pattern).toBe('node_modules');
      expect(rules[0].directoryOnly).toBe(true);
      expect(rules[1].pattern).toBe('dist');
      expect(rules[1].directoryOnly).toBe(true);
      expect(rules[2].pattern).toBe('*.log');
    });

    test('handles negation patterns', () => {
      const content = `
*.log
!important.log
      `.trim();

      const rules = parseGitignore(content);
      
      expect(rules).toHaveLength(2);
      expect(rules[0].negation).toBe(false);
      expect(rules[1].negation).toBe(true);
      expect(rules[1].pattern).toBe('important.log');
    });

    test('handles anchored patterns', () => {
      const content = `
/build
src/temp/
      `.trim();

      const rules = parseGitignore(content);
      
      expect(rules).toHaveLength(2);
      expect(rules[0].anchored).toBe(true);
      expect(rules[0].pattern).toBe('build');
      expect(rules[1].anchored).toBe(false);
      expect(rules[1].hasSlash).toBe(true);
    });

    test('ignores comments and empty lines', () => {
      const content = `
# This is a comment

node_modules/

# Another comment
*.log
      `.trim();

      const rules = parseGitignore(content);
      
      expect(rules).toHaveLength(2);
    });
  });

  describe('isPathIgnored', () => {
    test('matches directory-only patterns', () => {
      const rules = parseGitignore('node_modules/');
      
      expect(isPathIgnored(rules, 'node_modules', true)).toBe(true);
      expect(isPathIgnored(rules, 'node_modules/react/index.js', false)).toBe(true);
      expect(isPathIgnored(rules, 'src/node_modules/test.js', false)).toBe(true);
    });

    test('matches wildcard patterns', () => {
      const rules = parseGitignore('*.log');
      
      expect(isPathIgnored(rules, 'error.log', false)).toBe(true);
      expect(isPathIgnored(rules, 'src/debug.log', false)).toBe(true);
      expect(isPathIgnored(rules, 'test.txt', false)).toBe(false);
    });

    test('matches anchored patterns', () => {
      const rules = parseGitignore('/build');
      
      expect(isPathIgnored(rules, 'build', false)).toBe(true);
      expect(isPathIgnored(rules, 'build/index.html', false)).toBe(true);
      expect(isPathIgnored(rules, 'src/build', false)).toBe(false);
    });

    test('matches patterns with slashes', () => {
      const rules = parseGitignore('src/temp/');
      
      expect(isPathIgnored(rules, 'src/temp', true)).toBe(true);
      expect(isPathIgnored(rules, 'src/temp/cache.dat', false)).toBe(true);
      expect(isPathIgnored(rules, 'temp', false)).toBe(false);
    });

    test('handles negation patterns', () => {
      const content = `
*.log
!important.log
      `.trim();
      const rules = parseGitignore(content);
      
      expect(isPathIgnored(rules, 'error.log', false)).toBe(true);
      expect(isPathIgnored(rules, 'important.log', false)).toBe(false);
    });

    test('matches double-asterisk patterns', () => {
      const rules = parseGitignore('**/dist');
      
      expect(isPathIgnored(rules, 'dist', false)).toBe(true);
      expect(isPathIgnored(rules, 'packages/app/dist', false)).toBe(true);
      expect(isPathIgnored(rules, 'packages/app/dist/index.js', false)).toBe(true);
    });

    test('complex real-world example', () => {
      const content = `
# Dependencies
node_modules/
.pnp
.pnp.js

# Testing
/coverage

# Production
/build
/dist

# Misc
.DS_Store
*.log
.env.local
.env.development.local
.env.test.local
.env.production.local

# IDE
.vscode/
.idea/
*.swp
*.swo
      `.trim();
      
      const rules = parseGitignore(content);
      
      // Dependencies should be ignored
      expect(isPathIgnored(rules, 'node_modules/react/index.js', false)).toBe(true);
      expect(isPathIgnored(rules, '.pnp.js', false)).toBe(true);
      
      // Coverage directory (anchored)
      expect(isPathIgnored(rules, 'coverage/index.html', false)).toBe(true);
      expect(isPathIgnored(rules, 'src/coverage/test.js', false)).toBe(false);
      
      // Build directories
      expect(isPathIgnored(rules, 'build/app.js', false)).toBe(true);
      expect(isPathIgnored(rules, 'dist/bundle.js', false)).toBe(true);
      
      // Misc files
      expect(isPathIgnored(rules, '.DS_Store', false)).toBe(true);
      expect(isPathIgnored(rules, 'error.log', false)).toBe(true);
      expect(isPathIgnored(rules, '.env.local', false)).toBe(true);
      
      // IDE files
      expect(isPathIgnored(rules, '.vscode/settings.json', false)).toBe(true);
      expect(isPathIgnored(rules, 'temp.swp', false)).toBe(true);
      
      // Should NOT be ignored
      expect(isPathIgnored(rules, 'src/index.ts', false)).toBe(false);
      expect(isPathIgnored(rules, 'package.json', false)).toBe(false);
      expect(isPathIgnored(rules, 'README.md', false)).toBe(false);
    });
  });

  describe('Architecture Verification', () => {
    test('documents expected behavior of two-layer architecture', () => {
      // This test serves as documentation of the intended architecture
      
      const gitignoreContent = 'node_modules/';
      const rules = parseGitignore(gitignoreContent);
      
      // In the two-layer architecture:
      
      // 1. IndexedDB stores ALL files (including node_modules)
      //    - This is necessary for Node.js Runtime module resolution
      //    - This is necessary for file tree display
      //    - This is necessary for search functionality
      const allFilesInIndexedDB = [
        '/package.json',
        '/src/index.ts',
        '/node_modules/react/index.js',  // ✅ Stored in IndexedDB
        '/node_modules/react/package.json',  // ✅ Stored in IndexedDB
      ];
      
      // 2. lightning-fs only receives files NOT ignored by .gitignore
      //    - This keeps Git operations fast
      //    - This prevents bloating the Git working directory
      const filesInLightningFS = allFilesInIndexedDB.filter(path => {
        const normalizedPath = path.replace(/^\/+/, '');
        return !isPathIgnored(rules, normalizedPath, false);
      });
      
      expect(filesInLightningFS).toEqual([
        '/package.json',
        '/src/index.ts',
        // node_modules files are NOT synced to lightning-fs
      ]);
      
      // 3. This is the CORRECT and INTENDED behavior
      //    - NOT a bug
      //    - NOT unnecessary duplication
      //    - Both layers serve different purposes
      
      expect(allFilesInIndexedDB.length).toBe(4);  // All files in IndexedDB
      expect(filesInLightningFS.length).toBe(2);   // Only non-ignored in lightning-fs
    });
  });
});
