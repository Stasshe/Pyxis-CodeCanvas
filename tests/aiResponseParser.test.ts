// AI応答パーサーのテスト

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
  it('should extract single file path', () => {
    const response = `<AI_EDIT_CONTENT_START:src/test.ts>
content
<AI_EDIT_CONTENT_END:src/test.ts>`;
    expect(extractFilePathsFromResponse(response)).toEqual(['src/test.ts']);
  });

  it('should extract multiple file paths', () => {
    const response = `<AI_EDIT_CONTENT_START:src/a.ts>
content
<AI_EDIT_CONTENT_END:src/a.ts>
<AI_EDIT_CONTENT_START:src/b.ts>
content
<AI_EDIT_CONTENT_END:src/b.ts>`;
    expect(extractFilePathsFromResponse(response)).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('should handle duplicate paths', () => {
    const response = `<AI_EDIT_CONTENT_START:src/test.ts>
content
<AI_EDIT_CONTENT_END:src/test.ts>
<AI_EDIT_CONTENT_START:src/test.ts>
content2
<AI_EDIT_CONTENT_END:src/test.ts>`;
    expect(extractFilePathsFromResponse(response)).toEqual(['src/test.ts']);
  });

  it('should handle empty response', () => {
    expect(extractFilePathsFromResponse('')).toEqual([]);
  });

  it('should handle malformed tags', () => {
    const response = `<AI_EDIT_CONTENT_START:src/test.ts>
content`;
    expect(extractFilePathsFromResponse(response)).toEqual(['src/test.ts']);
  });
});

describe('extractFileBlocks', () => {
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
  it('should extract reason with standard format', () => {
    const response = `## 変更ファイル: src/test.ts

**変更理由**: テスト追加

<AI_EDIT_CONTENT_START:src/test.ts>`;
    const reasons = extractReasons(response);
    expect(reasons.get('src/test.ts')).toBe('テスト追加');
  });

  it('should extract multiple reasons', () => {
    const response = `## 変更ファイル: src/a.ts

**変更理由**: 機能A追加

<AI_EDIT_CONTENT_START:src/a.ts>
## 変更ファイル: src/b.ts

**変更理由**: 機能B修正

<AI_EDIT_CONTENT_START:src/b.ts>`;
    const reasons = extractReasons(response);
    expect(reasons.get('src/a.ts')).toBe('機能A追加');
    expect(reasons.get('src/b.ts')).toBe('機能B修正');
  });

  it('should handle alternative format', () => {
    const response = `**ファイル名**: src/test.ts

**理由**: バグ修正`;
    const reasons = extractReasons(response);
    expect(reasons.get('src/test.ts')).toBe('バグ修正');
  });

  it('should handle bracket format', () => {
    const response = `- [src/test.ts] - 新機能追加`;
    const reasons = extractReasons(response);
    expect(reasons.get('src/test.ts')).toBe('新機能追加');
  });

  it('should prioritize first format', () => {
    const response = `## 変更ファイル: src/test.ts

**変更理由**: 理由1

**ファイル名**: src/test.ts

**理由**: 理由2`;
    const reasons = extractReasons(response);
    expect(reasons.get('src/test.ts')).toBe('理由1');
  });
});

describe('cleanupMessage', () => {
  it('should remove file blocks', () => {
    const response = `メッセージ
<AI_EDIT_CONTENT_START:src/test.ts>
content
<AI_EDIT_CONTENT_END:src/test.ts>
続き`;
    expect(cleanupMessage(response)).toBe('メッセージ\n\n続き');
  });

  it('should remove metadata lines', () => {
    const response = `## 変更ファイル: src/test.ts
**変更理由**: 理由
メッセージ`;
    expect(cleanupMessage(response)).toBe('メッセージ');
  });

  it('should normalize multiple newlines', () => {
    const response = `メッセージ



続き`;
    expect(cleanupMessage(response)).toBe('メッセージ\n\n続き');
  });
});

