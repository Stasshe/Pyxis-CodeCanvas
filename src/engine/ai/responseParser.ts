/**
 * AI Response Parser - Enhanced with Multi-Patch Support
 *
 * Supports two formats:
 * 1. New SEARCH/REPLACE block format (preferred)
 * 2. Legacy full-file replacement format (fallback)
 */

import { type PatchBlock, type SearchReplaceBlock, applyPatchBlock } from './patchApplier';

export interface ParsedFile {
  path: string;
  originalContent: string;
  suggestedContent: string;
  explanation: string;
  isNewFile?: boolean;
  patchBlocks?: SearchReplaceBlock[];
}

export interface ParseResult {
  changedFiles: ParsedFile[];
  message: string;
  raw: string;
  usedPatchFormat: boolean;
}

/**
 * Normalize path for case-insensitive comparison
 */
export function normalizePath(path: string): string {
  return path.replace(/^\/|\/$/g, '').toLowerCase();
}

/**
 * Extract file paths from response (supports both formats)
 */
export function extractFilePathsFromResponse(response: string): string[] {
  const foundPaths: string[] = [];
  const seen = new Set<string>();

  // Pattern 1: ### File: [path]
  const fileHeaderPattern = /###\s*File:\s*(.+?)(?:\n|$)/g;
  let match;
  while ((match = fileHeaderPattern.exec(response)) !== null) {
    const filePath = match[1].trim();
    if (filePath && !seen.has(filePath)) {
      foundPaths.push(filePath);
      seen.add(filePath);
    }
  }

  // Pattern 2: Legacy format <AI_EDIT_CONTENT_START:path>
  const legacyPattern = /<AI_EDIT_CONTENT_START:(.+?)>/g;
  while ((match = legacyPattern.exec(response)) !== null) {
    const filePath = match[1].trim();
    if (filePath && !seen.has(filePath)) {
      foundPaths.push(filePath);
      seen.add(filePath);
    }
  }

  // Pattern 3: ## Changed File: [path]
  const changedFilePattern = /##\s*(?:Changed\s+)?File:\s*(.+?)(?:\n|$)/g;
  while ((match = changedFilePattern.exec(response)) !== null) {
    const filePath = match[1].trim();
    if (filePath && !seen.has(filePath)) {
      foundPaths.push(filePath);
      seen.add(filePath);
    }
  }

  return foundPaths;
}

/**
 * Parse SEARCH/REPLACE blocks for a specific file section
 *
 * Enhanced to handle:
 * - Optional whitespace around markers
 * - Multiple blocks in sequence
 * - Incomplete blocks (will be skipped)
 * - Empty replace blocks (deletions)
 *
 * Uses a manual parsing approach to correctly handle edge cases
 * that regex-based approaches struggle with.
 */
function parseFilePatchSection(section: string): {
  blocks: SearchReplaceBlock[];
  isNewFile: boolean;
  fullContent?: string;
} {
  const blocks: SearchReplaceBlock[] = [];
  let isNewFile = false;
  let fullContent: string | undefined;

  // Check for NEW_FILE format using manual parsing for consistency
  const newFileStart = section.indexOf('<<<<<<< NEW_FILE');
  if (newFileStart !== -1) {
    const newFileMarkerEnd = section.indexOf('\n', newFileStart);
    if (newFileMarkerEnd !== -1) {
      const newFileEnd = section.indexOf('\n>>>>>>> NEW_FILE', newFileMarkerEnd);
      if (newFileEnd !== -1) {
        isNewFile = true;
        fullContent = section.substring(newFileMarkerEnd + 1, newFileEnd);
        return { blocks, isNewFile, fullContent };
      }
    }
  }

  // Manual parsing approach to handle edge cases
  let currentIndex = 0;

  while (currentIndex < section.length) {
    // Find next SEARCH marker
    const searchStart = section.indexOf('<<<<<<< SEARCH', currentIndex);
    if (searchStart === -1) break;

    // Find end of SEARCH marker line
    const searchMarkerEnd = section.indexOf('\n', searchStart);
    if (searchMarkerEnd === -1) break;

    // Find separator
    const separatorStart = section.indexOf('\n=======\n', searchMarkerEnd);
    if (separatorStart === -1) {
      // No separator found, skip this incomplete block
      currentIndex = searchStart + 1;
      continue;
    }

    // Find REPLACE marker
    const replaceStart = section.indexOf('\n>>>>>>> REPLACE', separatorStart);
    if (replaceStart === -1) {
      // No REPLACE marker found, skip this incomplete block
      currentIndex = searchStart + 1;
      continue;
    }

    // Extract search and replace content
    const searchContent = section.substring(searchMarkerEnd + 1, separatorStart);
    const replaceContent = section.substring(separatorStart + 9, replaceStart); // +9 to skip "\n=======\n"

    blocks.push({
      search: searchContent,
      replace: replaceContent,
    });

    // Move to after this block
    currentIndex = replaceStart + 16; // +16 to skip "\n>>>>>>> REPLACE"
  }

  return { blocks, isNewFile, fullContent };
}

