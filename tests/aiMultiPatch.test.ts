/**
 * Tests for AI Response Parser with Multi-Patch Support
 *
 * Tests both the new SEARCH/REPLACE format and legacy format compatibility.
 */

import {
  parseEditResponse,
  extractFilePathsFromResponse,
  extractFileBlocks,
  extractReasons,
  cleanupMessage,
  validateResponse,
  normalizePath,
} from '@/engine/ai/responseParser';

describe('normalizePath', () => {
  it('should remove leading and trailing slashes', () => {
    expect(normalizePath('/src/test.ts')).toBe('src/test.ts');
    expect(normalizePath('src/test.ts/')).toBe('src/test.ts');
    expect(normalizePath('/src/test.ts/')).toBe('src/test.ts');
  });

  it('should convert to lowercase', () => {
    expect(normalizePath('Src/Test.TS')).toBe('src/test.ts');
  });
});

describe('extractFilePathsFromResponse', () => {
  it('should extract single file path from patch format', () => {
    const response = `### File: src/test.ts
**Reason**: Test change

\`\`\`
<<<<<<< SEARCH
old
=======
new
>>>>>>> REPLACE
\`\`\``;
    expect(extractFilePathsFromResponse(response)).toContain('src/test.ts');
  });

  it('should extract multiple file paths from patch format', () => {
    const response = `### File: src/a.ts
**Reason**: Change A

<<<<<<< SEARCH
old a
=======
new a
>>>>>>> REPLACE

### File: src/b.ts
**Reason**: Change B

<<<<<<< SEARCH
old b
=======
new b
>>>>>>> REPLACE`;
    const paths = extractFilePathsFromResponse(response);
    expect(paths).toContain('src/a.ts');
    expect(paths).toContain('src/b.ts');
  });

  it('should extract single file path from legacy format', () => {
    const response = `<AI_EDIT_CONTENT_START:src/test.ts>
content
<AI_EDIT_CONTENT_END:src/test.ts>`;
    expect(extractFilePathsFromResponse(response)).toContain('src/test.ts');
  });

  it('should extract multiple file paths from legacy format', () => {
    const response = `<AI_EDIT_CONTENT_START:src/a.ts>
content
<AI_EDIT_CONTENT_END:src/a.ts>
<AI_EDIT_CONTENT_START:src/b.ts>
content
<AI_EDIT_CONTENT_END:src/b.ts>`;
    const paths = extractFilePathsFromResponse(response);
    expect(paths).toContain('src/a.ts');
    expect(paths).toContain('src/b.ts');
  });

  it('should handle duplicate paths', () => {
    const response = `### File: src/test.ts
<<<<<<< SEARCH
a
=======
b
>>>>>>> REPLACE

### File: src/test.ts
<<<<<<< SEARCH
c
=======
d
>>>>>>> REPLACE`;
    const paths = extractFilePathsFromResponse(response);
    expect(paths.filter(p => p === 'src/test.ts').length).toBe(1);
  });

  it('should handle empty response', () => {
    expect(extractFilePathsFromResponse('')).toEqual([]);
  });
});

describe('extractFileBlocks (legacy)', () => {
  it('should extract complete block', () => {
    const response = `<AI_EDIT_CONTENT_START:src/test.ts>
const x = 1;
<AI_EDIT_CONTENT_END:src/test.ts>`;
    const blocks = extractFileBlocks(response);
    expect(blocks.length).toBe(1);
    expect(blocks[0].path).toBe('src/test.ts');
    expect(blocks[0].content).toBe('const x = 1;');
  });

  it('should handle multiple blocks', () => {
    const response = `<AI_EDIT_CONTENT_START:src/a.ts>
content a
<AI_EDIT_CONTENT_END:src/a.ts>
<AI_EDIT_CONTENT_START:src/b.ts>
content b
<AI_EDIT_CONTENT_END:src/b.ts>`;
    const blocks = extractFileBlocks(response);
    expect(blocks.length).toBe(2);
    expect(blocks[0].content).toBe('content a');
    expect(blocks[1].content).toBe('content b');
  });

  it('should handle multiline content', () => {
    const response = `<AI_EDIT_CONTENT_START:src/test.ts>
function test() {
  return 42;
}
<AI_EDIT_CONTENT_END:src/test.ts>`;
    const blocks = extractFileBlocks(response);
    expect(blocks[0].content).toContain('function test()');
    expect(blocks[0].content).toContain('return 42;');
  });

  it('should handle empty content', () => {
    const response = `<AI_EDIT_CONTENT_START:src/test.ts>

<AI_EDIT_CONTENT_END:src/test.ts>`;
    const blocks = extractFileBlocks(response);
    expect(blocks.length).toBe(1);
    expect(blocks[0].content).toBe('');
  });
});