describe('parseEditResponse', () => {
  it('should parse single file edit', () => {
    const response = `## 変更ファイル: src/test.ts

**変更理由**: テスト追加

<AI_EDIT_CONTENT_START:src/test.ts>
const x = 1;
<AI_EDIT_CONTENT_END:src/test.ts>`;

    const originalFiles = [{ path: 'src/test.ts', content: 'const x = 0;' }];
    const result = parseEditResponse(response, originalFiles);

    expect(result.changedFiles.length).toBe(1);
    expect(result.changedFiles[0].path).toBe('src/test.ts');
    expect(result.changedFiles[0].suggestedContent).toBe('const x = 1;');
    expect(result.changedFiles[0].explanation).toBe('テスト追加');
  });

  it('should parse multiple file edits', () => {
    const response = `## 変更ファイル: src/a.ts

**変更理由**: 機能A

<AI_EDIT_CONTENT_START:src/a.ts>
content a
<AI_EDIT_CONTENT_END:src/a.ts>

## 変更ファイル: src/b.ts

**変更理由**: 機能B

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

    // Unknown files are treated as new files
    expect(result.changedFiles.length).toBe(1);
    expect(result.changedFiles[0].path).toBe('src/unknown.ts');
    expect(result.changedFiles[0].isNewFile).toBe(true);
  });

  it('should provide default message when files changed', () => {
    const response = `<AI_EDIT_CONTENT_START:src/test.ts>
content
<AI_EDIT_CONTENT_END:src/test.ts>`;

    const originalFiles = [{ path: 'src/test.ts', content: 'old' }];
    const result = parseEditResponse(response, originalFiles);

    expect(result.message).toBe('Suggested edits for 1 file(s).');
  });

  it('should preserve custom message', () => {
    const response = `カスタムメッセージ

<AI_EDIT_CONTENT_START:src/test.ts>
content
<AI_EDIT_CONTENT_END:src/test.ts>`;

    const originalFiles = [{ path: 'src/test.ts', content: 'old' }];
    const result = parseEditResponse(response, originalFiles);

    expect(result.message).toBe('カスタムメッセージ');
  });

  it('should handle parse failure with debug info', () => {
    const response = 'err';
    const originalFiles = [{ path: 'src/test.ts', content: 'old' }];
    const result = parseEditResponse(response, originalFiles);

    expect(result.changedFiles.length).toBe(0);
    expect(result.message).toContain('Failed to parse response');
    expect(result.message).toContain('SEARCH/REPLACE');
    expect(result.message).toContain('Raw response:');
  });

  it('should escape backticks in raw response', () => {
    const response = '```';
    const originalFiles = [{ path: 'src/test.ts', content: 'old' }];
    const result = parseEditResponse(response, originalFiles);

    expect(result.message).toContain('```' + '\u200B');
  });

  it('should handle files with leading/trailing slashes', () => {
    const response = `<AI_EDIT_CONTENT_START:/src/test.ts/>
content
<AI_EDIT_CONTENT_END:/src/test.ts/>`;

    const originalFiles = [{ path: 'src/test.ts', content: 'old' }];
    const result = parseEditResponse(response, originalFiles);

    expect(result.changedFiles.length).toBe(1);
    expect(result.changedFiles[0].path).toBe('src/test.ts');
  });

  it('should provide "No explanation" when reason not found', () => {
    const response = `<AI_EDIT_CONTENT_START:src/test.ts>
content
<AI_EDIT_CONTENT_END:src/test.ts>`;

    const originalFiles = [{ path: 'src/test.ts', content: 'old' }];
    const result = parseEditResponse(response, originalFiles);

    expect(result.changedFiles[0].explanation).toBe('No explanation provided');
  });
});

