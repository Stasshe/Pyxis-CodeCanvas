# AI Edit SEARCH/REPLACE Block Parsing

## Overview

This document describes the SEARCH/REPLACE block parsing system used for AI code edits in Pyxis. The system allows AI to suggest precise, surgical code changes without replacing entire files.

## Format

### Basic SEARCH/REPLACE Block

```
<<<<<<< SEARCH
[exact text to find]
=======
[replacement text]
>>>>>>> REPLACE
```

### NEW_FILE Block

```
<<<<<<< NEW_FILE
[content for new file]
>>>>>>> NEW_FILE
```

## Architecture

### Key Components

1. **`responseParser.ts`**: Parses AI responses and extracts file edits
   - `parseFilePatchSection()`: Manual parsing of SEARCH/REPLACE blocks
   - `validateResponse()`: Validates response structure
   - `extractFilePathsFromResponse()`: Extracts file paths from response

2. **`patchApplier.ts`**: Applies SEARCH/REPLACE blocks to file content
   - `applySearchReplaceBlock()`: Applies a single block with fuzzy matching
   - `applyMultipleBlocks()`: Applies multiple blocks in sequence
   - Supports exact matching and fuzzy matching for whitespace differences

## Parsing Algorithm

### Manual Parsing Approach (v0.17.1+)

The parser uses a **manual sequential parsing approach** instead of regex to handle edge cases:

```typescript
while (currentIndex < section.length) {
  1. Find '<<<<<<< SEARCH' marker
  2. Find '\n=======\n' separator
  3. Find '\n>>>>>>> REPLACE' marker
  4. Extract content between positions
  5. Skip incomplete blocks
  6. Move to next block
}
```

### Why Manual Parsing?

**Problem**: Regex patterns like `[\s\S]*?` fail when:
- Empty replace blocks are followed by another SEARCH block
- Content contains the separator sequence
- Nested markers appear in code

**Solution**: Sequential position-based parsing:
- ✅ Handles empty replace blocks (deletions)
- ✅ Works with nested markers in content
- ✅ Correctly isolates each block
- ✅ Gracefully skips incomplete blocks

## Validation

### Response Validation

`validateResponse()` checks for:

1. **Marker Balance**: 
   - SEARCH count must match REPLACE count
   - NEW_FILE start must match end

2. **Block Completeness** (warnings):
   - Checks if blocks have proper separator
   - Warns about malformed blocks

3. **Content Presence**:
   - At least one valid block should exist

### Error Messages

```typescript
// Error: Mismatched markers
"Mismatched SEARCH/REPLACE: 3 SEARCH vs 2 REPLACE"

// Warning: Missing separator
"Some SEARCH/REPLACE blocks may be missing the separator (=======). 
 2 complete blocks found out of 3 expected."
```

## Supported Scenarios

### ✅ Fully Supported

1. **Multiple edits in one file**
   ```
   ### File: src/app.ts
   <<<<<<< SEARCH
   const a = 1;
   =======
   const a = 10;
   >>>>>>> REPLACE
   
   <<<<<<< SEARCH
   const b = 2;
   =======
   const b = 20;
   >>>>>>> REPLACE
   ```

2. **Empty replace blocks (deletions)**
   ```
   <<<<<<< SEARCH
   const unused = true;
   =======
   >>>>>>> REPLACE
   ```

3. **Sequential dependent edits**
   ```
   // First edit adds type
   function add(a: number, b: number)
   
   // Second edit adds return type
   function add(a: number, b: number): number
   ```

4. **Multiple files in one response**
   - Up to 20+ files tested
   - 10+ edits per file tested

5. **Special characters**
   - Regex patterns: `/test\\.value\\[0\\]/`
   - Template literals: `` `hello ${name}` ``
   - Separators in content: `"======="` as a string

6. **Very long content**
   - Lines with 10,000+ characters
   - Files with 500+ lines

### ⚠️ Limitations

1. **Incomplete blocks are skipped**
   - Missing separator → skipped
   - Missing REPLACE marker → skipped
   - Validation warns about these

2. **Exact matching required**
   - Search text must match exactly (with whitespace normalization)
   - Fuzzy matching helps but has limits
   - AI must provide sufficient context

3. **Sequential application**
   - Blocks applied in order
   - Later blocks see changes from earlier blocks
   - Order matters for dependent edits

## Testing

### Test Coverage

- **163 total tests**
- **38 edge case tests**
  - 25 edge cases (truncation, malformed blocks, etc.)
  - 11 complex scenarios (multi-file, refactoring, etc.)

### Test Categories

1. **Edge Cases** (`aiResponseParserEdgeCases.test.ts`)
   - Incomplete/truncated blocks
   - Mixed valid/invalid blocks
   - Special characters
   - Nested markers
   - Very long content

2. **Complex Scenarios** (`aiMultiEditComplexScenarios.test.ts`)
   - Multiple files with multiple edits
   - Sequential dependent edits
   - Large-scale refactoring
   - Real-world patterns (React, API, types)

