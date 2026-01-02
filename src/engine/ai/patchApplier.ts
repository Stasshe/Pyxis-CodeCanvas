/**
 * Multi-Patch Applier for AI Code Editing
 *
 * This module provides robust SEARCH/REPLACE block-based patch application
 * similar to GitHub Copilot and Cursor's approach.
 *
 * Format:
 * <<<<<<< SEARCH
 * [exact text to find]
 * =======
 * [replacement text]
 * >>>>>>> REPLACE
 */

export interface SearchReplaceBlock {
  search: string;
  replace: string;
  lineNumber?: number; // Optional hint for fuzzy matching
}

export interface PatchBlock {
  filePath: string;
  blocks: SearchReplaceBlock[];
  explanation?: string;
  isNewFile?: boolean;
  fullContent?: string; // For new files or full replacement
}

export interface PatchResult {
  success: boolean;
  filePath: string;
  originalContent: string;
  patchedContent: string;
  appliedBlocks: number;
  failedBlocks: SearchReplaceBlock[];
  errors: string[];
  isNewFile?: boolean;
}

export interface MultiPatchResult {
  results: PatchResult[];
  totalSuccess: number;
  totalFailed: number;
  overallSuccess: boolean;
}

/**
 * Normalize line endings to LF
 */
function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/**
 * Normalize whitespace for comparison (trims trailing whitespace per line)
 */
function normalizeForComparison(text: string): string {
  // More efficient regex-based approach for large files
  return text.replace(/[ \t]+$/gm, '');
}

/**
 * Calculate line-based similarity score (0-1)
 */
function calculateLineSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (!a || !b) return 0;

  const aLines = a.split('\n');
  const bLines = b.split('\n');

  if (aLines.length !== bLines.length) {
    const lengthDiff = Math.abs(aLines.length - bLines.length);
    if (lengthDiff > Math.max(aLines.length, bLines.length) * 0.2) {
      return 0;
    }
  }

  let matches = 0;
  const maxLines = Math.max(aLines.length, bLines.length);

  for (let i = 0; i < Math.min(aLines.length, bLines.length); i++) {
    const lineA = aLines[i].trim();
    const lineB = bLines[i].trim();
    if (lineA === lineB) {
      matches++;
    } else if (lineA.length > 0 && lineB.length > 0) {
      if (lineA.includes(lineB) || lineB.includes(lineA)) {
        matches += 0.5;
      }
    }
  }

  return matches / maxLines;
}

/**
 * Find exact match position in content
 */
function findExactMatch(
  content: string,
  search: string,
  startFrom = 0
): { index: number; matchedText: string } | null {
  // Try exact match first
  const exactIndex = content.indexOf(search, startFrom);
  if (exactIndex !== -1) {
    return { index: exactIndex, matchedText: search };
  }

  // Try with normalized whitespace
  const normalizedContent = normalizeForComparison(content);
  const normalizedSearch = normalizeForComparison(search);

  const normalizedIndex = normalizedContent.indexOf(normalizedSearch, startFrom);
  if (normalizedIndex !== -1) {
    // Find corresponding position in original content
    const contentLines = content.split('\n');
    const normalizedLines = normalizedContent.split('\n');
    const searchLines = normalizedSearch.split('\n');

    // Count which line the match starts on
    let charCount = 0;
    let startLine = 0;
    for (let i = 0; i < normalizedLines.length; i++) {
      if (charCount + normalizedLines[i].length >= normalizedIndex) {
        startLine = i;
        break;
      }
      charCount += normalizedLines[i].length + 1; // +1 for newline
    }

    // Build the original index
    let originalStartIndex = 0;
    for (let i = 0; i < startLine; i++) {
      originalStartIndex += contentLines[i].length + 1;
    }

    // Calculate column offset within the line
    const columnOffset = normalizedIndex - charCount;
    originalStartIndex += Math.min(columnOffset, contentLines[startLine]?.length || 0);

    // Find end index
    const endLine = startLine + searchLines.length - 1;
    let originalEndIndex = originalStartIndex;
    for (let i = startLine; i <= endLine && i < contentLines.length; i++) {
      if (i === endLine) {
        originalEndIndex += contentLines[i].length;
      } else {
        originalEndIndex += contentLines[i].length + 1;
      }
    }

    const matchedText = content.substring(originalStartIndex, originalEndIndex);

    // Verify the match
    const matchSimilarity = calculateLineSimilarity(
      normalizedSearch,
      normalizeForComparison(matchedText)
    );
    if (matchSimilarity > 0.9) {
      return { index: originalStartIndex, matchedText };
    }
  }

  return null;
}