/**
 * Extract file sections with their patch blocks
 */
function extractFilePatchSections(
  response: string
): Map<
  string,
  { blocks: SearchReplaceBlock[]; explanation: string; isNewFile: boolean; fullContent?: string }
> {
  const sections = new Map<
    string,
    { blocks: SearchReplaceBlock[]; explanation: string; isNewFile: boolean; fullContent?: string }
  >();

  // Split by file headers
  const fileHeaderRegex = /###\s*File:\s*(.+?)(?:\n|$)/g;
  const matches: { path: string; index: number }[] = [];

  let match;
  while ((match = fileHeaderRegex.exec(response)) !== null) {
    matches.push({
      path: match[1].trim(),
      index: match.index + match[0].length,
    });
  }

  // Process each file section
  for (let i = 0; i < matches.length; i++) {
    const currentMatch = matches[i];
    const nextIndex =
      i + 1 < matches.length
        ? matches[i + 1].index - matches[i + 1].path.length - 10
        : response.length;
    const section = response.substring(currentMatch.index, nextIndex);

    // Extract explanation
    const reasonMatch = section.match(/\*\*Reason\*\*:\s*(.+?)(?:\n|$)/);
    const explanation = reasonMatch ? reasonMatch[1].trim() : '';

    // Parse patch blocks
    const parsed = parseFilePatchSection(section);

    sections.set(currentMatch.path, {
      blocks: parsed.blocks,
      explanation,
      isNewFile: parsed.isNewFile,
      fullContent: parsed.fullContent,
    });
  }

  return sections;
}

/**
 * Extract legacy format file blocks
 */
export function extractFileBlocks(response: string): Array<{ path: string; content: string }> {
  const blocks: Array<{ path: string; content: string }> = [];

  // Standard pattern: <AI_EDIT_CONTENT_START:path>...<AI_EDIT_CONTENT_END:path>
  const fileBlockPattern =
    /<AI_EDIT_CONTENT_START:(.+?)>\s*\n([\s\S]*?)\n\s*<AI_EDIT_CONTENT_END:\1>/g;

  let match;
  while ((match = fileBlockPattern.exec(response)) !== null) {
    blocks.push({
      path: match[1].trim(),
      content: match[2],
    });
  }

  // Fallback: END tag path doesn't match
  if (blocks.length === 0) {
    const loosePattern = /<AI_EDIT_CONTENT_START:(.+?)>\s*\n([\s\S]*?)<AI_EDIT_CONTENT_END:(.+?)>/g;
    let looseMatch;
    while ((looseMatch = loosePattern.exec(response)) !== null) {
      const startPath = looseMatch[1].trim();
      const endPath = looseMatch[3].trim();
      if (normalizePath(startPath) === normalizePath(endPath)) {
        blocks.push({
          path: startPath,
          content: looseMatch[2].trim(),
        });
      }
    }
  }

  // Further fallback: missing END tag
  if (blocks.length === 0) {
    const unclosedPattern =
      /<AI_EDIT_CONTENT_START:(.+?)>\s*\n([\s\S]*?)(?=<AI_EDIT_CONTENT_START:|$)/g;
    let unclosedMatch;
    while ((unclosedMatch = unclosedPattern.exec(response)) !== null) {
      const path = unclosedMatch[1].trim();
      let content = unclosedMatch[2];
      content = content.replace(/<AI_EDIT_CONTENT_END:.+?>[\s\S]*$/, '');
      if (content.trim()) {
        blocks.push({
          path,
          content: content.trim(),
        });
      }
    }
  }

  return blocks;
}

