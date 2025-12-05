/**
 * Comprehensive tests for the multi-patch AI editing system
 *
 * Tests cover:
 * - Single SEARCH/REPLACE block application
 * - Multiple SEARCH/REPLACE blocks in one file
 * - Fuzzy matching for whitespace differences
 * - New file creation
 * - Edge cases and error handling
 * - Legacy format compatibility
 */

import {
  applySearchReplaceBlock,
  applyMultipleBlocks,
  applyPatchBlock,
  applyMultiplePatches,
  parseSearchReplaceBlocks,
  validateSearchExists,
  formatPatchBlock,
  createSimplePatch,
  createNewFilePatch,
  type SearchReplaceBlock,
  type PatchBlock,
} from '@/engine/ai/patchApplier';

describe('applySearchReplaceBlock', () => {
  describe('exact matching', () => {
    it('should apply a simple single-line replacement', () => {
      const content = 'const x = 1;\nconst y = 2;\nconst z = 3;';
      const block: SearchReplaceBlock = {
        search: 'const y = 2;',
        replace: 'const y = 42;',
      };

      const result = applySearchReplaceBlock(content, block);

      expect(result.success).toBe(true);
      expect(result.content).toBe('const x = 1;\nconst y = 42;\nconst z = 3;');
    });

    it('should apply a multi-line replacement', () => {
      const content = `function greet(name) {
  console.log("Hello, " + name);
}

function farewell() {
  console.log("Goodbye");
}`;

      const block: SearchReplaceBlock = {
        search: `function greet(name) {
  console.log("Hello, " + name);
}`,
        replace: `function greet(name, greeting = "Hello") {
  console.log(greeting + ", " + name);
}`,
      };

      const result = applySearchReplaceBlock(content, block);

      expect(result.success).toBe(true);
      expect(result.content).toContain('greeting = "Hello"');
      expect(result.content).toContain('function farewell()');
    });

    it('should handle deletion (empty replace)', () => {
      const content = 'line1\nline2\nline3\nline4';
      const block: SearchReplaceBlock = {
        search: 'line2\n',
        replace: '',
      };

      const result = applySearchReplaceBlock(content, block);

      expect(result.success).toBe(true);
      expect(result.content).toBe('line1\nline3\nline4');
    });

    it('should handle insertion (adding new content)', () => {
      const content = 'import React from "react";\n\nfunction App() {}';
      const block: SearchReplaceBlock = {
        search: 'import React from "react";',
        replace: 'import React from "react";\nimport { useState } from "react";',
      };

      const result = applySearchReplaceBlock(content, block);

      expect(result.success).toBe(true);
      expect(result.content).toContain('useState');
    });
  });

  describe('fuzzy matching', () => {
    it('should match despite trailing whitespace differences', () => {
      const content = 'const x = 1;   \nconst y = 2;';
      const block: SearchReplaceBlock = {
        search: 'const x = 1;',
        replace: 'const x = 100;',
      };

      const result = applySearchReplaceBlock(content, block);

      expect(result.success).toBe(true);
      expect(result.content).toContain('const x = 100;');
    });

    it('should handle CRLF vs LF line endings', () => {
      const content = 'line1\r\nline2\r\nline3';
      const block: SearchReplaceBlock = {
        search: 'line2',
        replace: 'modified line2',
      };

      const result = applySearchReplaceBlock(content, block);

      expect(result.success).toBe(true);
      expect(result.content).toContain('modified line2');
    });
  });

  describe('error handling', () => {
    it('should fail when search text not found', () => {
      const content = 'const x = 1;';
      const block: SearchReplaceBlock = {
        search: 'const y = 2;',
        replace: 'const y = 42;',
      };

      const result = applySearchReplaceBlock(content, block);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should fail for empty search without line hint', () => {
      const content = 'some content';
      const block: SearchReplaceBlock = {
        search: '',
        replace: 'new content',
      };

      const result = applySearchReplaceBlock(content, block);

      expect(result.success).toBe(false);
    });

    it('should succeed for empty search with line number hint', () => {
      const content = 'line1\nline2\nline3';
      const block: SearchReplaceBlock = {
        search: '',
        replace: 'inserted',
        lineNumber: 2,
      };

      const result = applySearchReplaceBlock(content, block);

      expect(result.success).toBe(true);
      expect(result.content).toContain('inserted');
    });
  });
});