// Constants for fuzzy matching and scoring
const MIN_CONFIDENCE_THRESHOLD = 0.6; // Lowered from 0.85 to accept more variations
const MIN_NONTRIVIAL_LINE_LENGTH = 10; // Minimum characters for a line to be considered significant
const PARTIAL_MATCH_SCORE = 0.7; // Score for partial line matches
const BASE_PARTIAL_SCORE = 0.5; // Base score for partial context matches
const LENGTH_RATIO_WEIGHT = 0.5; // Weight for length ratio in partial scoring

/**
 * Find the best fuzzy match for search text in content
 * Uses a lower threshold to be more lenient with file changes
 */
function findFuzzyMatch(
  content: string,
  search: string,
  startFrom = 0,
  minConfidence = MIN_CONFIDENCE_THRESHOLD
): { index: number; matchedText: string; confidence: number } | null {
  const normalizedContent = normalizeForComparison(content);
  const normalizedSearch = normalizeForComparison(search);

  const contentLines = content.split('\n');
  const searchLines = normalizedSearch.split('\n');

  if (searchLines.length === 0) return null;

  const firstSearchLine = searchLines[0].trim();
  if (!firstSearchLine) return null;

  let bestMatch: { index: number; matchedText: string; confidence: number } | null = null;

  for (let i = 0; i < contentLines.length - searchLines.length + 1; i++) {
    // Check if first line matches
    const contentLineNormalized = contentLines[i].trim();
    if (
      !contentLineNormalized.includes(firstSearchLine) &&
      !firstSearchLine.includes(contentLineNormalized)
    ) {
      continue;
    }

    // Check all lines
    let matchScore = 0;
    for (let j = 0; j < searchLines.length; j++) {
      const contentLine = contentLines[i + j]?.trim() || '';
      const searchLine = searchLines[j].trim();

      if (contentLine === searchLine) {
        matchScore += 1;
      } else if (contentLine.includes(searchLine) || searchLine.includes(contentLine)) {
        matchScore += PARTIAL_MATCH_SCORE;
      }
    }

    const confidence = matchScore / searchLines.length;

    if (confidence > minConfidence && (!bestMatch || confidence > bestMatch.confidence)) {
      // Calculate exact positions in original content
      let startIndex = 0;
      for (let k = 0; k < i; k++) {
        startIndex += contentLines[k].length + 1;
      }

      // Skip if before startFrom
      if (startIndex < startFrom) continue;

      let endIndex = startIndex;
      for (let k = i; k < i + searchLines.length && k < contentLines.length; k++) {
        endIndex += contentLines[k].length + (k < i + searchLines.length - 1 ? 1 : 0);
      }

      bestMatch = {
        index: startIndex,
        matchedText: content.substring(startIndex, endIndex),
        confidence,
      };
    }
  }

  return bestMatch;
}

/**
 * Find best position to insert replace content based on context
 * Used as fallback when exact/fuzzy matching fails
 */
function findBestInsertPosition(
  content: string,
  search: string
): { index: number; matchedText: string } | null {
  const contentLines = content.split('\n');
  const searchLines = search.split('\n').filter(line => line.trim());

  if (searchLines.length === 0) return null;

  // Try to find a unique line from the search block
  const uniqueLines = searchLines.filter(line => {
    const trimmed = line.trim();
    return (
      trimmed.length > MIN_NONTRIVIAL_LINE_LENGTH && // Non-trivial line
      !trimmed.startsWith('//') && // Not a comment
      !trimmed.startsWith('/*') &&
      !trimmed.startsWith('*')
    );
  });

  if (uniqueLines.length === 0) return null;

  // Find the best matching line in content
  let bestLineIndex = -1;
  let bestScore = 0;

  for (const searchLine of uniqueLines) {
    const searchTrimmed = searchLine.trim();
    for (let i = 0; i < contentLines.length; i++) {
      const contentTrimmed = contentLines[i].trim();
      if (contentTrimmed === searchTrimmed) {
        // Exact match - highest priority
        bestLineIndex = i;
        bestScore = 1;
        break;
      }
      if (contentTrimmed.includes(searchTrimmed) || searchTrimmed.includes(contentTrimmed)) {
        // Partial match: base score + length ratio bonus
        const lengthRatio =
          Math.min(contentTrimmed.length, searchTrimmed.length) /
          Math.max(contentTrimmed.length, searchTrimmed.length);
        const score = BASE_PARTIAL_SCORE + lengthRatio * LENGTH_RATIO_WEIGHT;
        if (score > bestScore) {
          bestScore = score;
          bestLineIndex = i;
        }
      }
    }
    if (bestScore === 1) break;
  }

  if (bestLineIndex === -1) return null;

  // Calculate the position
  let startIndex = 0;
  for (let i = 0; i < bestLineIndex; i++) {
    startIndex += contentLines[i].length + 1;
  }

  // Find a reasonable range to replace (the matched line and some context)
  const endIndex = startIndex + contentLines[bestLineIndex].length;

  return {
    index: startIndex,
    matchedText: content.substring(startIndex, endIndex),
  };
}