/**
 * Extract change reasons from response
 */
export function extractReasons(response: string): Map<string, string> {
  const reasonMap = new Map<string, string>();

  // Pattern 1: ### File: ... **Reason**: ...
  const pattern1 = /###\s*File:\s*(.+?)\s*\n+\*\*Reason\*\*:\s*(.+?)(?=\n)/g;
  let match1;
  while ((match1 = pattern1.exec(response)) !== null) {
    const path = match1[1].trim();
    const reason = match1[2].trim();
    reasonMap.set(path, reason);
  }

  // Pattern 2: ## Changed File: ... **Reason**: ...
  const pattern2 =
    /##\s*(?:Changed\s+)?File:\s*(.+?)\s*\n+\*\*(?:Reason|変更理由)\*\*:\s*(.+?)(?=\n)/g;
  let match2;
  while ((match2 = pattern2.exec(response)) !== null) {
    const path = match2[1].trim();
    const reason = match2[2].trim();
    if (!reasonMap.has(path)) {
      reasonMap.set(path, reason);
    }
  }

  // Pattern 3: Japanese format
  const pattern3 = /##\s*変更ファイル:\s*(.+?)\s*\n+\*\*変更理由\*\*:\s*(.+?)(?=\n)/g;
  let match3;
  while ((match3 = pattern3.exec(response)) !== null) {
    const path = match3[1].trim();
    const reason = match3[2].trim();
    if (!reasonMap.has(path)) {
      reasonMap.set(path, reason);
    }
  }

  // Pattern 4: **ファイル名**: ... **理由**: ...
  const pattern4 = /\*\*ファイル名\*\*:\s*(.+?)\s*\n+\*\*理由\*\*:\s*(.+?)(?=\n|$)/g;
  let match4;
  while ((match4 = pattern4.exec(response)) !== null) {
    const path = match4[1].trim();
    const reason = match4[2].trim();
    if (!reasonMap.has(path)) {
      reasonMap.set(path, reason);
    }
  }

  // Pattern 5: [filepath] - [reason]
  const pattern5 = /^-?\s*\[?(.+?\.(?:ts|tsx|js|jsx|json|md|css|html))\]?\s*[-:]\s*(.+)$/gm;
  let match5;
  while ((match5 = pattern5.exec(response)) !== null) {
    const path = match5[1].trim();
    const reason = match5[2].trim();
    if (!reasonMap.has(path)) {
      reasonMap.set(path, reason);
    }
  }

  // Pattern 6: Change/Modified: filepath - reason
  const pattern6 =
    /^(?:変更|Change|Modified):\s*(.+?\.(?:ts|tsx|js|jsx|json|md|css|html|py|java|go|rs))\s*[-:]\s*(.+)$/gm;
  let match6;
  while ((match6 = pattern6.exec(response)) !== null) {
    const path = match6[1].trim();
    const reason = match6[2].trim();
    if (!reasonMap.has(path)) {
      reasonMap.set(path, reason);
    }
  }

  // Pattern 7: ## File: ... Reason: ... (English format without bold)
  const pattern7 = /##\s*File:\s*(.+?)\s*\n+Reason:\s*(.+?)(?=\n|$)/g;
  let match7;
  while ((match7 = pattern7.exec(response)) !== null) {
    const path = match7[1].trim();
    const reason = match7[2].trim();
    if (!reasonMap.has(path)) {
      reasonMap.set(path, reason);
    }
  }

  return reasonMap;
}

/**
 * Clean up message by removing code blocks and metadata
 */