3. **Core Functionality** (`patchApplier.test.ts`, `aiMultiPatch.test.ts`)
   - Basic SEARCH/REPLACE
   - Fuzzy matching
   - Error handling
   - Multi-patch application

## Error Handling

### Validation Errors

When validation fails, the system:
1. Logs errors to console with `[useAI]` prefix
2. Still attempts to parse valid portions
3. Returns partial results when possible

Example:
```typescript
const validation = validateResponse(response);
if (!validation.isValid) {
  console.warn('[useAI] Response validation errors:', validation.errors);
}
// Still continues with parsing
const result = parseEditResponse(response, originalFiles);
```

### Partial Success

The system gracefully handles:
- Some files succeed, some fail
- Some blocks in a file succeed, others fail
- Returns detailed error information per block

## Best Practices

### For AI Prompt Engineering

1. **Provide sufficient context in SEARCH blocks**
   ```typescript
   // ❌ Too little context
   <<<<<<< SEARCH
   const x = 1;
   =======
   const x = 2;
   >>>>>>> REPLACE
   
   // ✅ Better - includes surrounding code
   <<<<<<< SEARCH
   function init() {
     const x = 1;
     return x;
   }
   =======
   function init() {
     const x = 2;
     return x;
   }
   >>>>>>> REPLACE
   ```

2. **Use exact indentation and whitespace**
   - Copy exact formatting from original
   - Trailing whitespace is normalized
   - Leading whitespace matters

3. **One logical change per block**
   ```typescript
   // ❌ Avoid mixing unrelated changes
   <<<<<<< SEARCH
   const a = 1;
   const b = 2;
   =======
   const a = 10;
   const c = 30;
   >>>>>>> REPLACE
   
   // ✅ Separate changes
   <<<<<<< SEARCH
   const a = 1;
   =======
   const a = 10;
   >>>>>>> REPLACE
   
   <<<<<<< SEARCH
   const b = 2;
   =======
   const c = 30;
   >>>>>>> REPLACE
   ```

4. **Sequential edits for dependencies**
   - Edit 1: Add import
   - Edit 2: Use imported function
   - Edit 3: Add error handling

### For Users

1. **Select relevant files**
   - Include files that need changes
   - Include related files for context
   - Don't include unrelated files

2. **Provide clear instructions**
   - Specific about what to change
   - Explain why changes are needed
   - Mention edge cases to consider

3. **Review changes carefully**
   - Check each file's diff
   - Verify logic is correct
   - Test after applying

## Debugging

### Enable Logging

Check browser console for:
```
[useAI] Response validation errors: [...]
[useAI] Selected files: [...]
[useAI] Response paths: [...]
[useAI] Parse result: [...]
```

### Common Issues

1. **"Mismatched SEARCH/REPLACE"**
   - Check for incomplete blocks in response
   - Verify separators are present
   - Look for truncated content

2. **"Could not find matching text"**
   - SEARCH text doesn't match file exactly
   - Check whitespace and indentation
   - Try adding more context

3. **"Some file blocks may be malformed"**
   - Response has structural issues
   - Some blocks missing markers
   - Check validation warnings

## Implementation Notes

### Performance

- Manual parsing is O(n) where n = response length
- No regex backtracking issues
- Handles large responses efficiently
- Tested with 20 files × 10 edits = 200 blocks

### Security

- No code execution during parsing
- Content is treated as plain text
- XSS prevention in rendering layer
- Input validation before application

### Compatibility

- Works with all text file types
- Language-agnostic parsing
- Handles Unicode correctly
- Cross-platform (Windows/Mac/Linux line endings)

## Future Enhancements

Potential improvements:

1. **Better fuzzy matching**
   - Tree-sitter based matching
   - AST-aware diffing
   - Language-specific normalization

2. **Conflict resolution**
   - Interactive resolution UI
   - Automatic merge strategies
   - Three-way merge support

3. **Undo/redo**
   - Track edit history
   - Rollback specific changes
   - Snapshot system

4. **Preview mode**
   - Show diffs before applying
   - Side-by-side comparison
   - Apply selectively

## Related Files

- `src/engine/ai/responseParser.ts` - Main parsing logic
- `src/engine/ai/patchApplier.ts` - Block application
- `src/hooks/ai/useAI.ts` - Integration with UI
- `tests/aiResponseParser*.test.ts` - Test suites

## Version History

### v0.17.1 (2026-01-01)
- ✨ Implemented manual parsing approach
- ✨ Added comprehensive edge case tests
- ✨ Enhanced validation with separator checking
- ✨ Fixed empty replace block handling
- 🐛 Fixed nested block parsing bug
- 📝 Added this documentation

### v0.17.0 (Previous)
- Initial SEARCH/REPLACE implementation
- Basic regex-based parsing
- Legacy format support