/**
 * Apply a single SEARCH/REPLACE block to content
 */
export function applySearchReplaceBlock(
  content: string,
  block: SearchReplaceBlock,
  startFrom = 0
): { success: boolean; content: string; error?: string; matchEnd?: number } {
  const normalizedContent = normalizeLineEndings(content);
  const normalizedSearch = normalizeLineEndings(block.search);
  const normalizedReplace = normalizeLineEndings(block.replace);

  // Handle empty search (insert at beginning or end)
  if (!normalizedSearch.trim()) {
    if (block.lineNumber !== undefined && block.lineNumber > 0) {
      const lines = normalizedContent.split('\n');
      const insertIndex = Math.min(block.lineNumber - 1, lines.length);
      lines.splice(insertIndex, 0, normalizedReplace);
      return {
        success: true,
        content: lines.join('\n'),
        matchEnd: 0,
      };
    }
    return {
      success: false,
      content: normalizedContent,
      error:
        'Empty search pattern requires a lineNumber hint for insertion. Provide lineNumber in the SearchReplaceBlock.',
    };
  }

  // Try exact match first
  const exactMatch = findExactMatch(normalizedContent, normalizedSearch, startFrom);
  if (exactMatch) {
    const before = normalizedContent.substring(0, exactMatch.index);
    const after = normalizedContent.substring(exactMatch.index + exactMatch.matchedText.length);
    const newContent = before + normalizedReplace + after;

    return {
      success: true,
      content: newContent,
      matchEnd: exactMatch.index + normalizedReplace.length,
    };
  }

  // Try fuzzy match with standard threshold
  const fuzzyMatch = findFuzzyMatch(normalizedContent, normalizedSearch, startFrom);
  if (fuzzyMatch && fuzzyMatch.confidence > 0.6) {
    const before = normalizedContent.substring(0, fuzzyMatch.index);
    const after = normalizedContent.substring(fuzzyMatch.index + fuzzyMatch.matchedText.length);
    const newContent = before + normalizedReplace + after;

    return {
      success: true,
      content: newContent,
      matchEnd: fuzzyMatch.index + normalizedReplace.length,
    };
  }

  // Fallback: Try to find best position based on context (prefer AI edit on conflict)
  // This handles cases where the file has been significantly edited
  const bestPosition = findBestInsertPosition(normalizedContent, normalizedSearch);
  if (bestPosition) {
    const before = normalizedContent.substring(0, bestPosition.index);
    const after = normalizedContent.substring(bestPosition.index + bestPosition.matchedText.length);
    const newContent = before + normalizedReplace + after;

    console.log('[PatchApplier] Applied patch using best-effort position matching');
    return {
      success: true,
      content: newContent,
      matchEnd: bestPosition.index + normalizedReplace.length,
    };
  }

  return {
    success: false,
    content: normalizedContent,
    error: `Could not find matching text for search block`,
  };
}

/**
 * Apply multiple SEARCH/REPLACE blocks to content
 * Blocks are applied in order
 */
export function applyMultipleBlocks(
  content: string,
  blocks: SearchReplaceBlock[]
): {
  success: boolean;
  content: string;
  appliedCount: number;
  failedBlocks: SearchReplaceBlock[];
  errors: string[];
} {
  let currentContent = normalizeLineEndings(content);
  const failedBlocks: SearchReplaceBlock[] = [];
  const errors: string[] = [];
  let appliedCount = 0;

  for (const block of blocks) {
    const result = applySearchReplaceBlock(currentContent, block, 0);

    if (result.success) {
      currentContent = result.content;
      appliedCount++;
    } else {
      failedBlocks.push(block);
      errors.push(result.error || 'Unknown error');
    }
  }

  return {
    success: failedBlocks.length === 0,
    content: currentContent,
    appliedCount,
    failedBlocks,
    errors,
  };
}