describe('applyMultipleBlocks', () => {
  it('should apply multiple non-overlapping blocks', () => {
    const content = `const a = 1;
const b = 2;
const c = 3;
const d = 4;`;

    const blocks: SearchReplaceBlock[] = [
      { search: 'const a = 1;', replace: 'const a = 10;' },
      { search: 'const c = 3;', replace: 'const c = 30;' },
    ];

    const result = applyMultipleBlocks(content, blocks);

    expect(result.success).toBe(true);
    expect(result.appliedCount).toBe(2);
    expect(result.content).toContain('const a = 10;');
    expect(result.content).toContain('const b = 2;');
    expect(result.content).toContain('const c = 30;');
    expect(result.content).toContain('const d = 4;');
  });

  it('should apply blocks in sequence', () => {
    const content = 'x = 1';
    const blocks: SearchReplaceBlock[] = [
      { search: 'x = 1', replace: 'x = 2' },
      { search: 'x = 2', replace: 'x = 3' },
    ];

    const result = applyMultipleBlocks(content, blocks);

    expect(result.success).toBe(true);
    expect(result.content).toBe('x = 3');
  });

  it('should track failed blocks', () => {
    const content = 'const x = 1;';
    const blocks: SearchReplaceBlock[] = [
      { search: 'const x = 1;', replace: 'const x = 2;' },
      { search: 'nonexistent', replace: 'something' },
    ];

    const result = applyMultipleBlocks(content, blocks);

    expect(result.success).toBe(false);
    expect(result.appliedCount).toBe(1);
    expect(result.failedBlocks.length).toBe(1);
    expect(result.errors.length).toBe(1);
  });

  it('should handle complex multi-function changes', () => {
    const content = `function add(a, b) {
  return a + b;
}

function subtract(a, b) {
  return a - b;
}

function multiply(a, b) {
  return a * b;
}`;

    const blocks: SearchReplaceBlock[] = [
      {
        search: `function add(a, b) {
  return a + b;
}`,
        replace: `function add(a: number, b: number): number {
  return a + b;
}`,
      },
      {
        search: `function multiply(a, b) {
  return a * b;
}`,
        replace: `function multiply(a: number, b: number): number {
  return a * b;
}`,
      },
    ];

    const result = applyMultipleBlocks(content, blocks);

    expect(result.success).toBe(true);
    expect(result.appliedCount).toBe(2);
    expect(result.content).toContain('a: number');
    expect(result.content).toContain('function subtract(a, b)'); // unchanged
  });
});

describe('applyPatchBlock', () => {
  it('should apply patch to existing file', () => {
    const originalContent = 'const x = 1;';
    const patch: PatchBlock = {
      filePath: 'test.ts',
      blocks: [{ search: 'const x = 1;', replace: 'const x = 2;' }],
    };

    const result = applyPatchBlock(originalContent, patch);

    expect(result.success).toBe(true);
    expect(result.patchedContent).toBe('const x = 2;');
    expect(result.originalContent).toBe(originalContent);
  });

  it('should handle new file creation', () => {
    const patch: PatchBlock = {
      filePath: 'new-file.ts',
      blocks: [],
      fullContent: 'export const newConstant = 42;',
      isNewFile: true,
    };

    const result = applyPatchBlock('', patch);

    expect(result.success).toBe(true);
    expect(result.isNewFile).toBe(true);
    expect(result.patchedContent).toBe('export const newConstant = 42;');
  });

  it('should handle full file replacement (legacy)', () => {
    const originalContent = 'old content';
    const patch: PatchBlock = {
      filePath: 'file.ts',
      blocks: [],
      fullContent: 'completely new content',
    };

    const result = applyPatchBlock(originalContent, patch);

    expect(result.success).toBe(true);
    expect(result.patchedContent).toBe('completely new content');
  });
});

describe('applyMultiplePatches', () => {
  it('should apply patches to multiple files', () => {
    const patches: PatchBlock[] = [
      {
        filePath: 'file1.ts',
        blocks: [{ search: 'old1', replace: 'new1' }],
      },
      {
        filePath: 'file2.ts',
        blocks: [{ search: 'old2', replace: 'new2' }],
      },
    ];

    const fileContents = new Map([
      ['file1.ts', 'content with old1 here'],
      ['file2.ts', 'content with old2 here'],
    ]);

    const result = applyMultiplePatches(patches, fileContents);

    expect(result.overallSuccess).toBe(true);
    expect(result.totalSuccess).toBe(2);
    expect(result.results[0].patchedContent).toContain('new1');
    expect(result.results[1].patchedContent).toContain('new2');
  });

  it('should handle partial failures gracefully', () => {
    const patches: PatchBlock[] = [
      {
        filePath: 'file1.ts',
        blocks: [{ search: 'exists', replace: 'modified' }],
      },
      {
        filePath: 'file2.ts',
        blocks: [{ search: 'nonexistent', replace: 'something' }],
      },
    ];

    const fileContents = new Map([
      ['file1.ts', 'this exists'],
      ['file2.ts', 'different content'],
    ]);

    const result = applyMultiplePatches(patches, fileContents);

    expect(result.overallSuccess).toBe(false);
    expect(result.totalSuccess).toBe(1);
    expect(result.totalFailed).toBe(1);
  });
});