export function cleanupMessage(response: string): string {
  let cleaned = response;

  // Remove SEARCH/REPLACE blocks
  cleaned = cleaned.replace(/<<<<<<< SEARCH[\s\S]*?>>>>>>> REPLACE/g, '');
  cleaned = cleaned.replace(/<<<<<<< NEW_FILE[\s\S]*?>>>>>>> NEW_FILE/g, '');

  // Remove legacy file blocks
  cleaned = cleaned.replace(
    /<AI_EDIT_CONTENT_START:[^>]+>[\s\S]*?<AI_EDIT_CONTENT_END:[^>]+>/g,
    ''
  );
  cleaned = cleaned.replace(/<AI_EDIT_CONTENT_START:[^>]+>[\s\S]*$/g, '');

  // Remove metadata lines
  cleaned = cleaned.replace(/^###\s*File:.*$/gm, '');
  cleaned = cleaned.replace(/^##\s*(?:Changed\s+)?File:.*$/gm, '');
  cleaned = cleaned.replace(/^##\s*変更ファイル:.*$/gm, '');
  cleaned = cleaned.replace(/^\*\*(?:Reason|変更理由)\*\*:.+$/gm, '');
  cleaned = cleaned.replace(/^\*\*(?:ファイル名|File Name|Filename)\*\*:.+$/gm, '');
  cleaned = cleaned.replace(/^\*\*(?:理由|Reason)\*\*:.+$/gm, '');
  cleaned = cleaned.replace(/^(?:Reason|理由):\s*.+$/gm, '');
  cleaned = cleaned.replace(
    /^(?:変更|Change|Modified):\s*.+?\.(?:ts|tsx|js|jsx|json|md|css|html|py|java|go|rs)\s*[-:].*$/gm,
    ''
  );
  cleaned = cleaned.replace(/^---+$/gm, '');

  // Remove empty code blocks
  cleaned = cleaned.replace(/^```[a-z]*\s*```$/gm, '');
  cleaned = cleaned.replace(/^```[a-z]*\s*$/gm, '');
  cleaned = cleaned.replace(/^```\s*$/gm, '');

  // Normalize multiple newlines
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');

  return cleaned.trim();
}

/**
 * Check if response uses patch format (SEARCH/REPLACE blocks)
 */
function usesPatchFormat(response: string): boolean {
  return response.includes('<<<<<<< SEARCH') || response.includes('<<<<<<< NEW_FILE');
}

/**
 * Parse AI edit response (supports both patch and legacy formats)
 */
export function parseEditResponse(
  response: string,
  originalFiles: Array<{ path: string; content: string }>
): ParseResult {
  const changedFiles: ParsedFile[] = [];
  const usedPatchFormat = usesPatchFormat(response);

  // Create normalized path map
  const normalizedOriginalFiles = new Map(originalFiles.map(f => [normalizePath(f.path), f]));

  if (usedPatchFormat) {
    // Parse new SEARCH/REPLACE format
    const fileSections = extractFilePatchSections(response);

    fileSections.forEach((section, filePath) => {
      const normalizedPath = normalizePath(filePath);
      const originalFile = normalizedOriginalFiles.get(normalizedPath);

      if (section.isNewFile && section.fullContent !== undefined) {
        // New file creation
        changedFiles.push({
          path: filePath,
          originalContent: '',
          suggestedContent: section.fullContent,
          explanation: section.explanation || 'New file',
          isNewFile: true,
          patchBlocks: [],
        });
      } else if (originalFile && section.blocks.length > 0) {
        // Apply patches to existing file
        const patchBlock: PatchBlock = {
          filePath: originalFile.path,
          blocks: section.blocks,
          explanation: section.explanation,
        };

        const result = applyPatchBlock(originalFile.content, patchBlock);

        changedFiles.push({
          path: originalFile.path,
          originalContent: originalFile.content,
          suggestedContent: result.patchedContent,
          explanation: section.explanation || 'Modified',
          patchBlocks: section.blocks,
        });
      }
    });
  } else {
    // Fall back to legacy format parsing
    const fileBlocks = extractFileBlocks(response);
    const reasonMap = extractReasons(response);

    for (const block of fileBlocks) {
      const normalizedPath = normalizePath(block.path);
      const originalFile = normalizedOriginalFiles.get(normalizedPath);

      if (originalFile) {
        let explanation = reasonMap.get(block.path) || reasonMap.get(originalFile.path);

        // Search by normalized path if not found
        if (!explanation) {
          reasonMap.forEach((value, key) => {
            if (normalizePath(key) === normalizedPath && !explanation) {
              explanation = value;
            }
          });
        }

        changedFiles.push({
          path: originalFile.path,
          originalContent: originalFile.content,
          suggestedContent: block.content,
          explanation: explanation || 'No explanation provided',
        });
      } else {
        // New file in legacy format
        const explanation = reasonMap.get(block.path) || 'New file';
        changedFiles.push({
          path: block.path,
          originalContent: '',
          suggestedContent: block.content,
          explanation,
          isNewFile: true,
        });
      }
    }
  }

  // Clean up message
  let message = cleanupMessage(response);

  // Fallback message handling
  const hasValidMessage = message && message.replace(/\s/g, '').length >= 5;

  if (changedFiles.length === 0 && !hasValidMessage) {
    const failureNote =
      'Failed to parse response. Ensure you use the correct SEARCH/REPLACE block format (<<<<<<< SEARCH ... >>>>>>> REPLACE) or legacy file tags (<AI_EDIT_CONTENT_START:...>).';
    const safeResponse = response.replace(/```/g, '```\u200B');
    const rawBlock = `\n\n---\n\nRaw response:\n\n\`\`\`text\n${safeResponse}\n\`\`\``;
    message = failureNote + rawBlock;
  } else if (changedFiles.length > 0 && !hasValidMessage) {
    message = `Suggested edits for ${changedFiles.length} file(s).`;
  }

  return {
    changedFiles,
    message,
    raw: response,
    usedPatchFormat,
  };
}

/**
 * Validate response quality
 */
export function validateResponse(response: string): {
  isValid: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!response || response.trim().length === 0) {
    errors.push('Empty response');
    return { isValid: false, errors, warnings };
  }

  const usesPatch = usesPatchFormat(response);

  if (usesPatch) {
    // Validate SEARCH/REPLACE format
    const searchCount = (response.match(/<<<<<<< SEARCH/g) || []).length;
    const replaceCount = (response.match(/>>>>>>> REPLACE/g) || []).length;
    const newFileStartCount = (response.match(/<<<<<<< NEW_FILE/g) || []).length;
    const newFileEndCount = (response.match(/>>>>>>> NEW_FILE/g) || []).length;

    if (searchCount !== replaceCount) {
      errors.push(`Mismatched SEARCH/REPLACE: ${searchCount} SEARCH vs ${replaceCount} REPLACE`);
    }

    if (newFileStartCount !== newFileEndCount) {
      errors.push(`Mismatched NEW_FILE tags: ${newFileStartCount} start vs ${newFileEndCount} end`);
    }

    // Additional validation: Check for well-formed blocks
    if (searchCount > 0) {
      // Count complete blocks (with proper separator and end marker)
      // Allow optional whitespace around markers for flexibility
      const completeBlockPattern =
        /<<<<<<< SEARCH\s*\n[\s\S]*?\n\s*=======\s*\n[\s\S]*?\n\s*>>>>>>> REPLACE/g;
      const completeBlocks = (response.match(completeBlockPattern) || []).length;

      if (completeBlocks < searchCount && searchCount === replaceCount) {
        warnings.push(
          `Some SEARCH/REPLACE blocks may be missing the separator (=======). ${completeBlocks} complete blocks found out of ${searchCount} expected.`
        );
      }
    }

    if (searchCount === 0 && newFileStartCount === 0) {
      warnings.push('No patch blocks found');
    }
  } else {
    // Validate legacy format
    const startTags = response.match(/<AI_EDIT_CONTENT_START:[^>]+>/g) || [];
    const endTags = response.match(/<AI_EDIT_CONTENT_END:[^>]+>/g) || [];

    if (startTags.length !== endTags.length) {
      errors.push(`Mismatched tags: ${startTags.length} START vs ${endTags.length} END`);
    }

    if (startTags.length === 0) {
      warnings.push('No file blocks found');
    }

    const blocks = extractFileBlocks(response);
    if (blocks.length < startTags.length) {
      warnings.push('Some file blocks may be malformed');
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}
