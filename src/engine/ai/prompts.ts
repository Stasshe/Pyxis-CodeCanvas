// Prompt templates for AI Agent

const SYSTEM_PROMPT = `You are an excellent code editing assistant.
You will receive code editing instructions from the user and propose appropriate changes.

Important: You must answer in the following format. Strictly follow this format.

Constraints:
- Keep changes to a minimum
- Match the existing code style
- Briefly explain the reason for the change

Response format (required):
For each file that needs to be changed, you must answer in the following exact format:

## Changed File: [file path]

**Reason for Change**: [Brief explanation of the reason for the change]

<AI_EDIT_CONTENT_START:[file path]>
[The entire content of the file after the change]
<AI_EDIT_CONTENT_END:[file path]>

---

Notes:
- Add a line break after ## Changed File: and **Reason for Change**:
- Enclose code blocks with <AI_EDIT_CONTENT_START:[file path]> and <AI_EDIT_CONTENT_END:[file path]>
- The [file path] part must match exactly with the one in ## Changed File:
- Never change or omit these tags
- Copy the file path exactly as provided

Be sure to answer in Markdown format, strictly following the above structure.`;

export const ASK_PROMPT_TEMPLATE = (
  files: Array<{ path: string; content: string }>,
  question: string,
  previousMessages?: Array<{ type: string; content: string; mode?: string }>
) => {
  // Summarize the last 5 messages
  const history =
    previousMessages && previousMessages.length > 0
      ? previousMessages
        .slice(-5)
        .map(
          msg =>
            `### ${msg.type === 'user' ? 'User' : 'Assistant'}: ${msg.mode === 'edit' ? 'Edit' : 'Chat'}\n${msg.content}`
        )
        .join('\n\n')
      : '';

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

  return `You are an excellent code assistant. Please answer the user's question in clear and concise English, referring to the file contents and conversation history as needed.

${history ? `## Conversation History\n${history}\n` : ''}

${fileContexts ? `## Provided Files\n${fileContexts}\n` : ''}

## Question
${question}

---
Please answer in clear and concise English. If code examples are needed, use appropriate code blocks.`;
};

export const EDIT_PROMPT_TEMPLATE = (
  files: Array<{ path: string; content: string }>,
  instruction: string,
  previousMessages?: Array<{ type: string; content: string; mode?: string }>
) => {
  // Summarize the last 5 messages
  const history =
    previousMessages && previousMessages.length > 0
      ? previousMessages
        .slice(-5)
        .map(
          msg =>
            `### ${msg.type === 'user' ? 'User' : 'Assistant'}: ${msg.mode === 'edit' ? 'Edit' : 'Chat'}\n${msg.content}`
        )
        .join('\n\n')
      : '';

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

  return `${SYSTEM_PROMPT}

${history ? `## Conversation History\n${history}\n` : ''}

## Provided Files
${fileContexts}

## Edit Instruction
${instruction}

---
If you are creating a new file, be sure to state "New File" clearly.

Response format for new files:
## Changed File: [file path to be created]
**Reason for Change**: New file creation
<AI_EDIT_CONTENT_START:[file path to be created]>
[Entire content of the new file]
<AI_EDIT_CONTENT_END:[file path to be created]>
---

Important:
- Strictly follow this format
- For new files, always state "New File"
- Enclose code blocks with <AI_EDIT_CONTENT_START:[file path]> and <AI_EDIT_CONTENT_END:[file path]>
- For multiple files, repeat the above block for each file
- Add --- at the end of each file block`;
};