describe('parseSearchReplaceBlocks', () => {
  it('should parse single block', () => {
    const text = `Some explanation

\`\`\`
<<<<<<< SEARCH
old code
=======
new code
>>>>>>> REPLACE
\`\`\``;

    const blocks = parseSearchReplaceBlocks(text);

    expect(blocks.length).toBe(1);
    expect(blocks[0].search).toBe('old code');
    expect(blocks[0].replace).toBe('new code');
  });

  it('should parse multiple blocks', () => {
    const text = `<<<<<<< SEARCH
block1 old
=======
block1 new
>>>>>>> REPLACE

<<<<<<< SEARCH
block2 old
=======
block2 new
>>>>>>> REPLACE`;

    const blocks = parseSearchReplaceBlocks(text);

    expect(blocks.length).toBe(2);
    expect(blocks[0].search).toBe('block1 old');
    expect(blocks[1].search).toBe('block2 old');
  });

  it('should handle multi-line content in blocks', () => {
    const text = `<<<<<<< SEARCH
function old() {
  return 1;
}
=======
function new() {
  return 2;
}
>>>>>>> REPLACE`;

    const blocks = parseSearchReplaceBlocks(text);

    expect(blocks.length).toBe(1);
    expect(blocks[0].search).toContain('function old()');
    expect(blocks[0].replace).toContain('function new()');
  });
});

describe('validateSearchExists', () => {
  it('should return true for exact match', () => {
    const content = 'const x = 1;\nconst y = 2;';
    expect(validateSearchExists(content, 'const x = 1;')).toBe(true);
  });

  it('should return true for fuzzy match', () => {
    const content = 'const x = 1;   \n  const y = 2;';
    expect(validateSearchExists(content, 'const x = 1;')).toBe(true);
  });

  it('should return false for non-existent text', () => {
    const content = 'const x = 1;';
    expect(validateSearchExists(content, 'const z = 3;')).toBe(false);
  });
});

describe('utility functions', () => {
  describe('formatPatchBlock', () => {
    it('should format a patch block correctly', () => {
      const block: SearchReplaceBlock = {
        search: 'old',
        replace: 'new',
      };

      const formatted = formatPatchBlock(block);

      expect(formatted).toContain('<<<<<<< SEARCH');
      expect(formatted).toContain('old');
      expect(formatted).toContain('=======');
      expect(formatted).toContain('new');
      expect(formatted).toContain('>>>>>>> REPLACE');
    });
  });

  describe('createSimplePatch', () => {
    it('should create a simple patch block', () => {
      const patch = createSimplePatch('file.ts', 'old', 'new', 'Test change');

      expect(patch.filePath).toBe('file.ts');
      expect(patch.blocks.length).toBe(1);
      expect(patch.blocks[0].search).toBe('old');
      expect(patch.blocks[0].replace).toBe('new');
      expect(patch.explanation).toBe('Test change');
    });
  });

  describe('createNewFilePatch', () => {
    it('should create a new file patch', () => {
      const patch = createNewFilePatch('new.ts', 'content', 'New file');

      expect(patch.filePath).toBe('new.ts');
      expect(patch.isNewFile).toBe(true);
      expect(patch.fullContent).toBe('content');
      expect(patch.explanation).toBe('New file');
    });
  });
});