describe('extractReasons', () => {
  it('should extract reason from patch format', () => {
    const response = `### File: src/test.ts
**Reason**: Test change

<<<<<<< SEARCH`;
    const reasons = extractReasons(response);
    expect(reasons.get('src/test.ts')).toBe('Test change');
  });

  it('should extract reason from legacy format', () => {
    const response = `## Changed File: src/test.ts

**Reason**: Legacy test change

<AI_EDIT_CONTENT_START:src/test.ts>`;
    const reasons = extractReasons(response);
    expect(reasons.get('src/test.ts')).toBe('Legacy test change');
  });

  it('should extract multiple reasons', () => {
    const response = `### File: src/a.ts
**Reason**: Feature A

<<<<<<< SEARCH
### File: src/b.ts
**Reason**: Feature B

<<<<<<< SEARCH`;
    const reasons = extractReasons(response);
    expect(reasons.get('src/a.ts')).toBe('Feature A');
    expect(reasons.get('src/b.ts')).toBe('Feature B');
  });

  it('should handle Japanese format', () => {
    const response = `## 変更ファイル: src/test.ts

**変更理由**: テスト変更

<AI_EDIT_CONTENT_START:src/test.ts>`;
    const reasons = extractReasons(response);
    expect(reasons.get('src/test.ts')).toBe('テスト変更');
  });
});

describe('cleanupMessage', () => {
  it('should remove SEARCH/REPLACE blocks', () => {
    const response = `Message
<<<<<<< SEARCH
old
=======
new
>>>>>>> REPLACE
More message`;
    expect(cleanupMessage(response)).toBe('Message\n\nMore message');
  });

  it('should remove NEW_FILE blocks', () => {
    const response = `Message
<<<<<<< NEW_FILE
content
>>>>>>> NEW_FILE
More`;
    expect(cleanupMessage(response)).toBe('Message\n\nMore');
  });

  it('should remove legacy file blocks', () => {
    const response = `Message
<AI_EDIT_CONTENT_START:src/test.ts>
content
<AI_EDIT_CONTENT_END:src/test.ts>
Continue`;
    expect(cleanupMessage(response)).toBe('Message\n\nContinue');
  });

  it('should remove file headers', () => {
    const response = `### File: src/test.ts
**Reason**: Test
Message`;
    expect(cleanupMessage(response)).toBe('Message');
  });

  it('should normalize multiple newlines', () => {
    const response = `Message



Continue`;
    expect(cleanupMessage(response)).toBe('Message\n\nContinue');
  });
});

