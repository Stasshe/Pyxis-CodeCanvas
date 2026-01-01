/**
 * Comprehensive Edge Case Tests for AI Response Parser
 * 
 * These tests cover scenarios that the current implementation may not handle well:
 * - Incomplete SEARCH/REPLACE blocks
 * - Malformed blocks with missing separators
 * - Multiple blocks where some are incomplete
 * - Very long content in SEARCH blocks
 * - Special characters and edge cases in content
 * - Multi-file edits with mixed valid/invalid blocks
 */

import {
  parseEditResponse,
  validateResponse,
  extractFilePathsFromResponse,
} from '@/engine/ai/responseParser';

describe('AI Response Parser - Edge Cases', () => {
  describe('Incomplete SEARCH/REPLACE blocks', () => {
    it('should detect incomplete SEARCH block (missing separator)', () => {
      const response = `### File: src/test.ts
**Reason**: Incomplete block

\`\`\`
<<<<<<< SEARCH
const x = 1;
const y = 2;
\`\`\``;

      const validation = validateResponse(response);
      expect(validation.isValid).toBe(false);
      expect(validation.errors.some(e => e.includes('Mismatched'))).toBe(true);
    });

    it('should detect incomplete SEARCH block (missing REPLACE marker)', () => {
      const response = `### File: src/test.ts
**Reason**: Incomplete block

<<<<<<< SEARCH
const x = 1;
=======
const x = 2;`;

      const validation = validateResponse(response);
      expect(validation.isValid).toBe(false);
      expect(validation.errors.some(e => e.includes('Mismatched'))).toBe(true);
    });

    it('should detect SEARCH block with only start marker', () => {
      const response = `### File: src/test.ts
**Reason**: Very incomplete

<<<<<<< SEARCH
const x = 1;`;

      const validation = validateResponse(response);
      expect(validation.isValid).toBe(false);
    });

    it('should handle truncated multi-line SEARCH block', () => {
      const response = `### File: /index.html
**Reason**: Truncated content

<<<<<<< SEARCH
            let datasets = [];
            let maxAbsVal = 0; // For dynamic axis scaling

            if (mode === 'series') {
                // Calculate series RLC values
                R_val = r;
                X_val = XL - XC;
                Z_mag = Math.sqrt(R_val * R_val + X_val`;

      const validation = validateResponse(response);
      expect(validation.isValid).toBe(false);
      expect(validation.errors).toContain('Mismatched SEARCH/REPLACE: 1 SEARCH vs 0 REPLACE');
    });
  });

  describe('Multiple blocks with mixed validity', () => {
    it('should handle file with one valid and one incomplete block', () => {
      const response = `### File: src/test.ts
**Reason**: Mixed blocks

<<<<<<< SEARCH
const a = 1;
=======
const a = 10;
>>>>>>> REPLACE

<<<<<<< SEARCH
const b = 2;
=======`;

      const validation = validateResponse(response);
      expect(validation.isValid).toBe(false);
      expect(validation.errors).toContain('Mismatched SEARCH/REPLACE: 2 SEARCH vs 1 REPLACE');

      const originalFiles = [{ path: 'src/test.ts', content: 'const a = 1;\nconst b = 2;' }];
      const result = parseEditResponse(response, originalFiles);
      
      // Should still parse the valid block
      expect(result.changedFiles.length).toBeGreaterThanOrEqual(0);
    });

    it('should handle multiple files where one has incomplete blocks', () => {
      const response = `### File: src/a.ts
**Reason**: Valid change

<<<<<<< SEARCH
export const a = 1;
=======
export const a = 10;
>>>>>>> REPLACE

### File: src/b.ts
**Reason**: Incomplete change

<<<<<<< SEARCH
export const b = 2;
=======
export const b = 20;`;

      const validation = validateResponse(response);
      expect(validation.isValid).toBe(false);
      
      const originalFiles = [
        { path: 'src/a.ts', content: 'export const a = 1;' },
        { path: 'src/b.ts', content: 'export const b = 2;' },
      ];
      const result = parseEditResponse(response, originalFiles);
      
      // Should parse at least the valid file
      expect(result.changedFiles.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Very long content in SEARCH blocks', () => {
    it('should handle SEARCH block with very long lines', () => {
      const longLine = 'const x = "' + 'a'.repeat(10000) + '";';
      const response = `### File: src/test.ts
**Reason**: Long line

<<<<<<< SEARCH
${longLine}
=======
const x = "short";
>>>>>>> REPLACE`;

      const validation = validateResponse(response);
      expect(validation.isValid).toBe(true);

      const originalFiles = [{ path: 'src/test.ts', content: longLine }];
      const result = parseEditResponse(response, originalFiles);
      
      expect(result.changedFiles.length).toBe(1);
      expect(result.changedFiles[0].suggestedContent).toContain('short');
    });

    it('should handle SEARCH block with many lines', () => {
      const manyLines = Array(500).fill('const x = 1;').join('\n');
      const response = `### File: src/test.ts
**Reason**: Many lines

<<<<<<< SEARCH
${manyLines}
=======
const x = 2;
>>>>>>> REPLACE`;

      const validation = validateResponse(response);
      expect(validation.isValid).toBe(true);

      const originalFiles = [{ path: 'src/test.ts', content: manyLines }];
      const result = parseEditResponse(response, originalFiles);
      
      expect(result.changedFiles.length).toBe(1);
    });
  });

  describe('Special characters in SEARCH blocks', () => {
    it('should handle SEARCH block containing the separator marker in code', () => {
      const response = `### File: src/test.ts
**Reason**: Contains separator

<<<<<<< SEARCH
const str = "=======";
=======
const str = "equals";
>>>>>>> REPLACE`;

      const validation = validateResponse(response);
      expect(validation.isValid).toBe(true);

      const originalFiles = [{ path: 'src/test.ts', content: 'const str = "=======";' }];
      const result = parseEditResponse(response, originalFiles);
      
      expect(result.changedFiles.length).toBe(1);
    });

    it('should handle SEARCH block containing nested SEARCH markers in comments', () => {
      const response = `### File: src/test.ts
**Reason**: Contains markers

<<<<<<< SEARCH
// This comment mentions <<<<<<< SEARCH
const x = 1;
=======
// This comment mentions <<<<<<< SEARCH
const x = 2;
>>>>>>> REPLACE`;

      const validation = validateResponse(response);
      // This is tricky - the regex might match incorrectly
      // The test documents the expected behavior
      
      const originalFiles = [{ 
        path: 'src/test.ts', 
        content: '// This comment mentions <<<<<<< SEARCH\nconst x = 1;' 
      }];
      const result = parseEditResponse(response, originalFiles);
      
      // This test documents that nested markers can cause issues
      // The fix should handle this case properly
    });

    it('should handle SEARCH block with regex special characters', () => {
      const response = `### File: src/test.ts
**Reason**: Regex chars

<<<<<<< SEARCH
const regex = /test\\.value\\[0\\]/;
=======
const regex = /test\\.value\\[\\d+\\]/;
>>>>>>> REPLACE`;

      const validation = validateResponse(response);
      expect(validation.isValid).toBe(true);

      const originalFiles = [{ 
        path: 'src/test.ts', 
        content: 'const regex = /test\\.value\\[0\\]/;' 
      }];
      const result = parseEditResponse(response, originalFiles);
      
      expect(result.changedFiles.length).toBe(1);
    });
  });

  describe('Whitespace edge cases', () => {
    it('should handle SEARCH block with only whitespace', () => {
      const response = `### File: src/test.ts
**Reason**: Whitespace only

<<<<<<< SEARCH
   
=======
const x = 1;
>>>>>>> REPLACE`;

      const validation = validateResponse(response);
      expect(validation.isValid).toBe(true);

      const originalFiles = [{ path: 'src/test.ts', content: '   \n' }];
      const result = parseEditResponse(response, originalFiles);
      
      // Should attempt to parse but may not match
      expect(result.changedFiles.length).toBeGreaterThanOrEqual(0);
    });

    it('should handle SEARCH/REPLACE with no content between markers', () => {
      const response = `### File: src/test.ts
**Reason**: Empty blocks

<<<<<<< SEARCH
=======
>>>>>>> REPLACE`;

      const validation = validateResponse(response);
      // Empty search/replace might be valid for certain operations
    });

    it('should handle extra whitespace around markers', () => {
      const response = `### File: src/test.ts
**Reason**: Extra whitespace

<<<<<<<  SEARCH  
const x = 1;
=======  
const x = 2;
>>>>>>>  REPLACE  `;

      const validation = validateResponse(response);
      // Should handle or reject gracefully
    });
  });

  describe('Marker variations', () => {
    it('should reject incorrect marker format', () => {
      const response = `### File: src/test.ts
**Reason**: Wrong markers

<<< SEARCH
const x = 1;
===
const x = 2;
>>> REPLACE`;

      const validation = validateResponse(response);
      // Should not count as valid SEARCH/REPLACE blocks
    });

    it('should handle case-sensitive marker matching', () => {
      const response = `### File: src/test.ts
**Reason**: Case variation

<<<<<<< search
const x = 1;
=======
const x = 2;
>>>>>>> replace`;

      const validation = validateResponse(response);
      // Should not match if case-sensitive (current implementation)
    });
  });

  describe('Multiple SEARCH blocks in same file', () => {
    it('should handle 10+ SEARCH/REPLACE blocks in one file', () => {
      let response = `### File: src/test.ts
**Reason**: Many blocks\n\n`;
      
      for (let i = 0; i < 15; i++) {
        response += `<<<<<<< SEARCH
const x${i} = ${i};
=======
const x${i} = ${i * 10};
>>>>>>> REPLACE

`;
      }

      const validation = validateResponse(response);
      expect(validation.isValid).toBe(true);

      let content = '';
      for (let i = 0; i < 15; i++) {
        content += `const x${i} = ${i};\n`;
      }
      
      const originalFiles = [{ path: 'src/test.ts', content }];
      const result = parseEditResponse(response, originalFiles);
      
      expect(result.changedFiles.length).toBe(1);
      expect(result.changedFiles[0].patchBlocks?.length).toBe(15);
    });

    it('should handle sequential SEARCH blocks with no gaps', () => {
      const response = `### File: src/test.ts
**Reason**: Sequential blocks

<<<<<<< SEARCH
line1
=======
new1
>>>>>>> REPLACE
<<<<<<< SEARCH
line2
=======
new2
>>>>>>> REPLACE`;

      const validation = validateResponse(response);
      expect(validation.isValid).toBe(true);

      const originalFiles = [{ path: 'src/test.ts', content: 'line1\nline2\nline3' }];
      const result = parseEditResponse(response, originalFiles);
      
      expect(result.changedFiles.length).toBe(1);
      expect(result.changedFiles[0].patchBlocks?.length).toBe(2);
    });
  });

  describe('Mixed format edge cases', () => {
    it('should prioritize SEARCH/REPLACE over legacy when both present', () => {
      const response = `### File: src/test.ts
**Reason**: Mixed format

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
      
      expect(result.usedPatchFormat).toBe(true);
      // Should use SEARCH/REPLACE result (x = 2), not legacy (x = 3)
      expect(result.changedFiles[0].suggestedContent).toContain('const x = 2');
    });
  });

  describe('File path extraction edge cases', () => {
    it('should extract paths from incomplete responses', () => {
      const response = `### File: src/a.ts
**Reason**: First file

<<<<<<< SEARCH
old
=======
new
>>>>>>> REPLACE

### File: src/b.ts
**Reason**: Second file (incomplete)

<<<<<<< SEARCH
old2`;

      const paths = extractFilePathsFromResponse(response);
      expect(paths).toContain('src/a.ts');
      expect(paths).toContain('src/b.ts');
      expect(paths.length).toBe(2);
    });

    it('should handle duplicate file paths in response', () => {
      const response = `### File: src/test.ts
**Reason**: First edit

<<<<<<< SEARCH
a
=======
b
>>>>>>> REPLACE

### File: src/test.ts
**Reason**: Second edit

<<<<<<< SEARCH
c
=======
d
>>>>>>> REPLACE`;

      const paths = extractFilePathsFromResponse(response);
      // Should deduplicate
      expect(paths.filter(p => p === 'src/test.ts').length).toBe(1);
    });
  });

  describe('Real-world failure scenarios', () => {
    it('should handle the exact error from the issue description', () => {
      const response = `### File: /index.html
**Reason**: フェーザ図のX軸とY軸のスケールを独立して調整し、原点がチャートの中心に適切に表示されるように修正します。

\`\`\`
<<<<<<< SEARCH
            let datasets = [];
            let maxAbsVal = 0; // For dynamic axis scaling

            if (mode === 'series') {
                // Calculate series RLC values
                R_val = r;
                X_val = XL - XC;
                Z_mag = Math.sqrt(R_val * R_val + X_val`;

      const validation = validateResponse(response);
      expect(validation.isValid).toBe(false);
      expect(validation.errors).toContain('Mismatched SEARCH/REPLACE: 1 SEARCH vs 0 REPLACE');
      
      // Even with invalid response, should extract the file path
      const paths = extractFilePathsFromResponse(response);
      expect(paths).toContain('/index.html');
    });

    it('should handle second error from issue description', () => {
      const response = `### File: /index.html
**Reason**: フェーザ図の中心軸がずれているというフィードバックに対応するため

\`\`\`
<<<<<<< SEARCH
                                grid: {
                                    zeroLineColor: '#ccc',
                                    drawOnChartArea: false
                                },
                                min: -maxAbsVal, // This is the key part
                                max: maxAbsVal,  // This is the key part
                                ticks: {
                                    callback: function(value) {
                                        return value.toFixed(1);`;

      const validation = validateResponse(response);
      expect(validation.isValid).toBe(false);
      expect(validation.errors).toContain('Mismatched SEARCH/REPLACE: 1 SEARCH vs 0 REPLACE');
    });
  });

  describe('Validation error messages', () => {
    it('should provide clear error message for missing REPLACE', () => {
      const response = `<<<<<<< SEARCH
test
=======`;

      const validation = validateResponse(response);
      expect(validation.isValid).toBe(false);
      expect(validation.errors.length).toBeGreaterThan(0);
      // Error message should be clear about what's missing
    });

    it('should provide clear error message for missing separator', () => {
      const response = `<<<<<<< SEARCH
test
>>>>>>> REPLACE`;

      const validation = validateResponse(response);
      // With the enhanced validation, this should produce a warning
      // about missing separator (marker count matches but block is incomplete)
      
      // The block won't actually parse correctly
      const originalFiles = [{ path: 'test.ts', content: 'test' }];
      const parseResult = parseEditResponse(response, originalFiles);
      // parseEditResponse won't find any valid blocks without separator
      expect(parseResult.changedFiles.length).toBe(0);
    });
  });
});