describe('real-world scenarios', () => {
  it('should handle React component modification', () => {
    const content = `import React from 'react';

interface Props {
  name: string;
}

export function Greeting({ name }: Props) {
  return <div>Hello, {name}!</div>;
}`;

    const blocks: SearchReplaceBlock[] = [
      {
        search: `interface Props {
  name: string;
}`,
        replace: `interface Props {
  name: string;
  greeting?: string;
}`,
      },
      {
        search: `export function Greeting({ name }: Props) {
  return <div>Hello, {name}!</div>;
}`,
        replace: `export function Greeting({ name, greeting = 'Hello' }: Props) {
  return <div>{greeting}, {name}!</div>;
}`,
      },
    ];

    const result = applyMultipleBlocks(content, blocks);

    expect(result.success).toBe(true);
    expect(result.content).toContain('greeting?: string');
    expect(result.content).toContain("greeting = 'Hello'");
  });

  it('should handle adding imports', () => {
    const content = `import React from 'react';

function App() {
  return <div>App</div>;
}`;

    const blocks: SearchReplaceBlock[] = [
      {
        search: `import React from 'react';`,
        replace: `import React, { useState, useEffect } from 'react';`,
      },
    ];

    const result = applyMultipleBlocks(content, blocks);

    expect(result.success).toBe(true);
    expect(result.content).toContain('useState');
    expect(result.content).toContain('useEffect');
  });

  it('should handle TypeScript type annotations', () => {
    const content = `function calculate(a, b) {
  return a + b;
}`;

    const blocks: SearchReplaceBlock[] = [
      {
        search: `function calculate(a, b) {
  return a + b;
}`,
        replace: `function calculate(a: number, b: number): number {
  return a + b;
}`,
      },
    ];

    const result = applyMultipleBlocks(content, blocks);

    expect(result.success).toBe(true);
    expect(result.content).toContain('a: number');
    expect(result.content).toContain('b: number');
    expect(result.content).toContain('): number');
  });

  it('should handle JSON configuration changes', () => {
    const content = `{
  "name": "my-app",
  "version": "1.0.0",
  "scripts": {
    "start": "node index.js"
  }
}`;

    const blocks: SearchReplaceBlock[] = [
      {
        search: `"version": "1.0.0",`,
        replace: `"version": "1.1.0",`,
      },
      {
        search: `"scripts": {
    "start": "node index.js"
  }`,
        replace: `"scripts": {
    "start": "node index.js",
    "test": "jest"
  }`,
      },
    ];

    const result = applyMultipleBlocks(content, blocks);

    expect(result.success).toBe(true);
    expect(result.content).toContain('"version": "1.1.0"');
    expect(result.content).toContain('"test": "jest"');
  });

  it('should handle CSS modifications', () => {
    const content = `.container {
  display: flex;
  padding: 10px;
}

.button {
  background: blue;
  color: white;
}`;

    const blocks: SearchReplaceBlock[] = [
      {
        search: `.container {
  display: flex;
  padding: 10px;
}`,
        replace: `.container {
  display: flex;
  flex-direction: column;
  padding: 20px;
  gap: 10px;
}`,
      },
    ];

    const result = applyMultipleBlocks(content, blocks);

    expect(result.success).toBe(true);
    expect(result.content).toContain('flex-direction: column');
    expect(result.content).toContain('gap: 10px');
    expect(result.content).toContain('.button'); // unchanged
  });
});

describe('edge cases', () => {
  it('should handle empty file', () => {
    const content = '';
    const patch: PatchBlock = {
      filePath: 'empty.ts',
      blocks: [],
      fullContent: 'new content',
    };

    const result = applyPatchBlock(content, patch);

    expect(result.success).toBe(true);
    expect(result.patchedContent).toBe('new content');
  });

  it('should handle file with only whitespace', () => {
    const content = '   \n\n   \n';
    const patch: PatchBlock = {
      filePath: 'whitespace.ts',
      blocks: [],
      fullContent: 'actual content',
    };

    const result = applyPatchBlock(content, patch);

    expect(result.success).toBe(true);
    expect(result.patchedContent).toBe('actual content');
  });

  it('should handle unicode content', () => {
    const content = '// 日本語コメント\nconst greeting = "こんにちは";';
    const block: SearchReplaceBlock = {
      search: 'const greeting = "こんにちは";',
      replace: 'const greeting = "Hello";',
    };

    const result = applySearchReplaceBlock(content, block);

    expect(result.success).toBe(true);
    expect(result.content).toContain('日本語コメント');
    expect(result.content).toContain('"Hello"');
  });

  it('should handle special regex characters in search', () => {
    const content = 'const regex = /test\\.value\\[0\\]/;';
    const block: SearchReplaceBlock = {
      search: 'const regex = /test\\.value\\[0\\]/;',
      replace: 'const regex = /test\\.value\\[\\d+\\]/;',
    };

    const result = applySearchReplaceBlock(content, block);

    expect(result.success).toBe(true);
    expect(result.content).toContain('\\d+');
  });

  it('should handle very long lines', () => {
    const longString = 'a'.repeat(10000);
    const content = `const x = "${longString}";`;
    const block: SearchReplaceBlock = {
      search: `const x = "${longString}";`,
      replace: `const x = "short";`,
    };

    const result = applySearchReplaceBlock(content, block);

    expect(result.success).toBe(true);
    expect(result.content).toBe('const x = "short";');
  });

  it('should handle repeated identical blocks', () => {
    const content = 'x = 1;\nx = 1;\nx = 1;';
    const blocks: SearchReplaceBlock[] = [
      { search: 'x = 1;', replace: 'x = 2;' },
    ];

    const result = applyMultipleBlocks(content, blocks);

    expect(result.success).toBe(true);
    // Should only replace the first occurrence
    expect(result.content).toBe('x = 2;\nx = 1;\nx = 1;');
  });

  it('should handle template literals', () => {
    const content = 'const msg = `Hello ${name}!`;';
    const block: SearchReplaceBlock = {
      search: 'const msg = `Hello ${name}!`;',
      replace: 'const msg = `Hi ${name}, welcome!`;',
    };

    const result = applySearchReplaceBlock(content, block);

    expect(result.success).toBe(true);
    expect(result.content).toContain('Hi ${name}');
  });
});