describe('parseEditResponse with patch format', () => {
  it('should parse single file with single patch block', () => {
    const response = `### File: src/test.ts
**Reason**: Added feature

\`\`\`
<<<<<<< SEARCH
const x = 1;
=======
const x = 2;
>>>>>>> REPLACE
\`\`\``;

    const originalFiles = [{ path: 'src/test.ts', content: 'const x = 1;\nconst y = 2;' }];
    const result = parseEditResponse(response, originalFiles);

    expect(result.usedPatchFormat).toBe(true);
    expect(result.changedFiles.length).toBe(1);
    expect(result.changedFiles[0].path).toBe('src/test.ts');
    expect(result.changedFiles[0].suggestedContent).toContain('const x = 2;');
    expect(result.changedFiles[0].explanation).toBe('Added feature');
  });

  it('should parse single file with multiple patch blocks', () => {
    const response = `### File: src/test.ts
**Reason**: Multiple changes

<<<<<<< SEARCH
const a = 1;
=======
const a = 10;
>>>>>>> REPLACE

<<<<<<< SEARCH
const b = 2;
=======
const b = 20;
>>>>>>> REPLACE`;

    const originalFiles = [{ path: 'src/test.ts', content: 'const a = 1;\nconst b = 2;\nconst c = 3;' }];
    const result = parseEditResponse(response, originalFiles);

    expect(result.usedPatchFormat).toBe(true);
    expect(result.changedFiles.length).toBe(1);
    expect(result.changedFiles[0].patchBlocks?.length).toBe(2);
    expect(result.changedFiles[0].suggestedContent).toContain('const a = 10;');
    expect(result.changedFiles[0].suggestedContent).toContain('const b = 20;');
    expect(result.changedFiles[0].suggestedContent).toContain('const c = 3;'); // unchanged
  });

  it('should parse multiple files with patches', () => {
    const response = `### File: src/a.ts
**Reason**: Change A

<<<<<<< SEARCH
export const a = 1;
=======
export const a = 10;
>>>>>>> REPLACE

### File: src/b.ts
**Reason**: Change B

<<<<<<< SEARCH
export const b = 2;
=======
export const b = 20;
>>>>>>> REPLACE`;

    const originalFiles = [
      { path: 'src/a.ts', content: 'export const a = 1;' },
      { path: 'src/b.ts', content: 'export const b = 2;' },
    ];
    const result = parseEditResponse(response, originalFiles);

    expect(result.usedPatchFormat).toBe(true);
    expect(result.changedFiles.length).toBe(2);
    expect(result.changedFiles[0].path).toBe('src/a.ts');
    expect(result.changedFiles[1].path).toBe('src/b.ts');
    expect(result.changedFiles[0].suggestedContent).toContain('a = 10');
    expect(result.changedFiles[1].suggestedContent).toContain('b = 20');
  });

  it('should handle new file creation with patch format', () => {
    const response = `### File: src/new.ts
**Reason**: New file

<<<<<<< NEW_FILE
export const newConst = 42;
>>>>>>> NEW_FILE`;

    const originalFiles: Array<{ path: string; content: string }> = [];
    const result = parseEditResponse(response, originalFiles);

    expect(result.usedPatchFormat).toBe(true);
    expect(result.changedFiles.length).toBe(1);
    expect(result.changedFiles[0].isNewFile).toBe(true);
    expect(result.changedFiles[0].suggestedContent).toBe('export const newConst = 42;');
  });
});

describe('parseEditResponse with legacy format', () => {
  it('should parse single file edit', () => {
    const response = `## Changed File: src/test.ts

**Reason**: Test added

<AI_EDIT_CONTENT_START:src/test.ts>
const x = 1;
<AI_EDIT_CONTENT_END:src/test.ts>`;

    const originalFiles = [{ path: 'src/test.ts', content: 'const x = 0;' }];
    const result = parseEditResponse(response, originalFiles);

    expect(result.usedPatchFormat).toBe(false);
    expect(result.changedFiles.length).toBe(1);
    expect(result.changedFiles[0].path).toBe('src/test.ts');
    expect(result.changedFiles[0].suggestedContent).toBe('const x = 1;');
    expect(result.changedFiles[0].explanation).toBe('Test added');
  });

  it('should parse multiple file edits', () => {
    const response = `## Changed File: src/a.ts

**Reason**: Feature A

<AI_EDIT_CONTENT_START:src/a.ts>
content a
<AI_EDIT_CONTENT_END:src/a.ts>

## Changed File: src/b.ts

**Reason**: Feature B

<AI_EDIT_CONTENT_START:src/b.ts>
content b
<AI_EDIT_CONTENT_END:src/b.ts>`;

    const originalFiles = [
      { path: 'src/a.ts', content: 'old a' },
      { path: 'src/b.ts', content: 'old b' },
    ];
    const result = parseEditResponse(response, originalFiles);

    expect(result.changedFiles.length).toBe(2);
    expect(result.changedFiles[0].path).toBe('src/a.ts');
    expect(result.changedFiles[1].path).toBe('src/b.ts');
  });

  it('should handle case-insensitive path matching', () => {
    const response = `<AI_EDIT_CONTENT_START:SRC/TEST.TS>
content
<AI_EDIT_CONTENT_END:SRC/TEST.TS>`;

    const originalFiles = [{ path: 'src/test.ts', content: 'old' }];
    const result = parseEditResponse(response, originalFiles);

    expect(result.changedFiles.length).toBe(1);
    expect(result.changedFiles[0].path).toBe('src/test.ts');
  });

  it('should treat unknown files as new files', () => {
    const response = `<AI_EDIT_CONTENT_START:src/unknown.ts>
content
<AI_EDIT_CONTENT_END:src/unknown.ts>`;

    const originalFiles = [{ path: 'src/test.ts', content: 'old' }];
    const result = parseEditResponse(response, originalFiles);

    // Unknown files in legacy format are treated as new files
    expect(result.changedFiles.length).toBe(1);
    expect(result.changedFiles[0].isNewFile).toBe(true);
  });
});

