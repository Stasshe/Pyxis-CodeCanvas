/**
 * AI Agent Prompt Templates
 *
 * Multi-patch editing system using SEARCH/REPLACE blocks
 * for precise, minimal code changes.
 */

const SYSTEM_PROMPT = `You are an expert code editing assistant. You receive code editing instructions and provide precise, minimal changes.

CRITICAL: You MUST follow the exact response format below. Do not deviate from this format.

## Response Format

For each file you need to modify, use this EXACT format:

### File: [filepath]
**Reason**: [brief explanation of the change]

Use SEARCH/REPLACE blocks to specify changes. Each block finds exact text and replaces it:

\`\`\`
<<<<<<< SEARCH
[exact lines to find - must match the file exactly]
=======
[replacement lines]
>>>>>>> REPLACE
\`\`\`

### Multiple Changes in One File

You can have multiple SEARCH/REPLACE blocks for the same file:

\`\`\`
<<<<<<< SEARCH
[first section to find]
=======
[first replacement]
>>>>>>> REPLACE
\`\`\`

\`\`\`
<<<<<<< SEARCH
[second section to find]
=======
[second replacement]
>>>>>>> REPLACE
\`\`\`

### New File Creation

For new files, use the NEW_FILE tag:

### File: [new/filepath]
**Reason**: Creating new file

\`\`\`
<<<<<<< NEW_FILE
[entire file content]
>>>>>>> NEW_FILE
\`\`\`

## Rules

1. SEARCH blocks must match EXACTLY (including whitespace and indentation)
2. Include enough context lines (3-5 lines before/after) to ensure unique matching
3. Keep changes minimal - only change what's necessary
4. Preserve existing code style and formatting
5. Each SEARCH/REPLACE pair handles ONE logical change
6. For deletions, use empty REPLACE section
7. Order matters - apply changes top-to-bottom in the file

## Example

For adding a new function parameter:

\`\`\`
<<<<<<< SEARCH
function greet(name: string) {
  console.log(\`Hello, \${name}!\`);
}
=======
function greet(name: string, greeting: string = "Hello") {
  console.log(\`\${greeting}, \${name}!\`);
}
>>>>>>> REPLACE
\`\`\``;

/**
 * Format history messages to a compact form
 * - User messages: instruction content only
 * - Assistant messages (edit): changed file paths and explanations only (no code content)
 * - Assistant messages (ask): answer content
 */
function formatHistoryMessages(
  previousMessages?: Array<{ type: string; content: string; mode?: string; editResponse?: any }>
): string {
  if (!previousMessages || previousMessages.length === 0) return '';

  // Summarize last 5 messages
  return previousMessages
    .slice(-5)
    .map(msg => {
      const role = msg.type === 'user' ? 'User' : 'Assistant';
      const modeLabel = msg.mode === 'edit' ? '[Edit]' : '[Chat]';

      // For assistant edit messages, generate summary from editResponse
      if (msg.type === 'assistant' && msg.mode === 'edit' && msg.editResponse) {
        const files = msg.editResponse.changedFiles || [];
        if (files.length > 0) {
          const summary = files
            .map((f: any) => `- ${f.path}: ${f.explanation || 'modified'}`)
            .join('\n');
          return `### ${role} ${modeLabel}\nChanged files:\n${summary}`;
        }
      }

      // Otherwise, include content directly (truncate if too long)
      const content = msg.content.length > 500 ? `${msg.content.slice(0, 500)}...` : msg.content;
      return `### ${role} ${modeLabel}\n${content}`;
    })
    .join('\n\n');
}

/**
 * Format custom instructions from .pyxis/pyxis-instructions.md
 */
function formatCustomInstructions(customInstructions?: string): string {
  if (!customInstructions || customInstructions.trim().length === 0) {
    return '';
  }

  return `## Project-Specific Instructions

The project has provided the following custom instructions that you MUST follow:

<custom_instructions>
${customInstructions}
</custom_instructions>

`;
}