describe('validateResponse', () => {
  it('should validate correct response', () => {
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

  it('should detect mismatched tags', () => {
    const response = `<AI_EDIT_CONTENT_START:src/test.ts>
content`;
    const validation = validateResponse(response);

    expect(validation.isValid).toBe(false);
    expect(validation.errors[0]).toContain('Mismatched tags');
  });

  it('should warn when no file blocks found', () => {
    const response = 'Just a message with no file blocks';
    const validation = validateResponse(response);

    expect(validation.warnings).toContain('No file blocks found');
  });

  it('should detect malformed blocks', () => {
    const response = `<AI_EDIT_CONTENT_START:src/test.ts>
content
<AI_EDIT_CONTENT_START:src/other.ts>
<AI_EDIT_CONTENT_END:src/test.ts>`;
    const validation = validateResponse(response);

    expect(validation.warnings.length).toBeGreaterThan(0);
  });
});

describe('edge cases', () => {
  it('should handle very long file paths', () => {
    const longPath = 'src/' + 'a/'.repeat(50) + 'test.ts';
    const response = `<AI_EDIT_CONTENT_START:${longPath}>
content
<AI_EDIT_CONTENT_END:${longPath}>`;

    const originalFiles = [{ path: longPath, content: 'old' }];
    const result = parseEditResponse(response, originalFiles);

    expect(result.changedFiles.length).toBe(1);
  });

  it('should handle special characters in paths', () => {
    const specialPath = 'src/test-file_v2.spec.ts';
    const response = `<AI_EDIT_CONTENT_START:${specialPath}>
content
<AI_EDIT_CONTENT_END:${specialPath}>`;

    const originalFiles = [{ path: specialPath, content: 'old' }];
    const result = parseEditResponse(response, originalFiles);

    expect(result.changedFiles.length).toBe(1);
  });

  it('should handle very large content', () => {
    const largeContent = 'x'.repeat(100000);
    const response = `<AI_EDIT_CONTENT_START:src/test.ts>
${largeContent}
<AI_EDIT_CONTENT_END:src/test.ts>`;

    const originalFiles = [{ path: 'src/test.ts', content: 'old' }];
    const result = parseEditResponse(response, originalFiles);

    expect(result.changedFiles[0].suggestedContent.length).toBe(100000);
  });

  it('should handle unicode in content', () => {
    const response = `<AI_EDIT_CONTENT_START:src/test.ts>
const emoji = '🎉🚀🔥';
const japanese = '日本語テスト';
<AI_EDIT_CONTENT_END:src/test.ts>`;

    const originalFiles = [{ path: 'src/test.ts', content: 'old' }];
    const result = parseEditResponse(response, originalFiles);

    expect(result.changedFiles[0].suggestedContent).toContain('🎉');
    expect(result.changedFiles[0].suggestedContent).toContain('日本語');
  });

  it('should handle nested tags in content', () => {
    const response = `<AI_EDIT_CONTENT_START:src/test.ts>
// This is a comment with <AI_EDIT_CONTENT_START:fake> tags
const x = 1;
<AI_EDIT_CONTENT_END:src/test.ts>`;

    const originalFiles = [{ path: 'src/test.ts', content: 'old' }];
    const result = parseEditResponse(response, originalFiles);

    expect(result.changedFiles[0].suggestedContent).toContain('fake');
  });
});

describe('flexible format handling', () => {
  it('should handle English format', () => {
    const response = `## File: src/test.ts

Reason: Added new feature

<AI_EDIT_CONTENT_START:src/test.ts>
const x = 1;
<AI_EDIT_CONTENT_END:src/test.ts>`;

    const originalFiles = [{ path: 'src/test.ts', content: 'old' }];
    const result = parseEditResponse(response, originalFiles);

    expect(result.changedFiles.length).toBe(1);
    expect(result.changedFiles[0].explanation).toBe('Added new feature');
  });

  it('should handle mismatched END tag paths', () => {
    const response = `<AI_EDIT_CONTENT_START:src/test.ts>
const x = 1;
<AI_EDIT_CONTENT_END:SRC/TEST.TS>`;

    const originalFiles = [{ path: 'src/test.ts', content: 'old' }];
    const result = parseEditResponse(response, originalFiles);

    expect(result.changedFiles.length).toBe(1);
    expect(result.changedFiles[0].suggestedContent).toContain('const x = 1;');
  });

  it('should handle missing END tag', () => {
    const response = `<AI_EDIT_CONTENT_START:src/test.ts>
const x = 1;
const y = 2;`;

    const originalFiles = [{ path: 'src/test.ts', content: 'old' }];
    const result = parseEditResponse(response, originalFiles);

    expect(result.changedFiles.length).toBe(1);
    expect(result.changedFiles[0].suggestedContent).toContain('const x = 1;');
  });

  it('should handle alternative reason format', () => {
    const response = `Modified: src/test.ts - Bug fix

<AI_EDIT_CONTENT_START:src/test.ts>
const x = 1;
<AI_EDIT_CONTENT_END:src/test.ts>`;

    const originalFiles = [{ path: 'src/test.ts', content: 'old' }];
    const result = parseEditResponse(response, originalFiles);

    expect(result.changedFiles.length).toBe(1);
    expect(result.changedFiles[0].explanation).toBe('Bug fix');
  });

  it('should handle multiple files with mixed formats', () => {
    const response = `## 変更ファイル: src/a.ts

**変更理由**: 機能A

<AI_EDIT_CONTENT_START:src/a.ts>
content a
<AI_EDIT_CONTENT_END:src/a.ts>

## File: src/b.ts

Reason: Feature B

<AI_EDIT_CONTENT_START:src/b.ts>
content b
<AI_EDIT_CONTENT_END:src/b.ts>

Change: src/c.ts - Feature C

<AI_EDIT_CONTENT_START:src/c.ts>
content c
<AI_EDIT_CONTENT_END:src/c.ts>`;

    const originalFiles = [
      { path: 'src/a.ts', content: 'old a' },
      { path: 'src/b.ts', content: 'old b' },
      { path: 'src/c.ts', content: 'old c' },
    ];
    const result = parseEditResponse(response, originalFiles);

    expect(result.changedFiles.length).toBe(3);
    expect(result.changedFiles[0].explanation).toBe('機能A');
    expect(result.changedFiles[1].explanation).toBe('Feature B');
    expect(result.changedFiles[2].explanation).toBe('Feature C');
  });

  it('should handle extra whitespace', () => {
    const response = `##   変更ファイル:   src/test.ts  

**変更理由**:   テスト追加  

<AI_EDIT_CONTENT_START:src/test.ts>
const x = 1;
<AI_EDIT_CONTENT_END:src/test.ts>`;

    const originalFiles = [{ path: 'src/test.ts', content: 'old' }];
    const result = parseEditResponse(response, originalFiles);

    expect(result.changedFiles.length).toBe(1);
    expect(result.changedFiles[0].explanation).toBe('テスト追加');
  });

  it('should handle Python files', () => {
    const response = `Change: src/main.py - Initial implementation

<AI_EDIT_CONTENT_START:src/main.py>
def main():
    print("Hello")
<AI_EDIT_CONTENT_END:src/main.py>`;

    const originalFiles = [{ path: 'src/main.py', content: 'old' }];
    const result = parseEditResponse(response, originalFiles);

    expect(result.changedFiles.length).toBe(1);
    expect(result.changedFiles[0].explanation).toBe('Initial implementation');
  });

  it('should handle multiple consecutive missing END tags', () => {
    const response = `<AI_EDIT_CONTENT_START:src/a.ts>
content a
<AI_EDIT_CONTENT_START:src/b.ts>
content b`;

    const originalFiles = [
      { path: 'src/a.ts', content: 'old a' },
      { path: 'src/b.ts', content: 'old b' },
    ];
    const result = parseEditResponse(response, originalFiles);

    // 少なくとも1つは拾えることを確認
    expect(result.changedFiles.length).toBeGreaterThanOrEqual(1);
  });

  it('should preserve message when using flexible formats', () => {
    const response = `カスタムメッセージです。

## File: src/test.ts

Reason: Test

<AI_EDIT_CONTENT_START:src/test.ts>
content
<AI_EDIT_CONTENT_END:src/test.ts>`;

    const originalFiles = [{ path: 'src/test.ts', content: 'old' }];
    const result = parseEditResponse(response, originalFiles);

    expect(result.message).toBe('カスタムメッセージです。');
  });
});