describe('validateResponse', () => {
  it('should validate correct patch format response', () => {
    const response = `### File: src/test.ts
**Reason**: Test

<<<<<<< SEARCH
old
=======
new
>>>>>>> REPLACE`;
    const validation = validateResponse(response);

    expect(validation.isValid).toBe(true);
    expect(validation.errors.length).toBe(0);
  });

  it('should validate correct legacy format response', () => {
    const response = `<AI_EDIT_CONTENT_START:src/test.ts>
content
<AI_EDIT_CONTENT_END:src/test.ts>`;
    const validation = validateResponse(response);

    expect(validation.isValid).toBe(true);
    expect(validation.errors.length).toBe(0);
  });

  it('should detect empty response', () => {
    const validation = validateResponse('');

    expect(validation.isValid).toBe(false);
    expect(validation.errors).toContain('Empty response');
  });

  it('should detect mismatched SEARCH/REPLACE tags', () => {
    const response = `<<<<<<< SEARCH
old
=======
new`;
    const validation = validateResponse(response);

    expect(validation.isValid).toBe(false);
    expect(validation.errors[0]).toContain('Mismatched');
  });

  it('should detect mismatched legacy tags', () => {
    const response = `<AI_EDIT_CONTENT_START:src/test.ts>
content`;
    const validation = validateResponse(response);

    expect(validation.isValid).toBe(false);
    expect(validation.errors[0]).toContain('Mismatched tags');
  });

  it('should warn when no blocks found', () => {
    const response = 'Just a message with no file blocks';
    const validation = validateResponse(response);

    // Can be either "No patch blocks found" or "No file blocks found"
    expect(validation.warnings.some(w => w.includes('No') && w.includes('blocks found'))).toBe(true);
  });
});

describe('edge cases', () => {
  it('should handle very long file paths', () => {
    const longPath = 'src/' + 'a/'.repeat(50) + 'test.ts';
    const response = `### File: ${longPath}
**Reason**: Test

<<<<<<< SEARCH
old
=======
new
>>>>>>> REPLACE`;

    const originalFiles = [{ path: longPath, content: 'old content' }];
    const result = parseEditResponse(response, originalFiles);

    expect(result.changedFiles.length).toBe(1);
  });

  it('should handle special characters in paths', () => {
    const specialPath = 'src/test-file_v2.spec.ts';
    const response = `### File: ${specialPath}
**Reason**: Test

<<<<<<< SEARCH
old
=======
new
>>>>>>> REPLACE`;

    const originalFiles = [{ path: specialPath, content: 'old content' }];
    const result = parseEditResponse(response, originalFiles);

    expect(result.changedFiles.length).toBe(1);
  });

  it('should handle unicode in content', () => {
    const response = `### File: src/test.ts
**Reason**: Unicode test

<<<<<<< SEARCH
const emoji = '🎉';
=======
const emoji = '🚀🔥';
>>>>>>> REPLACE`;

    const originalFiles = [{ path: 'src/test.ts', content: "const emoji = '🎉';" }];
    const result = parseEditResponse(response, originalFiles);

    expect(result.changedFiles[0].suggestedContent).toContain('🚀');
  });

  it('should handle backticks in content', () => {
    const response = `### File: src/test.ts
**Reason**: Template literal

<<<<<<< SEARCH
const str = 'hello';
=======
const str = \`hello \${name}\`;
>>>>>>> REPLACE`;

    const originalFiles = [{ path: 'src/test.ts', content: "const str = 'hello';" }];
    const result = parseEditResponse(response, originalFiles);

    expect(result.changedFiles[0].suggestedContent).toContain('${name}');
  });
});

describe('mixed format handling', () => {
  it('should prefer patch format when both markers present', () => {
    const response = `### File: src/test.ts
**Reason**: Using patch

<<<<<<< SEARCH
const x = 1;
=======
const x = 2;
>>>>>>> REPLACE

<AI_EDIT_CONTENT_START:src/test.ts>
const x = 3;
<AI_EDIT_CONTENT_END:src/test.ts>`;

    const originalFiles = [{ path: 'src/test.ts', content: 'const x = 1;' }];
    const result = parseEditResponse(response, originalFiles);

    // Should use patch format
    expect(result.usedPatchFormat).toBe(true);
    expect(result.changedFiles[0].suggestedContent).toContain('const x = 2;');
  });
});