export const ASK_PROMPT_TEMPLATE = (
  files: Array<{ path: string; content: string }>,
  question: string,
  previousMessages?: Array<{ type: string; content: string; mode?: string; editResponse?: any }>,
  customInstructions?: string
) => {
  const history = formatHistoryMessages(previousMessages);
  const customInstr = formatCustomInstructions(customInstructions);

  const fileContexts = files
    .map(
      file => `
## File: ${file.path}
\`\`\`
${file.content}
\`\`\`
`
    )
    .join('\n');

  return `You are an expert code assistant. Answer the user's question clearly and concisely, referencing the provided files and conversation history as needed. Match the user's language in your response.

${customInstr}${history ? `## Conversation History\n${history}\n` : ''}

${fileContexts ? `## Provided Files\n${fileContexts}\n` : ''}

## Question
${question}

---
Provide a clear, helpful response. Use code blocks when showing code examples.`;
};

export const EDIT_PROMPT_TEMPLATE = (
  files: Array<{ path: string; content: string }>,
  instruction: string,
  previousMessages?: Array<{ type: string; content: string; mode?: string; editResponse?: any }>,
  customInstructions?: string
) => {
  const history = formatHistoryMessages(previousMessages);
  const customInstr = formatCustomInstructions(customInstructions);

  // Current file contents (these are the editing targets)
  const fileContexts = files
    .map(
      file => `
## File: ${file.path}
\`\`\`
${file.content}
\`\`\`
`
    )
    .join('\n');

  return `${SYSTEM_PROMPT}

${customInstr}${history ? `## Conversation History\n${history}\n` : ''}

## Files to Edit (Current State)
${fileContexts}

## Edit Instructions
${instruction}

---
IMPORTANT REMINDERS:
- Use SEARCH/REPLACE blocks for ALL changes
- SEARCH text must match the file EXACTLY
- Include 3-5 lines of context around the change
- For new files, use <<<<<<< NEW_FILE ... >>>>>>> NEW_FILE
- Keep changes minimal and focused
- Multiple SEARCH/REPLACE blocks can be used for multiple changes in the same file
- Separate each file's changes with "### File: [filepath]"`;
};

/**
 * Legacy format support - for full file replacement when patch fails
 */
export const EDIT_PROMPT_TEMPLATE_LEGACY = (
  files: Array<{ path: string; content: string }>,
  instruction: string,
  previousMessages?: Array<{ type: string; content: string; mode?: string; editResponse?: any }>,
  customInstructions?: string
) => {
  const history = formatHistoryMessages(previousMessages);
  const customInstr = formatCustomInstructions(customInstructions);

  const LEGACY_SYSTEM_PROMPT = `You are an expert code editing assistant. You receive code editing instructions and provide changes.

IMPORTANT: Follow the exact response format below.

Response Format:
For each file that needs changes, use this format:

## Changed File: [filepath]
**Reason**: [explanation of the change]

<AI_EDIT_CONTENT_START:[filepath]>
[complete modified file content here]
<AI_EDIT_CONTENT_END:[filepath]>

---

Rules:
- Keep changes minimal
- Match existing code style
- Provide brief explanations
- Use the exact tags shown above`;

  const fileContexts = files
    .map(
      file => `
## File: ${file.path}
<AI_EDIT_CONTENT_START:${file.path}>
${file.content}
<AI_EDIT_CONTENT_END:${file.path}>
`
    )
    .join('\n');

  return `${LEGACY_SYSTEM_PROMPT}

${customInstr}${history ? `## Conversation History\n${history}\n` : ''}

## Files to Edit (Current State)
${fileContexts}

## Edit Instructions
${instruction}

---
For new files, specify "New File" in the reason.

New File Format:
## Changed File: [new/filepath]
**Reason**: New file creation
<AI_EDIT_CONTENT_START:[new/filepath]>
[new file content]
<AI_EDIT_CONTENT_END:[new/filepath]>
---`;
};