/**
 * Apply a complete patch block (potentially with multiple search/replace operations)
 */
export function applyPatchBlock(originalContent: string, patch: PatchBlock): PatchResult {
  // Handle new file creation
  if (patch.isNewFile && patch.fullContent !== undefined) {
    return {
      success: true,
      filePath: patch.filePath,
      originalContent: '',
      patchedContent: normalizeLineEndings(patch.fullContent),
      appliedBlocks: 1,
      failedBlocks: [],
      errors: [],
      isNewFile: true,
    };
  }

  // Handle full file replacement (legacy format)
  if (patch.fullContent !== undefined && patch.blocks.length === 0) {
    return {
      success: true,
      filePath: patch.filePath,
      originalContent,
      patchedContent: normalizeLineEndings(patch.fullContent),
      appliedBlocks: 1,
      failedBlocks: [],
      errors: [],
    };
  }

  // Apply search/replace blocks
  const result = applyMultipleBlocks(originalContent, patch.blocks);

  return {
    success: result.success,
    filePath: patch.filePath,
    originalContent,
    patchedContent: result.content,
    appliedBlocks: result.appliedCount,
    failedBlocks: result.failedBlocks,
    errors: result.errors,
  };
}

/**
 * Apply multiple patch blocks to multiple files
 */
export function applyMultiplePatches(
  patches: PatchBlock[],
  fileContents: Map<string, string>
): MultiPatchResult {
  const results: PatchResult[] = [];
  let totalSuccess = 0;
  let totalFailed = 0;

  for (const patch of patches) {
    const originalContent = fileContents.get(patch.filePath) || '';
    const result = applyPatchBlock(originalContent, patch);

    results.push(result);
    if (result.success) {
      totalSuccess++;
    } else {
      totalFailed++;
    }
  }

  return {
    results,
    totalSuccess,
    totalFailed,
    overallSuccess: totalFailed === 0,
  };
}

/**
 * Parse SEARCH/REPLACE blocks from raw text
 */
export function parseSearchReplaceBlocks(text: string): SearchReplaceBlock[] {
  const blocks: SearchReplaceBlock[] = [];

  // Pattern for SEARCH/REPLACE blocks
  const blockPattern = /<<<<<<< SEARCH\n([\s\S]*?)\n=======\n([\s\S]*?)\n>>>>>>> REPLACE/g;

  let match;
  while ((match = blockPattern.exec(text)) !== null) {
    blocks.push({
      search: match[1],
      replace: match[2],
    });
  }

  return blocks;
}

/**
 * Validate that search text exists in content
 */
export function validateSearchExists(content: string, search: string): boolean {
  const normalizedContent = normalizeLineEndings(content);
  const normalizedSearch = normalizeLineEndings(search);

  // Exact match
  if (normalizedContent.includes(normalizedSearch)) {
    return true;
  }

  // Try normalized comparison
  const normalizedContentTrimmed = normalizeForComparison(normalizedContent);
  const normalizedSearchTrimmed = normalizeForComparison(normalizedSearch);

  if (normalizedContentTrimmed.includes(normalizedSearchTrimmed)) {
    return true;
  }

  // Fuzzy match with threshold constant
  const match = findFuzzyMatch(normalizedContent, normalizedSearch);
  return match !== null && match.confidence > MIN_CONFIDENCE_THRESHOLD;
}

/**
 * Format a patch block for display/debugging
 */
export function formatPatchBlock(block: SearchReplaceBlock): string {
  return `<<<<<<< SEARCH
${block.search}
=======
${block.replace}
>>>>>>> REPLACE`;
}

/**
 * Create a simple single replacement patch
 */
export function createSimplePatch(
  filePath: string,
  search: string,
  replace: string,
  explanation?: string
): PatchBlock {
  return {
    filePath,
    blocks: [{ search, replace }],
    explanation,
  };
}

/**
 * Create a new file patch
 */
export function createNewFilePatch(
  filePath: string,
  content: string,
  explanation?: string
): PatchBlock {
  return {
    filePath,
    blocks: [],
    fullContent: content,
    isNewFile: true,
    explanation,
  };
}
